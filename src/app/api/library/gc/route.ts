/**
 * @file route.ts
 * @description API: POST /api/library/gc
 *
 * GC (garbage collector) — удаляет документы "навсегда".
 *
 * По умолчанию GC удаляет только документы из корзины (trashedAt установлен).
 * Это безопасное поведение, чтобы случайно не удалить "живые" документы.
 *
 * Опционально (для продвинутых сценариев) можно передать:
 * - includeLive: true
 * Тогда GC удалит и "живые" документы БЕЗ ссылок.
 *
 * ВАЖНО (изменение логики):
 * - Раньше: GC удалял документы только если у них нет ссылок.
 * - Теперь: СНАЧАЛА делаем unlink (удаляем все ссылки из холстов), ЗАТЕМ удаляем файл.
 * - Для документов в корзине: удаляем всегда (после unlink).
 * - Для "живых" документов (includeLive=true): удаляем только те, у которых
 *   изначально не было ссылок (мы не делаем unlink для живых документов с ссылками,
 *   чтобы не потерять данные случайно — для этого есть Trash).
 *
 * Возвращаемые данные:
 * - `touched`: объединённый массив {canvasId, nodeIds} — какие холсты/ноды были изменены.
 *   Клиент использует это для мгновенного патча активного холста в памяти.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { readLibraryIndex, writeLibraryIndex } from '@/lib/libraryIndex';
import { readUsageIndex, writeUsageIndex, hasAnyUsage } from '@/lib/libraryUsageIndex';
import { unlinkDocsFromAllCanvases } from '@/lib/libraryUnlink';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as { includeLive?: unknown };
    const includeLive = Boolean(body?.includeLive);

    const [index, usage] = await Promise.all([readLibraryIndex(), readUsageIndex()]);

    // =========================================================================
    // Определяем, какие документы можно удалить
    // =========================================================================
    //
    // Две категории:
    // 1) Документы в корзине (trashedAt установлен) — удаляем всегда (после unlink)
    // 2) "Живые" документы (includeLive=true) — удаляем только если нет ссылок
    //
    // Для категории (1) мы делаем unlink перед удалением.
    // Для категории (2) мы НЕ делаем unlink — только проверяем hasAnyUsage.
    // Это безопаснее: GC с includeLive=true — "продвинутая" операция,
    // и мы не хотим случайно потерять ссылки у живых документов.

    const trashedDocs = index.docs.filter((d) => Boolean(d.trashedAt));
    const liveDocs = includeLive
      ? index.docs.filter((d) => !d.trashedAt && !hasAnyUsage(usage, d.docId))
      : [];

    const docsToDelete = [...trashedDocs, ...liveDocs];

    if (docsToDelete.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0, deletedDocIds: [], touched: [], includeLive });
    }

    // =========================================================================
    // UNLINK: Удаляем все ссылки на документы из корзины из холстов
    // =========================================================================
    //
    // Для trashedDocs делаем unlink (на случай, если ссылки остались).
    // Для liveDocs — НЕ делаем unlink (мы уже проверили, что ссылок нет).
    const trashedDocIds = trashedDocs.map((d) => d.docId);
    let touched: Array<{ canvasId: string; nodeIds: string[] }> = [];

    if (trashedDocIds.length > 0) {
      const unlinkResult = await unlinkDocsFromAllCanvases(trashedDocIds);
      touched = unlinkResult.touched;
    }

    const deletedDocIds: string[] = [];

    // Удаляем файлы с диска
    for (const d of docsToDelete) {
      const pTrash = getLibraryTrashFilePath(d.docId);
      const pLive = getLibraryFilePath(d.docId);

      // Удаляем оба пути (best-effort), чтобы покрыть edge-case "файл лежит не там".
      try {
        await fs.rm(pTrash, { force: true });
      } catch {
        // ignore
      }
      try {
        await fs.rm(pLive, { force: true });
      } catch {
        // ignore
      }

      deletedDocIds.push(d.docId);

      // Чистим usage-index (best-effort)
      if (usage.byDocId[d.docId]) {
        delete usage.byDocId[d.docId];
      }
    }

    // Удаляем записи из library-index.json
    index.docs = index.docs.filter((d) => !deletedDocIds.includes(d.docId));

    await Promise.all([writeLibraryIndex(index), writeUsageIndex(usage)]);

    return NextResponse.json({
      success: true,
      deletedCount: deletedDocIds.length,
      deletedDocIds,
      includeLive,
      // Возвращаем touched для клиента
      touched,
    });
  } catch (error) {
    console.error('[Library API] POST /api/library/gc error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось выполнить GC', details: message }, { status: 500 });
  }
}
