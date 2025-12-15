/**
 * @file route.ts
 * @description API: POST /api/library/reindex-usage
 *
 * Полная реиндексация usage-index.json по всем canvases/*.json.
 *
 * Зачем это нужно (Todo G):
 * - usage-index обновляется best-effort при сохранении конкретного холста,
 *   но если где-то случилась рассинхронизация (краш/ручное редактирование/старые данные),
 *   то UI файлового менеджера может показывать неправильные "используется"/Links.
 * - Этот endpoint позволяет "вылечить" состояние одной кнопкой.
 *
 * Источник истины:
 * - data/canvases/<canvasId>.json (node.data.attachments)
 *
 * Безопасность/семантика:
 * - Мы индексируем только docId, которые "похожи" на библиотечные (UUID.ext),
 *   чтобы не засорять usage-index мусором.
 * - Это best-effort: повреждённые canvas.json пропускаем, но продолжаем.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getCanvasesDirectory } from '@/lib/paths';
import {
  createEmptyUsageIndex,
  replaceCanvasUsage,
  writeUsageIndex,
  type UsageIndexV1,
} from '@/lib/libraryUsageIndex';
import { isValidDocId } from '@/lib/libraryFs';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Минимальный runtime-тип узла холста для чтения вложений.
 *
 * Важно:
 * - canvas.json может содержать много других полей,
 * - мы читаем только то, что нужно для реиндексации.
 */
type CanvasNodeLike = {
  id?: unknown;
  data?: unknown;
};

export async function POST(): Promise<NextResponse> {
  try {
    const canvasesDir = getCanvasesDirectory();

    // Если директории нет — это не ошибка.
    // Например, пользователь ещё не создавал ни одного холста.
    let entries: string[] = [];
    try {
      entries = await fs.readdir(canvasesDir);
    } catch {
      entries = [];
    }

    // Создаём usage-index "с нуля".
    // Это проще и безопаснее, чем пытаться "умно" чинить существующий.
    const index: UsageIndexV1 = createEmptyUsageIndex();

    let canvasesProcessed = 0;
    let canvasesSkipped = 0;
    let totalLinks = 0;

    for (const entry of entries) {
      // Нас интересуют только *.json
      if (!entry.toLowerCase().endsWith('.json')) continue;

      const canvasId = entry.slice(0, -'.json'.length);
      if (!canvasId) continue;

      const fullPath = path.join(canvasesDir, entry);

      let raw: string;
      try {
        raw = await fs.readFile(fullPath, 'utf-8');
      } catch {
        canvasesSkipped += 1;
        continue;
      }

      let canvasJson: unknown;
      try {
        canvasJson = JSON.parse(raw);
      } catch {
        // Повреждённый JSON — пропускаем (best-effort).
        canvasesSkipped += 1;
        continue;
      }

      if (!canvasJson || typeof canvasJson !== 'object') {
        canvasesSkipped += 1;
        continue;
      }

      const obj = canvasJson as { nodes?: unknown };
      const nodes = Array.isArray(obj.nodes) ? (obj.nodes as CanvasNodeLike[]) : [];

      // Собираем usageByDocId для ЭТОГО холста.
      // Map(docId -> nodeIds[])
      const usageByDocId = new Map<string, string[]>();

      for (const n of nodes) {
        const nodeId = typeof n?.id === 'string' ? n.id : null;
        if (!nodeId) continue;

        const data = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null;
        if (!data) continue;

        const atts = Array.isArray(data.attachments) ? (data.attachments as Array<{ attachmentId?: unknown }>) : [];
        if (atts.length === 0) continue;

        for (const a of atts) {
          const docId = typeof a?.attachmentId === 'string' ? a.attachmentId : '';
          if (!docId) continue;

          // Индексируем только библиотечные docId (UUID.ext), чтобы:
          // - не засорять usage-index мусором
          // - не ломать GC/фильтры
          if (!isValidDocId(docId)) continue;

          const arr = usageByDocId.get(docId) || [];
          arr.push(nodeId);
          usageByDocId.set(docId, arr);
        }
      }

      // Записываем usage для этого canvasId.
      // Важно: replaceCanvasUsage сам:
      // - дедупает nodeIds,
      // - удаляет старые записи canvasId (но у нас индекс пустой — это просто).
      replaceCanvasUsage(index, canvasId, usageByDocId);

      canvasesProcessed += 1;

      // Счётчик ссылок — чисто UX/диагностика.
      for (const ids of usageByDocId.values()) {
        totalLinks += Array.isArray(ids) ? ids.length : 0;
      }
    }

    // Пишем usage-index одним атомарным write.
    await writeUsageIndex(index);

    return NextResponse.json({
      success: true,
      canvasesProcessed,
      canvasesSkipped,
      totalLinks,
      updatedAt: index.updatedAt,
    });
  } catch (error) {
    console.error('[Library API] POST /api/library/reindex-usage error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось пересчитать usage-index', details: message }, { status: 500 });
  }
}
