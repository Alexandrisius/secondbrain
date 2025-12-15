/**
 * @file route.ts
 * @description API: POST /api/library/replace
 *
 * Заменяет содержимое существующего docId, НЕ меняя docId.
 *
 * Формат запроса: multipart/form-data
 * - docId: string (обязательно)
 * - file: File (обязательно)
 *
 * Правила:
 * - docId остаётся прежним
 * - fileHash / fileUpdatedAt обновляются
 * - analysis (summary/image.description) сбрасывается, т.к. относится к старому fileHash
 * - ext у docId ДОЛЖНО совпадать с новым контентом (защита от “docId.png → заменить на .md”)
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import {
  readLibraryIndex,
  writeLibraryIndex,
  type LibraryDocAnalysis,
} from '@/lib/libraryIndex';
import { readUsageIndex, getUsageLinksForDoc } from '@/lib/libraryUsageIndex';
import { getCanvasFilePath } from '@/lib/paths';
import {
  buildTextExcerpt,
  computeSha256Hex,
  decodeUtf8,
  detectLibraryFileKind,
  normalizeDocDisplayName,
} from '@/lib/libraryFs';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';
import type { NodeAttachment } from '@/types/canvas';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getDocExt = (docId: string): string => {
  const ext = String(docId || '').split('.').pop() || '';
  return ext.toLowerCase();
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const form = await request.formData();
    const docId = String(form.get('docId') || '').trim();
    const file = form.get('file');

    if (!docId) return NextResponse.json({ error: 'docId обязателен' }, { status: 400 });
    assertDocIdOrThrow(docId);

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file обязателен (multipart File)' }, { status: 400 });
    }

    const index = await readLibraryIndex();
    const doc = index.docs.find((d) => d.docId === docId) || null;
    if (!doc) return NextResponse.json({ error: 'Документ не найден', docId }, { status: 404 });

    const originalName = normalizeDocDisplayName(file.name);
    const declaredMime = String(file.type || '').toLowerCase().trim();

    const ab = await file.arrayBuffer();
    const buf = Buffer.from(ab);
    const sizeBytes = buf.byteLength;

    if (sizeBytes <= 0) {
      return NextResponse.json({ error: `Файл "${originalName}" пустой` }, { status: 400 });
    }

    const detected = await detectLibraryFileKind({ originalName, declaredMime, buf });
    const expectedExt = getDocExt(docId);
    if (detected.ext.toLowerCase() !== expectedExt) {
      return NextResponse.json(
        {
          error: 'Расширение docId не совпадает с новым содержимым файла',
          details: `docId ext=${expectedExt}, detected ext=${detected.ext}`,
        },
        { status: 400 }
      );
    }

    const newHash = computeSha256Hex(buf);
    if (doc.fileHash && doc.fileHash === newHash) {
      // Идемпотентность: контент не изменился → не трогаем updatedAt и не сбрасываем анализ.
      return NextResponse.json({ success: true, updated: false, doc });
    }

    const ts = Date.now();

    // Куда писать файл: если документ в корзине — заменяем версию в корзине.
    const pathPrimary = doc.trashedAt ? getLibraryTrashFilePath(docId) : getLibraryFilePath(docId);
    await fs.writeFile(pathPrimary, buf);

    // Обновляем метаданные документа.
    doc.kind = detected.kind;
    doc.mime = detected.mime;
    doc.sizeBytes = sizeBytes;
    doc.fileHash = newHash;
    doc.fileUpdatedAt = ts;

    // Сбрасываем анализ, который привязан к прошлой версии файла.
    // Оставляем только "дешёвый" excerpt (для текста), потому что он считается моментально и относится к новой версии.
    const nextAnalysis: LibraryDocAnalysis | undefined =
      detected.kind === 'text'
        ? {
            excerpt: buildTextExcerpt(decodeUtf8(buf)),
          }
        : undefined;
    doc.analysis = nextAnalysis;

    await writeLibraryIndex(index);

    // =========================================================================
    // STALE-PROPAGATION: обновляем все ссылки на docId в существующих холстах
    // =========================================================================
    //
    // Требование из плана/задачи:
    // - при replace документа:
    //   1) обновить snapshot метаданных во всех NodeAttachment (fileHash/fileUpdatedAt/mime/size/name/kind)
    //   2) выставить stale у всех затронутых карточек (где уже есть response)
    //
    // Почему делаем это на сервере:
    // - источник истины о "версии файла" находится в library-index.json,
    // - usage-index.json даёт обратные ссылки (какие холсты/ноды используют docId),
    // - клиенту не нужно "самому искать и чинить" все холсты.
    //
    // Важно:
    // - Это best-effort: если патчинг какого-то холста упал, сам replace документа
    //   всё равно считаем успешным (UX важнее).
    //
    // Дополнение (Todo D):
    // - возвращаем `touched` в ответе API, чтобы клиент мог мгновенно
    //   пропатчить АКТИВНЫЙ холст в памяти (без ожидания перезагрузки canvas).
    let touched: Array<{ canvasId: string; nodeIds: string[] }> = [];
    try {
      const usageIndex = await readUsageIndex();
      const usageLinks = getUsageLinksForDoc(usageIndex, docId);
      touched = (usageLinks || []).map((x) => ({ canvasId: x.canvasId, nodeIds: x.nodeIds }));

      // Уникальный список холстов, которые нужно пропатчить.
      // (usageLinks может содержать несколько записей, но canvasId уникален по определению.)
      const canvasIds = Array.from(new Set(usageLinks.map((x) => x.canvasId)));

      // Патчим каждый canvas.json, который использует docId.
      for (const canvasId of canvasIds) {
        const canvasPath = getCanvasFilePath(canvasId);
        let raw: string;
        try {
          raw = await fs.readFile(canvasPath, 'utf-8');
        } catch {
          // Холст мог быть удалён или ещё не создан — пропускаем.
          continue;
        }

        // Важно: JSON.parse возвращает unknown по смыслу.
        // Мы избегаем `any`, чтобы не выключать типовую безопасность случайно.
        let canvasJson: unknown;
        try {
          canvasJson = JSON.parse(raw);
        } catch {
          // Повреждённый canvas.json — пропускаем (best-effort).
          continue;
        }

        if (!canvasJson || typeof canvasJson !== 'object') continue;
        const canvasObj = canvasJson as { nodes?: unknown };
        if (!Array.isArray(canvasObj.nodes)) continue;

        const ts2 = Date.now();
        let changed = false;

        // Патчим все ноды, где есть attachmentId == docId
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

            // Обновляем snapshot метаданных
            a.kind = doc.kind;
            a.mime = doc.mime;
            a.sizeBytes = doc.sizeBytes;
            a.fileHash = doc.fileHash;
            a.fileUpdatedAt = doc.fileUpdatedAt;
            // Для глобальной библиотеки отображаемое имя живёт в doc.name
            a.originalName = doc.name;

            touchedThisNode = true;
            changed = true;
          }

          if (!touchedThisNode) continue;

          // =======================================================================
          // ССЫЛОЧНАЯ МОДЕЛЬ: НЕ копируем анализы в node.data
          // =======================================================================
          //
          // По новой архитектуре (Plan D):
          // - node.data.attachmentExcerpts/attachmentSummaries/attachmentImageDescriptions
          //   считаются LEGACY-полями.
          // - Источник истины — library-index.json (doc.analysis.*).
          // - UI и /api/chat читают анализ напрямую из библиотеки по docId.
          //
          // Поэтому мы:
          // - НЕ записываем "кеши" анализов в canvas.json,
          // - НО чистим устаревшие данные (если они остались с предыдущих версий),
          //   чтобы не было "залипших" состояний.
          const excerpts = data.attachmentExcerpts && typeof data.attachmentExcerpts === 'object'
            ? data.attachmentExcerpts as Record<string, unknown>
            : null;
          const summaries = data.attachmentSummaries && typeof data.attachmentSummaries === 'object'
            ? data.attachmentSummaries as Record<string, unknown>
            : null;
          const imageDescs = data.attachmentImageDescriptions && typeof data.attachmentImageDescriptions === 'object'
            ? data.attachmentImageDescriptions as Record<string, unknown>
            : null;

          // Чистим legacy-данные для этого docId (без записи новых)
          if (excerpts && docId in excerpts) {
            delete excerpts[docId];
            data.attachmentExcerpts = Object.keys(excerpts).length > 0 ? excerpts : undefined;
          }
          if (summaries && docId in summaries) {
            delete summaries[docId];
            data.attachmentSummaries = Object.keys(summaries).length > 0 ? summaries : undefined;
          }
          if (imageDescs && docId in imageDescs) {
            delete imageDescs[docId];
            data.attachmentImageDescriptions = Object.keys(imageDescs).length > 0 ? imageDescs : undefined;
          }

          // Ставим stale владельцу (если у него уже есть ответ).
          // Это соответствует логике приложения: stale имеет смысл только если есть что "перегенерировать".
          if (data.response) {
            data.isStale = true;
          }

          data.updatedAt = ts2;
        }

        if (changed) {
          // Перезаписываем canvas.json (best-effort pretty).
          await fs.writeFile(canvasPath, JSON.stringify(canvasJson, null, 2), 'utf-8');
        }
      }
    } catch (patchErr) {
      console.warn('[Library API] replace: не удалось пропатчить canvases (best-effort):', patchErr);
    }

    return NextResponse.json({ success: true, updated: true, doc, touched });
  } catch (error) {
    console.error('[Library API] POST /api/library/replace error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось заменить документ', details: message }, { status: 500 });
  }
}

