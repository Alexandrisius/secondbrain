/**
 * @file libraryUnlink.ts
 * @description Helper для "отвязки" документов из всех холстов при удалении.
 *
 * Когда документ удаляется (trash/empty/gc), мы должны:
 * 1) Найти все холсты, где этот docId используется (через usage-index.json)
 * 2) Для каждого холста:
 *    - Удалить из всех нод любые `data.attachments[]` с `attachmentId === docId`
 *    - Почистить `excludedAttachmentIds` (убрать docId)
 *    - Почистить legacy-поля: `attachmentExcerpts`, `attachmentSummaries`, `attachmentImageDescriptions`
 *    - Если у ноды был `data.response` → выставить `data.isStale = true` и обновить `data.updatedAt`
 * 3) Обновить usage-index.json — убрать ссылки на этот docId
 * 4) Вернуть `touched` — какие canvasId/nodeIds были изменены (для in-memory патча клиента)
 *
 * Почему это отдельный модуль:
 * - Логика одинакова для /trash/move, /trash/empty, /gc
 * - Проще тестировать и поддерживать
 * - Не дублируем код в трёх API routes
 */

import { promises as fs } from 'fs';
import { getCanvasFilePath } from '@/lib/paths';
import {
  readUsageIndex,
  writeUsageIndex,
  getUsageLinksForDoc,
  type UsageIndexV1,
} from '@/lib/libraryUsageIndex';
import type { NodeAttachment } from '@/types/canvas';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Результат отвязки одного docId.
 *
 * touched — список canvasId+nodeIds, которые были реально изменены.
 * Клиент использует это для мгновенного патча активного холста в памяти.
 */
export type UnlinkResult = {
  /** Список холстов и нод, которые были затронуты */
  touched: Array<{ canvasId: string; nodeIds: string[] }>;
  /** Количество изменённых холстов */
  canvasesModified: number;
  /** Количество изменённых нод (всего) */
  nodesModified: number;
};

// =============================================================================
// MAIN HELPER
// =============================================================================

/**
 * Отвязывает docId из всех холстов и обновляет usage-index.
 *
 * @param docId - ID документа для отвязки
 * @returns UnlinkResult - информация о затронутых холстах/нодах
 *
 * Важно:
 * - Это best-effort операция: если какой-то холст не удалось прочитать/записать,
 *   мы логируем ошибку и продолжаем (не ломаем весь процесс удаления).
 * - Usage-index обновляется в конце, чтобы отразить "реальное" состояние.
 */
