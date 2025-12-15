/**
 * @file route.ts
 * @description API: POST /api/library/folders/create
 *
 * Создаёт папку в дереве библиотеки.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readLibraryIndex, writeLibraryIndex, createFolder } from '@/lib/libraryIndex';
import { normalizeDocDisplayName } from '@/lib/libraryFs';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { name?: unknown; parentId?: unknown };
    const name = normalizeDocDisplayName(String(body?.name || '').trim());
    const parentIdRaw = body?.parentId;
    const parentId = parentIdRaw == null || String(parentIdRaw).trim() === '' ? null : String(parentIdRaw).trim();

    if (!name) return NextResponse.json({ error: 'name обязателен' }, { status: 400 });

    const index = await readLibraryIndex();

    if (parentId && !index.folders.some((f) => f.id === parentId)) {
      return NextResponse.json({ error: 'parentId не найден', parentId }, { status: 400 });
    }

    const folder = createFolder(index, { name, parentId });
    await writeLibraryIndex(index);
    return NextResponse.json({ success: true, folder });
  } catch (error) {
    console.error('[Library API] POST /api/library/folders/create error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось создать папку', details: message }, { status: 500 });
  }
}

