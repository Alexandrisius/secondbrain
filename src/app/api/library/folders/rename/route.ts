/**
 * @file route.ts
 * @description API: POST /api/library/folders/rename
 *
 * Переименовывает папку.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readLibraryIndex, writeLibraryIndex, renameFolder } from '@/lib/libraryIndex';
import { normalizeDocDisplayName } from '@/lib/libraryFs';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { folderId?: unknown; name?: unknown };
    const folderId = String(body?.folderId || '').trim();
    const name = normalizeDocDisplayName(String(body?.name || '').trim());

    if (!folderId) return NextResponse.json({ error: 'folderId обязателен' }, { status: 400 });
    if (!name) return NextResponse.json({ error: 'name обязателен' }, { status: 400 });

    const index = await readLibraryIndex();
    const folder = renameFolder(index, folderId, name);
    if (!folder) return NextResponse.json({ error: 'Папка не найдена', folderId }, { status: 404 });

    await writeLibraryIndex(index);
    return NextResponse.json({ success: true, folder });
  } catch (error) {
    console.error('[Library API] POST /api/library/folders/rename error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось переименовать папку', details: message }, { status: 500 });
  }
}

