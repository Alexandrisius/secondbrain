/**
 * @file route.ts
 * @description API: GET /api/library/text/[docId]
 *
 * Отдаёт текстовый документ (только для kind:text) как plain text.
 *
 * Зачем отдельный endpoint:
 * - превью/просмотр текста в UI без скачивания бинарника,
 * - возможная будущая пост-обработка (например, частичная выдача/пагинация).
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { readLibraryIndex } from '@/lib/libraryIndex';
import { decodeUtf8, looksLikeUtf8Text } from '@/lib/libraryFs';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { docId: string } }
): Promise<Response | NextResponse> {
  try {
    const docId = String(params.docId || '').trim();
    assertDocIdOrThrow(docId);

    const index = await readLibraryIndex();
    const doc = index.docs.find((d) => d.docId === docId) || null;
    if (!doc) return NextResponse.json({ error: 'Документ не найден', docId }, { status: 404 });
    if (doc.kind !== 'text') {
      return NextResponse.json({ error: 'Документ не является текстовым', docId, kind: doc.kind }, { status: 400 });
    }

    const p1 = doc.trashedAt ? getLibraryTrashFilePath(docId) : getLibraryFilePath(docId);
    const p2 = doc.trashedAt ? getLibraryFilePath(docId) : getLibraryTrashFilePath(docId);

    let buf: Buffer;
    try {
      buf = await fs.readFile(p1);
    } catch (e1: unknown) {
      const code =
        e1 && typeof e1 === 'object' && 'code' in e1 ? String((e1 as { code?: unknown }).code) : null;
      if (code !== 'ENOENT') throw e1;
      buf = await fs.readFile(p2);
    }

    // Доп. защита: даже если в индексе kind=text, файл мог быть повреждён.
    if (!looksLikeUtf8Text(buf)) {
      return NextResponse.json({ error: 'Файл не похож на UTF-8 текст', docId }, { status: 500 });
    }

    const text = decodeUtf8(buf);

    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[Library API] GET /api/library/text/[docId] error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось отдать текст', details: message }, { status: 500 });
  }
}

