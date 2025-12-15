/**
 * @file route.ts
 * @description API: POST /api/library/move
 *
 * Перемещает документ между папками библиотеки (только метаданные).
 *
 * Важно:
 * - файл на диске НЕ перемещается (он всегда лежит в data/library/files/<docId>),
 * - перемещается только "виртуальное" расположение в дереве папок (folderId).
 */

import { NextRequest, NextResponse } from 'next/server';
import { readLibraryIndex, writeLibraryIndex, moveDoc } from '@/lib/libraryIndex';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { docId?: unknown; folderId?: unknown };
    const docId = String(body?.docId || '').trim();
    const folderIdRaw = body?.folderId;

    if (!docId) return NextResponse.json({ error: 'docId обязателен' }, { status: 400 });
    assertDocIdOrThrow(docId);

    // folderId:
    // - null/'' => root
    // - string => должна существовать
    const folderId =
      folderIdRaw == null || String(folderIdRaw).trim() === ''
        ? null
        : String(folderIdRaw).trim();

    const index = await readLibraryIndex();
    if (folderId && !index.folders.some((f) => f.id === folderId)) {
      return NextResponse.json({ error: 'folderId не найден', folderId }, { status: 400 });
    }

    const updated = moveDoc(index, docId, folderId);
    if (!updated) return NextResponse.json({ error: 'Документ не найден', docId }, { status: 404 });

    await writeLibraryIndex(index);
    return NextResponse.json({ success: true, doc: updated });
  } catch (error) {
    console.error('[Library API] POST /api/library/move error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось переместить документ', details: message }, { status: 500 });
  }
}

