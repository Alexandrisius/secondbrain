/**
 * @file route.ts
 * @description API: GET /api/library/file/[docId]
 *
 * Отдаёт бинарный файл документа из глобальной библиотеки.
 *
 * Важно (безопасность):
 * - docId валидируется (UUID + '.' + ext)
 * - ставим X-Content-Type-Options: nosniff
 */

import { NextResponse } from 'next/server';
import { serveLibraryFile } from '@/app/api/library/_shared';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { docId: string } }
): Promise<Response | NextResponse> {
  try {
    return await serveLibraryFile({ docId: params.docId });
  } catch (error) {
    console.error('[Library API] GET /api/library/file/[docId] error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось отдать файл', details: message }, { status: 500 });
  }
}

