/**
 * @file route.ts
 * @description API: GET /api/library/list
 *
 * Алиас для списка библиотеки.
 * Канонический endpoint: GET /api/library
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildLibraryListResponse } from '@/app/api/library/_shared';

// =============================================================================
// NEXT.JS ROUTE RUNTIME CONFIG
// =============================================================================
//
// Next.js распознаёт `runtime`/`dynamic` только как строковые литералы
// прямо в `route.ts`. Ре-экспорт из `_shared.ts` вызывает предупреждение
// и приводит к игнорированию нужного runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await buildLibraryListResponse(request);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[Library API] GET /api/library/list error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось загрузить библиотеку', details: message }, { status: 500 });
  }
}

