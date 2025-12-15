/**
 * @file libraryUsageIndex.ts
 * @description Индекс обратных ссылок: какие холсты/ноды используют docId.
 *
 * Зачем он нужен:
 * - UI файлового менеджера показывает "используется в" (links),
 * - GC должен удалять документы только когда на них нет ссылок,
 * - фильтр по холсту (показать документы, используемые на canvasId).
 *
 * Почему это отдельный файл (usage-index.json):
 * - library-index.json содержит метаданные документов и дерево папок,
 * - usage-index.json содержит динамическую "связность" между документами и холстами.
 *
 * Ключевой принцип обновления:
 * - Источником истины остаются canvas.json (node.data.attachments).
 * - Поэтому при POST /api/canvas/[id] мы делаем “replace all usage for canvasId”:
 *   полностью пересчитываем ссылки и заменяем их в usage-index.
 *
 * Это:
 * - проще (меньше гонок),
 * - безопаснее (не оставляет “зомби-ссылки” при удалениях),
 * - достаточно быстро для локального приложения.
 */

import { promises as fs } from 'fs';
import { getLibraryDirectory, getLibraryUsageIndexPath } from '@/lib/paths';
import { readJsonOrNull, writeJsonPrettyAtomic } from '@/lib/libraryFs';

// =============================================================================
// TYPES (v1)
// =============================================================================

export type UsageIndexV1 = {
  version: 1;

  /**
   * Основная структура:
   * - byDocId[docId].byCanvasId[canvasId] = { nodeIds[] }
   *
   * Почему docId сверху:
   * - частая операция: показать “используется в каких холстах” для конкретного документа.
   */
  byDocId: Record<
    string,
    {
      byCanvasId: Record<
        string,
        {
          nodeIds: string[];
          updatedAt: number;
        }
      >;
      updatedAt: number;
    }
  >;

  updatedAt: number;
};

/**
 * "Детальная" ссылка использования документа:
 * документ (docId) используется на холсте (canvasId) в конкретных карточках (nodeIds).
 *
 * Почему тип отдельный:
 * - UI (FileManager → Details → Links) удобнее потреблять список объектов,
 *   чем словарь словарей.
 * - Сервер формирует его из `usage-index.json` на лету.
 */
export type DocUsageLink = {
  canvasId: string;
  nodeIds: string[];
  updatedAt: number;
};

// =============================================================================
// INTERNAL
// =============================================================================

const now = () => Date.now();

export function createEmptyUsageIndex(): UsageIndexV1 {
  return { version: 1, byDocId: {}, updatedAt: now() };
}

export async function ensureUsageIndexDirectory(): Promise<void> {
  await fs.mkdir(getLibraryDirectory(), { recursive: true });
}

// =============================================================================
// READ / WRITE
// =============================================================================

export async function readUsageIndex(): Promise<UsageIndexV1> {
  await ensureUsageIndexDirectory();
  const p = getLibraryUsageIndexPath();
  const loaded = await readJsonOrNull<UsageIndexV1>(p);
  if (!loaded) return createEmptyUsageIndex();

  if (loaded.version !== 1 || !loaded.byDocId || typeof loaded.byDocId !== 'object') {
    return createEmptyUsageIndex();
  }

  return loaded;
}

