/**
 * @file route.ts
 * @description API: POST /api/library/folders/delete
 *
 * Удаляет папку (только если она пустая).
 *
 * MVP-правило безопасности:
 * - нельзя удалить папку, если:
 *   - у неё есть подпапки
 *   - в ней есть документы (не в корзине)
 */

import { NextRequest, NextResponse } from 'next/server';
import { readLibraryIndex, writeLibraryIndex, deleteFolderIfEmpty } from '@/lib/libraryIndex';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { folderId?: unknown };
    const folderId = String(body?.folderId || '').trim();
    if (!folderId) return NextResponse.json({ error: 'folderId обязателен' }, { status: 400 });

    const index = await readLibraryIndex();
    const res = deleteFolderIfEmpty(index, folderId);
    if (!res.deleted) {
      // 409 — конфликт бизнес-логики (папка не пустая)
      const status = res.reason === 'FOLDER_NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ success: false, ...res, folderId }, { status });
    }

    await writeLibraryIndex(index);
    return NextResponse.json({ success: true, folderId });
  } catch (error) {
    console.error('[Library API] POST /api/library/folders/delete error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось удалить папку', details: message }, { status: 500 });
  }
}

