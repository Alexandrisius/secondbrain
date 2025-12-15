/**
 * @file route.ts
 * @description API: POST /api/library/upload
 *
 * Загружает один или несколько файлов в глобальную библиотеку документов.
 *
 * Формат запроса: multipart/form-data
 * - files: File[] (ключ "files", можно несколько)
 * - folderId?: string (null/empty = root)
 *
 * Результат:
 * - создаём docId (UUID + ext)
 * - считаем fileHash (SHA-256)
 * - сохраняем файл в data/library/files/<docId>
 * - добавляем запись в library-index.json
 *
 * Важно:
 * - Здесь мы делаем только “дешёвые” вычисления:
 *   - excerpt для текста (без LLM)
 * - LLM-анализ (summary / image.description) можно добавить позже отдельным endpoint'ом.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import { getLibraryFilePath } from '@/lib/paths';
import {
  ensureLibraryDirectories,
  readLibraryIndex,
  upsertDoc,
  writeLibraryIndex,
  type LibraryDoc,
} from '@/lib/libraryIndex';
import {
  buildTextExcerpt,
  computeSha256Hex,
  decodeUtf8,
  detectLibraryFileKind,
  normalizeDocDisplayName,
} from '@/lib/libraryFs';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================================
// LIMITS (MVP)
// =============================================================================
//
// Мы держим лимиты такими же, как в прежнем слое вложений:
// - текст: 1MB
// - изображение: 3MB
//
// Это:
// - хорошо для UX (не блокируем UI огромными файлами),
// - достаточно для большинства "заметок/скриншотов".

const MAX_TEXT_BYTES = 1 * 1024 * 1024; // 1MB
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // -------------------------------------------------------------------------
    // 1) Парсим multipart/form-data
    // -------------------------------------------------------------------------
    const form = await request.formData();
    const folderIdRaw = form.get('folderId');
    const folderId = folderIdRaw == null || String(folderIdRaw).trim() === '' ? null : String(folderIdRaw).trim();
    const files = form.getAll('files');

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'files обязателен (хотя бы один файл)' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // 2) Готовим директории + читаем индекс
    // -------------------------------------------------------------------------
    await ensureLibraryDirectories();
    const index = await readLibraryIndex();

    // folderId должен существовать (если задан).
    if (folderId && !index.folders.some((f) => f.id === folderId)) {
      return NextResponse.json({ error: 'folderId не найден', folderId }, { status: 400 });
    }

    const createdDocs: LibraryDoc[] = [];
    const ts = Date.now();

    // -------------------------------------------------------------------------
    // 3) Обрабатываем каждый файл
    // -------------------------------------------------------------------------
    for (const entry of files) {
      if (!(entry instanceof File)) continue;

      const originalName = normalizeDocDisplayName(entry.name);
      const declaredMime = String(entry.type || '').toLowerCase().trim();

      const ab = await entry.arrayBuffer();
      const buf = Buffer.from(ab);
      const sizeBytes = buf.byteLength;

      if (sizeBytes <= 0) {
        return NextResponse.json({ error: `Файл "${originalName}" пустой` }, { status: 400 });
      }

      const detected = await detectLibraryFileKind({ originalName, declaredMime, buf });

      if (detected.kind === 'image' && sizeBytes > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          {
            error: `Изображение "${originalName}" слишком большое`,
            details: `Максимум: ${MAX_IMAGE_BYTES} bytes`,
          },
          { status: 413 }
        );
      }
      if (detected.kind === 'text' && sizeBytes > MAX_TEXT_BYTES) {
        return NextResponse.json(
          {
            error: `Текстовый файл "${originalName}" слишком большой`,
            details: `Максимум: ${MAX_TEXT_BYTES} bytes`,
          },
          { status: 413 }
        );
      }

      // docId = UUID + '.' + ext (ext берём из детектора)
      const docId = `${crypto.randomUUID()}.${detected.ext}`;
      const fileHash = computeSha256Hex(buf);

      // -----------------------------------------------------------------------
      // 3.1) Сохраняем файл на диск
      // -----------------------------------------------------------------------
      const filePath = getLibraryFilePath(docId);
      await fs.writeFile(filePath, buf);

      // -----------------------------------------------------------------------
      // 3.2) Формируем запись в индексе
      // -----------------------------------------------------------------------
      const doc: LibraryDoc = {
        docId,
        name: originalName,
        folderId,
        kind: detected.kind,
        mime: detected.mime,
        sizeBytes,
        fileHash,
        fileUpdatedAt: ts,
        createdAt: ts,
        analysis:
          detected.kind === 'text'
            ? {
                // “дешёвое” превью: excerpt
                excerpt: buildTextExcerpt(decodeUtf8(buf)),
              }
            : undefined,
      };

      upsertDoc(index, doc);
      createdDocs.push(doc);
    }

    // -------------------------------------------------------------------------
    // 4) Сохраняем индекс одним write (меньше IO)
    // -------------------------------------------------------------------------
    // (Пишем pretty JSON через writeLibraryIndex внутри writeLibraryIndex.)
    // Здесь мы пишем напрямую через helper, чтобы не плодить циклы.
    // Важно: при падении записи индекса файлы уже будут на диске — это “best-effort”,
    // но для локального приложения приемлемо (UI сможет пересканировать/починить позже).
    // TODO (future): можно добавить транзакционность (staging + commit).
    //
    // Сейчас делаем простую запись.
    await writeLibraryIndex(index);

    return NextResponse.json({ success: true, docs: createdDocs });
  } catch (error) {
    console.error('[Library API] POST /api/library/upload error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось загрузить файл в библиотеку', details: message }, { status: 500 });
  }
}

