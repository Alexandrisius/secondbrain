/**
 * @file route.ts
 * @description API: GET /api/library
 *
 * Это основной endpoint "список документов" для правого сайдбара.
 *
 * Важно:
 * - Мы делаем /api/library как "канонический" список (как в плане),
 * - А /api/library/list оставляем как алиас (для совместимости/экспериментов).
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildLibraryListResponse } from '@/app/api/library/_shared';

// =============================================================================
// NEXT.JS ROUTE RUNTIME CONFIG
// =============================================================================
//
// ВАЖНО (почему это объявлено именно здесь, а не через re-export):
// - Next.js (App Router) статически анализирует `export const runtime = '...'`
//   и `export const dynamic = '...'` ТОЛЬКО если это строковые литералы в
//   конкретном `route.ts`.
// - Если сделать `export { runtime } from './_shared'` или `export { runtime }`,
//   Next.js не распознаёт это как конфиг и выводит warning:
//   “can't recognize the exported runtime field ... not assigned to a string literal”.
//
// Поэтому для чистой сборки мы объявляем литералы прямо в файле endpoint'а.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await buildLibraryListResponse(request);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[Library API] GET /api/library error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось загрузить библиотеку', details: message }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

