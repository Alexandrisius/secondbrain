/**
 * @file route.ts
 * @description API: POST /api/library/trash/restore
 *
 * Восстанавливает документ из корзины.
 *
 * Поведение:
 * - удаляем trashedAt из library-index.json
 * - физически переносим файл: data/library/.trash/<docId> → data/library/files/<docId>
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { ensureLibraryDirectories, readLibraryIndex, restoreDoc, writeLibraryIndex } from '@/lib/libraryIndex';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
        // fallthrough
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

    if (!doc.trashedAt) {
      return NextResponse.json({ success: true, doc, alreadyRestored: true });
    }

    const from = getLibraryTrashFilePath(docId);
    const to = getLibraryFilePath(docId);
    const moveResult = await moveFileOverwrite(from, to);

    // Если файл отсутствует в корзине, мы всё равно можем снять флаг trashedAt
    // (на случай “битого” состояния). UI покажет, что файл не найден при попытке открыть.
    restoreDoc(index, docId);
    await writeLibraryIndex(index);

    return NextResponse.json({ success: true, doc: index.docs.find((d) => d.docId === docId), fileMoved: moveResult.moved, fileMissing: moveResult.missing });
  } catch (error) {
    console.error('[Library API] POST /api/library/trash/restore error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось восстановить документ', details: message }, { status: 500 });
  }
}

