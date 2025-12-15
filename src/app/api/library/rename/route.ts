/**
 * @file route.ts
 * @description API: POST /api/library/rename
 *
 * Переименовывает документ в библиотеке.
 *
 * Важно:
 * - docId НЕ меняется
 * - меняется только поле `name` (display name)
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { readLibraryIndex, writeLibraryIndex, renameDoc } from '@/lib/libraryIndex';
import { normalizeDocDisplayName } from '@/lib/libraryFs';
import { readUsageIndex, getUsageLinksForDoc } from '@/lib/libraryUsageIndex';
import { getCanvasFilePath } from '@/lib/paths';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';
import type { NodeAttachment } from '@/types/canvas';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { docId?: unknown; name?: unknown };
    const docId = String(body?.docId || '').trim();
    const name = normalizeDocDisplayName(String(body?.name || '').trim());

    if (!docId) return NextResponse.json({ error: 'docId обязателен' }, { status: 400 });
    assertDocIdOrThrow(docId);
    if (!name) return NextResponse.json({ error: 'name обязателен' }, { status: 400 });

    const index = await readLibraryIndex();
    const updated = renameDoc(index, docId, name);
    if (!updated) return NextResponse.json({ error: 'Документ не найден', docId }, { status: 404 });

    await writeLibraryIndex(index);

    // =========================================================================
    // RENAME-PROPAGATION: обновляем подписи в canvas.json по usage-index
    // =========================================================================
    //
    // Требование из текущего todo:
    // - при rename документа (меняется только display name) нужно обновить подписи в карточках,
    //   которые уже прикрепили этот docId в node.data.attachments[].
    //
    // Почему это нужно:
    // - в ноде мы храним `NodeAttachment.originalName` для отображения в UI (миниатюры/tooltip/детали),
    // - docId остаётся стабильным, поэтому ссылки не "ломаются",
    // - но подпись становится устаревшей, если rename произошёл в FileManager.
    //
    // Почему делаем это на сервере:
    // - server уже знает "источник истины" (library-index.json) и новое имя,
    // - server имеет usage-index.json (docId -> canvasId/nodeIds),
    // - поэтому клиенту НЕ нужно:
    //   - перебирать все холсты,
    //   - грузить/патчить canvas.json снаружи,
    //   - и решать гонки.
    //
    // Ключевая семантика (ВАЖНО):
    // - rename НЕ меняет байты файла, значит НЕ меняется "контекст" вложения.
    // - поэтому мы НАМЕРЕННО НЕ выставляем isStale и не трогаем fileHash/fileUpdatedAt.
    //
    // Это best-effort:
    // - если один из холстов повреждён/удалён — rename документа всё равно успешен,
    //   а мы просто логируем предупреждение.
    //
    // Дополнение (Todo D):
    // - мы также возвращаем `touched` в ответе API, чтобы клиент мог мгновенно
    //   пропатчить АКТИВНЫЙ холст в памяти (без ожидания перезагрузки canvas).
    let touched: Array<{ canvasId: string; nodeIds: string[] }> = [];
    try {
      const usageIndex = await readUsageIndex();
      const usageLinks = getUsageLinksForDoc(usageIndex, docId);
      touched = (usageLinks || []).map((x) => ({ canvasId: x.canvasId, nodeIds: x.nodeIds }));
      const canvasIds = Array.from(new Set((usageLinks || []).map((x) => String(x.canvasId || '').trim()).filter(Boolean)));

      for (const canvasId of canvasIds) {
        const canvasPath = getCanvasFilePath(canvasId);

        // ---------------------------------------------------------------------
        // 1) Читаем canvas.json
        // ---------------------------------------------------------------------
        let raw: string;
        try {
          raw = await fs.readFile(canvasPath, 'utf-8');
        } catch {
          // Холст мог быть удалён, не создан, или недоступен — пропускаем.
          continue;
        }

        // Важно: JSON.parse возвращает unknown по смыслу.
        // Мы избегаем `any`, чтобы не выключать типовую безопасность случайно.
        let canvasJson: unknown;
        try {
          canvasJson = JSON.parse(raw);
        } catch {
          // Повреждённый JSON — пропускаем.
          continue;
        }

        if (!canvasJson || typeof canvasJson !== 'object') continue;
        const canvasObj = canvasJson as { nodes?: unknown };
        if (!Array.isArray(canvasObj.nodes)) continue;

        // ---------------------------------------------------------------------
        // 2) Патчим все ноды, где attachments содержит этот docId
        // ---------------------------------------------------------------------
        const ts = Date.now();
        let changed = false;

        for (const n of canvasObj.nodes) {
          if (!n || typeof n !== 'object') continue;
          const data = n.data && typeof n.data === 'object' ? n.data : null;
          if (!data) continue;

          const atts = Array.isArray(data.attachments) ? (data.attachments as NodeAttachment[]) : null;
          if (!atts || atts.length === 0) continue;

          let touchedThisNode = false;
          for (const a of atts) {
            if (!a || typeof a !== 'object') continue;
            if (a.attachmentId !== docId) continue;

            // Обновляем ТОЛЬКО отображаемое имя.
            // Все остальные поля (mime/size/hash/updatedAt) относятся к контенту файла,
            // а rename контент не меняет.
            a.originalName = updated.name;
            touchedThisNode = true;
            changed = true;
          }

          if (touchedThisNode) {
            // Обновляем updatedAt ноды как "мы изменили сериализуемые данные".
            // Это НЕ означает stale и НЕ требует регенерации ответа.
            data.updatedAt = ts;
          }
        }

        // ---------------------------------------------------------------------
        // 3) Записываем обратно только если реально меняли JSON
        // ---------------------------------------------------------------------
        if (changed) {
          await fs.writeFile(canvasPath, JSON.stringify(canvasJson, null, 2), 'utf-8');
        }
      }
    } catch (patchErr) {
      console.warn('[Library API] rename: не удалось пропатчить canvases (best-effort):', patchErr);
    }

    return NextResponse.json({ success: true, doc: updated, touched });
  } catch (error) {
    console.error('[Library API] POST /api/library/rename error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось переименовать документ', details: message }, { status: 500 });
  }
}

