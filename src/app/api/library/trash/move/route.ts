/**
 * @file route.ts
 * @description API: POST /api/library/trash/move
 *
 * Перемещает документ в корзину (soft-delete).
 *
 * Поведение:
 * - СНАЧАЛА отвязываем все ссылки на docId из холстов (unlinkDocFromAllCanvases)
 * - выставляем `trashedAt` в library-index.json
 * - физически переносим файл: data/library/files/<docId> → data/library/.trash/<docId>
 *
 * Важно:
 * - Документ НЕ удаляется навсегда.
 * - Ссылки на документ УДАЛЯЮТСЯ сразу при перемещении в корзину.
 * - GC/Empty могут удалить навсегда только документы без ссылок (что гарантированно после unlink).
 *
 * Возвращаемые данные:
 * - `touched`: массив {canvasId, nodeIds} — какие холсты/ноды были изменены.
 *   Клиент использует это для мгновенного патча активного холста в памяти.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { ensureLibraryDirectories, readLibraryIndex, trashDoc, writeLibraryIndex } from '@/lib/libraryIndex';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';
import { unlinkDocFromAllCanvases } from '@/lib/libraryUnlink';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort rename с overwrite:
 * - если target существует — удаляем и повторяем rename
 * - если source не существует — возвращаем { moved:false, missing:true }
 */
async function moveFileOverwrite(from: string, to: string): Promise<{ moved: boolean; missing: boolean }> {
  try {
    await fs.rename(from, to);
    return { moved: true, missing: false };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : null;
    if (code === 'ENOENT') return { moved: false, missing: true };
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      try {
        await fs.rm(to, { force: true });
        await fs.rename(from, to);
        return { moved: true, missing: false };
      } catch {
        // fallthrough to throw below
      }
    }
    throw err;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { docId?: unknown };
    const docId = String(body?.docId || '').trim();
    if (!docId) return NextResponse.json({ error: 'docId обязателен' }, { status: 400 });
    assertDocIdOrThrow(docId);

    await ensureLibraryDirectories();

    const index = await readLibraryIndex();
    const doc = index.docs.find((d) => d.docId === docId) || null;
    if (!doc) return NextResponse.json({ error: 'Документ не найден', docId }, { status: 404 });

    if (doc.trashedAt) {
      // Уже в корзине — возвращаем пустой touched, т.к. ссылки уже были удалены ранее
      return NextResponse.json({ success: true, doc, alreadyTrashed: true, touched: [] });
    }

    // =========================================================================
    // UNLINK: Удаляем все ссылки на docId из холстов ПЕРЕД перемещением в корзину
    // =========================================================================
    //
    // Почему делаем unlink при trash, а не при empty/gc:
    // - Согласно плану: "при Trash автоматически убираем все ссылки на этот docId из карточек"
    // - Это обеспечивает предсказуемое поведение: документ в корзине = документ недоступен
    // - Пользователь сразу видит, что ссылки удалены (карточки помечаются stale)
    //
    // touched — какие холсты/ноды были изменены.
    // Клиент использует это для мгновенного патча активного холста в памяти.
    const unlinkResult = await unlinkDocFromAllCanvases(docId);
    const touched = unlinkResult.touched;

    const from = getLibraryFilePath(docId);
    const to = getLibraryTrashFilePath(docId);
    const moveResult = await moveFileOverwrite(from, to);

    // Даже если файла нет (missing:true), мы всё равно можем пометить документ как trashed:
    // - пользователь мог удалить файл руками,
    // - или это "битое" состояние, которое лучше явно отразить в UI.
    trashDoc(index, docId, Date.now());
    await writeLibraryIndex(index);

    return NextResponse.json({
      success: true,
      doc: index.docs.find((d) => d.docId === docId),
      fileMoved: moveResult.moved,
      fileMissing: moveResult.missing,
      // Возвращаем touched для клиента
      touched,
    });
  } catch (error) {
    console.error('[Library API] POST /api/library/trash/move error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось переместить документ в корзину', details: message }, { status: 500 });
  }
}

