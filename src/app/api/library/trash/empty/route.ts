/**
 * @file route.ts
 * @description API: POST /api/library/trash/empty
 *
 * "Очистить корзину" — удаляет навсегда документы, которые:
 * - находятся в корзине (trashedAt установлено)
 *
 * ВАЖНО (изменение логики):
 * - Раньше: удаляли только документы БЕЗ ссылок.
 * - Теперь: СНАЧАЛА делаем unlink (удаляем все ссылки), ЗАТЕМ удаляем файл.
 * - Это обеспечивает: "нажимаю Empty Trash → всё само чистится, ссылки тоже исчезают"
 *
 * Возвращаемые данные:
 * - `touched`: объединённый массив {canvasId, nodeIds} — какие холсты/ноды были изменены.
 *   Клиент использует это для мгновенного патча активного холста в памяти.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { readLibraryIndex, writeLibraryIndex } from '@/lib/libraryIndex';
import { readUsageIndex, writeUsageIndex } from '@/lib/libraryUsageIndex';
import { unlinkDocsFromAllCanvases } from '@/lib/libraryUnlink';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  try {
    const [index, usage] = await Promise.all([readLibraryIndex(), readUsageIndex()]);

    // Собираем все документы в корзине (независимо от наличия ссылок)
    // Ссылки будут удалены через unlink перед удалением файла
    const docsToDelete = index.docs.filter((d) => Boolean(d.trashedAt));

    if (docsToDelete.length === 0) {
      return NextResponse.json({ success: true, deletedCount: 0, deletedDocIds: [], touched: [] });
    }

    const deletedDocIds = docsToDelete.map((d) => d.docId);

    // =========================================================================
    // UNLINK: Удаляем все ссылки на эти docIds из холстов ПЕРЕД удалением файлов
    // =========================================================================
    //
    // Новая семантика (по плану):
    // - "даже если документ был в корзине и где-то ещё ссылался — я нажимаю Empty
    //   и всё само чистится: ссылки исчезают, документ удаляется"
    //
    // Важно:
    // - unlinkDocsFromAllCanvases сама обновляет usage-index
    // - После unlink все ссылки гарантированно удалены
    const unlinkResult = await unlinkDocsFromAllCanvases(deletedDocIds);
    const touched = unlinkResult.touched;

    // Удаляем файлы с диска
    for (const d of docsToDelete) {
      // Файл может лежать как в .trash (ожидаемо), так и (в edge-case) в files.
      const p1 = getLibraryTrashFilePath(d.docId);
      const p2 = getLibraryFilePath(d.docId);

      try {
        await fs.rm(p1, { force: true });
      } catch {
        // ignore
      }
      try {
        await fs.rm(p2, { force: true });
      } catch {
        // ignore
      }

      // Чистим usage-index (best-effort) на случай "битых" данных
      // (unlinkDocsFromAllCanvases уже должен был это сделать, но подстраховываемся)
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
      // Возвращаем touched для клиента
      touched,
    });
  } catch (error) {
    console.error('[Library API] POST /api/library/trash/empty error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось очистить корзину', details: message }, { status: 500 });
  }
}