export async function unlinkDocFromAllCanvases(docId: string): Promise<UnlinkResult> {
  const normalizedDocId = String(docId || '').trim();
  if (!normalizedDocId) {
    return { touched: [], canvasesModified: 0, nodesModified: 0 };
  }

  // 1) Читаем usage-index, чтобы понять, какие холсты используют этот docId
  const usageIndex = await readUsageIndex();
  const usageLinks = getUsageLinksForDoc(usageIndex, normalizedDocId);

  // Если ссылок нет — ничего не делаем
  if (usageLinks.length === 0) {
    return { touched: [], canvasesModified: 0, nodesModified: 0 };
  }

  const touched: Array<{ canvasId: string; nodeIds: string[] }> = [];
  let canvasesModified = 0;
  let nodesModified = 0;

  // 2) Для каждого холста патчим canvas.json
  for (const link of usageLinks) {
    const canvasId = link.canvasId;
    const canvasPath = getCanvasFilePath(canvasId);

    try {
      // Читаем canvas.json
      let raw: string;
      try {
        raw = await fs.readFile(canvasPath, 'utf-8');
      } catch (readErr: unknown) {
        const code = readErr && typeof readErr === 'object' && 'code' in readErr
          ? String((readErr as { code?: unknown }).code)
          : null;
        if (code === 'ENOENT') {
          // Холст был удалён — пропускаем
          console.warn(`[libraryUnlink] Canvas file not found, skipping: ${canvasPath}`);
          continue;
        }
        throw readErr;
      }

      // Парсим JSON
      let canvasJson: unknown;
      try {
        canvasJson = JSON.parse(raw);
      } catch {
        console.warn(`[libraryUnlink] Canvas JSON parse failed, skipping: ${canvasPath}`);
        continue;
      }

      if (!canvasJson || typeof canvasJson !== 'object') continue;
      const canvasObj = canvasJson as { nodes?: unknown };
      if (!Array.isArray(canvasObj.nodes)) continue;

      const ts = Date.now();
      let changed = false;
      const modifiedNodeIds: string[] = [];

      // 3) Патчим каждую ноду
      for (const n of canvasObj.nodes) {
        if (!n || typeof n !== 'object') continue;
        const nodeId = String((n as { id?: unknown }).id || '').trim();
        if (!nodeId) continue;

        const data = (n as { data?: unknown }).data;
        if (!data || typeof data !== 'object') continue;
        const nodeData = data as Record<string, unknown>;

        let nodeChanged = false;

        // 3.1) Удаляем из attachments[]
        const atts = nodeData.attachments;
        if (Array.isArray(atts)) {
          const before = atts.length;
          const filtered = atts.filter((a) => {
            if (!a || typeof a !== 'object') return true;
            const attId = String((a as NodeAttachment).attachmentId || '').trim();
            return attId !== normalizedDocId;
          });
          if (filtered.length !== before) {
            nodeData.attachments = filtered.length > 0 ? filtered : undefined;
            nodeChanged = true;
          }
        }

        // 3.2) Удаляем из excludedAttachmentIds
        const excluded = nodeData.excludedAttachmentIds;
        if (Array.isArray(excluded)) {
          const before = excluded.length;
          const filtered = excluded.filter((id) => String(id || '').trim() !== normalizedDocId);
          if (filtered.length !== before) {
            nodeData.excludedAttachmentIds = filtered.length > 0 ? filtered : undefined;
            nodeChanged = true;
          }
        }

        // 3.3) Чистим legacy-поля (best-effort)
        //      attachmentExcerpts, attachmentSummaries, attachmentImageDescriptions
        const legacyFields = ['attachmentExcerpts', 'attachmentSummaries', 'attachmentImageDescriptions'];
        for (const field of legacyFields) {
          const map = nodeData[field];
          if (map && typeof map === 'object' && !Array.isArray(map)) {
            const mapObj = map as Record<string, unknown>;
            if (normalizedDocId in mapObj) {
              delete mapObj[normalizedDocId];
              // Если map стал пустым — удаляем поле целиком
              if (Object.keys(mapObj).length === 0) {
                nodeData[field] = undefined;
              }
              nodeChanged = true;
            }
          }
        }

        // 3.4) Если нода изменилась и у неё есть response — ставим stale
        if (nodeChanged) {
          if (nodeData.response) {
            nodeData.isStale = true;
          }
          nodeData.updatedAt = ts;
          changed = true;
          modifiedNodeIds.push(nodeId);
        }
      }

      // 4) Записываем canvas.json обратно, если были изменения
      if (changed) {
        await fs.writeFile(canvasPath, JSON.stringify(canvasJson, null, 2), 'utf-8');
        canvasesModified += 1;
        nodesModified += modifiedNodeIds.length;
        touched.push({ canvasId, nodeIds: modifiedNodeIds });
      }
    } catch (patchErr) {
      // Best-effort: логируем и продолжаем
      console.warn(`[libraryUnlink] Failed to patch canvas ${canvasId}:`, patchErr);
    }
  }

  // 5) Обновляем usage-index: удаляем все ссылки на docId
  removeDocFromUsageIndex(usageIndex, normalizedDocId);
  await writeUsageIndex(usageIndex);

  return { touched, canvasesModified, nodesModified };
}

/**
 * Удаляет docId из usage-index (in-memory mutation).
 *
 * Вызывается после патча всех холстов, чтобы usage-index
 * отражал текущее состояние.
 */
function removeDocFromUsageIndex(index: UsageIndexV1, docId: string): void {
  if (index.byDocId && index.byDocId[docId]) {
    delete index.byDocId[docId];
    index.updatedAt = Date.now();
  }
}

// =============================================================================
// BATCH HELPER (для empty/gc)
// =============================================================================

/**
 * Отвязывает несколько docIds сразу.
 *
 * Оптимизация:
 * - Читаем usage-index один раз
 * - Группируем изменения по canvasId, чтобы не перезаписывать один файл много раз
 * - Записываем каждый canvas.json один раз
 *
 * @param docIds - массив ID документов для отвязки
 * @returns объединённый UnlinkResult
 */
export async function unlinkDocsFromAllCanvases(docIds: string[]): Promise<UnlinkResult> {
  const normalizedDocIds = Array.from(
    new Set(docIds.map((id) => String(id || '').trim()).filter(Boolean))
  );

  if (normalizedDocIds.length === 0) {
    return { touched: [], canvasesModified: 0, nodesModified: 0 };
  }

  // Для простоты используем последовательный unlink
  // (можно оптимизировать, но для локального приложения это достаточно быстро)
  const allTouched: Map<string, Set<string>> = new Map();
  let totalCanvasesModified = 0;
  let totalNodesModified = 0;

  for (const docId of normalizedDocIds) {
    const result = await unlinkDocFromAllCanvases(docId);
    totalCanvasesModified += result.canvasesModified;
    totalNodesModified += result.nodesModified;

    for (const t of result.touched) {
      const existing = allTouched.get(t.canvasId);
      if (existing) {
        for (const nodeId of t.nodeIds) {
          existing.add(nodeId);
        }
      } else {
        allTouched.set(t.canvasId, new Set(t.nodeIds));
      }
    }
  }

  // Конвертируем в массив
  const touched: Array<{ canvasId: string; nodeIds: string[] }> = [];
  for (const [canvasId, nodeIdSet] of allTouched.entries()) {
    touched.push({ canvasId, nodeIds: Array.from(nodeIdSet) });
  }

  return { touched, canvasesModified: totalCanvasesModified, nodesModified: totalNodesModified };
}