export async function writeUsageIndex(index: UsageIndexV1): Promise<void> {
  await ensureUsageIndexDirectory();
  index.updatedAt = now();
  await writeJsonPrettyAtomic(getLibraryUsageIndexPath(), index);
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Возвращает список canvasId, где используется docId (без nodeIds).
 */
export function getCanvasIdsForDoc(index: UsageIndexV1, docId: string): string[] {
  const entry = index.byDocId[String(docId || '').trim()];
  if (!entry) return [];
  return Object.keys(entry.byCanvasId || {});
}

/**
 * Возвращает nodeIds для конкретной пары (docId, canvasId).
 */
export function getNodeIdsForDocOnCanvas(index: UsageIndexV1, docId: string, canvasId: string): string[] {
  const entry = index.byDocId[String(docId || '').trim()];
  if (!entry) return [];
  const c = entry.byCanvasId[String(canvasId || '').trim()];
  if (!c) return [];
  return Array.isArray(c.nodeIds) ? c.nodeIds : [];
}

/**
 * Возвращает список "детальных ссылок" для docId:
 * - canvasId
 * - nodeIds[]
 *
 * Важно:
 * - это best-effort helper для UI; если структура повреждена, вернём пусто.
 * - порядок стабилизируем сортировкой по canvasId, чтобы UI не "прыгал" между рендерами.
 */
export function getUsageLinksForDoc(index: UsageIndexV1, docId: string): DocUsageLink[] {
  const entry = index.byDocId[String(docId || '').trim()];
  if (!entry || !entry.byCanvasId || typeof entry.byCanvasId !== 'object') return [];

  const links: DocUsageLink[] = [];
  for (const [canvasId, v] of Object.entries(entry.byCanvasId)) {
    const nodeIds = Array.isArray(v?.nodeIds) ? v.nodeIds : [];
    if (nodeIds.length === 0) continue;
    links.push({
      canvasId,
      nodeIds,
      updatedAt: typeof v?.updatedAt === 'number' ? v.updatedAt : entry.updatedAt,
    });
  }

  links.sort((a, b) => String(a.canvasId).localeCompare(String(b.canvasId), 'ru', { sensitivity: 'base' }));
  return links;
}

/**
 * Быстрый ответ: есть ли у docId хоть одна ссылка.
 */
export function hasAnyUsage(index: UsageIndexV1, docId: string): boolean {
  const entry = index.byDocId[String(docId || '').trim()];
  if (!entry) return false;
  return Object.keys(entry.byCanvasId || {}).length > 0;
}

// =============================================================================
// MUTATIONS
// =============================================================================

/**
 * Полностью заменяет usage для одного canvasId.
 *
 * @param canvasId - ID холста
 * @param usageByDocId - Map docId -> nodeIds[]
 *
 * Как работает:
 * 1) Сначала удаляем canvasId из всех docId (где он был),
 * 2) Затем записываем новые ссылки.
 *
 * Почему так:
 * - предотвращает "зомби-ссылки" при удалении документов с холста,
 * - идемпотентно: одинаковый вход => одинаковое состояние индекса.
 */
export function replaceCanvasUsage(index: UsageIndexV1, canvasId: string, usageByDocId: Map<string, string[]>): void {
  const cid = String(canvasId || '').trim();
  if (!cid) return;

  // 1) Удаляем canvasId из всех docs.
  for (const [docId, entry] of Object.entries(index.byDocId)) {
    if (!entry?.byCanvasId || typeof entry.byCanvasId !== 'object') continue;
    if (entry.byCanvasId[cid]) {
      delete entry.byCanvasId[cid];
      entry.updatedAt = now();
      // Если после удаления ссылок не осталось — можно оставить пустой объект,
      // либо удалить docId из индекса. Мы оставляем *только* если есть другие холсты.
      if (Object.keys(entry.byCanvasId).length === 0) {
        delete index.byDocId[docId];
      }
    }
  }

  // 2) Записываем новые ссылки.
  const ts = now();
  for (const [docIdRaw, nodeIdsRaw] of usageByDocId.entries()) {
    const docId = String(docIdRaw || '').trim();
    if (!docId) continue;

    // nodeIds:
    // - дедуп
    // - фильтруем пустые
    const nodeIds = Array.from(new Set((nodeIdsRaw || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (nodeIds.length === 0) continue;

    if (!index.byDocId[docId]) {
      index.byDocId[docId] = { byCanvasId: {}, updatedAt: ts };
    }
    index.byDocId[docId].byCanvasId[cid] = { nodeIds, updatedAt: ts };
    index.byDocId[docId].updatedAt = ts;
  }

  index.updatedAt = ts;
}

/**
 * Удаляет usage для canvasId (например, при удалении холста).
 */
export function removeCanvasUsage(index: UsageIndexV1, canvasId: string): void {
  replaceCanvasUsage(index, canvasId, new Map());
}

