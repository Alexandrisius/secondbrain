/**
 * @file route.ts
 * @description API для отдачи (preview) и удаления конкретного файла вложения.
 *
 * URL:
 * - GET    /api/attachments/<canvasId>/<attachmentId>   → отдаёт файл
 * - DELETE /api/attachments/<canvasId>/<attachmentId>   → удаляет файл
 *
 * КРИТИЧНО (безопасность):
 * - canvasId и attachmentId валидируются regex'ами (никаких ../)
 * - путь к файлу строится через getAttachmentFilePath()
 * - при выдаче ставим X-Content-Type-Options: nosniff
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileTypeFromBuffer } from 'file-type';
import { moveAttachmentToTrash, readAttachmentFile } from '@/lib/attachmentsFs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// =============================================================================
// VALIDATION
// =============================================================================

// canvasId генерируется приложением (canvas-<ts>-<rand>), поэтому достаточно:
// - буквы/цифры/подчёркивание/дефис
const CANVAS_ID_RE = /^[a-zA-Z0-9_-]+$/;

// attachmentId = UUIDv4 + ".ext"
// Пример: 2f6c2e1a-0000-4000-8000-aaaaaaaaaaaa.png
const ATTACHMENT_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]+$/;

/**
 * Простой mime fallback по расширению, если file-type не распознал формат.
 *
 * ВАЖНО:
 * - для изображений чаще всего распознавание сработает
 * - для текстов file-type часто возвращает undefined, поэтому fallback обязателен
 */
const mimeFromExt = (attachmentId: string): string => {
  const ext = attachmentId.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'yml':
    case 'yaml':
      return 'text/yaml; charset=utf-8';
    case 'md':
    case 'markdown':
      return 'text/markdown; charset=utf-8';
    default:
      return 'text/plain; charset=utf-8';
  }
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { canvasId: string; attachmentId: string } }
) {
  try {
    const { canvasId, attachmentId } = params;

    // -------------------------------------------------------------------------
    // Валидация параметров (anti path traversal)
    // -------------------------------------------------------------------------
    if (!CANVAS_ID_RE.test(canvasId)) {
      return NextResponse.json({ error: 'Некорректный canvasId' }, { status: 400 });
    }
    if (!ATTACHMENT_ID_RE.test(attachmentId)) {
      return NextResponse.json({ error: 'Некорректный attachmentId' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // Читаем файл
    // -------------------------------------------------------------------------
    //
    // КРИТИЧНО (undo/redo):
    // - При удалении "последней ссылки" файл может быть перенесён в `.trash` (soft-delete).
    // - Если пользователь сделал undo и ссылка вернулась, файл физически "должен" снова появиться.
    // - Поэтому при чтении делаем auto-restore: если live файла нет, но он есть в `.trash`,
    //   мы переносим его обратно и продолжаем работу.
    let restoredFromTrash = false;
    let buf: Buffer;
    try {
      const r = await readAttachmentFile(canvasId, attachmentId);
      restoredFromTrash = r.restoredFromTrash;
      buf = r.buf;
    } catch (error) {
      // Если файла нет ни в live, ни в trash — 404, иначе 500
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        return NextResponse.json({ error: 'Файл не найден' }, { status: 404 });
      }
      throw error;
    }

    // Пытаемся определить “реальный” MIME.
    // Для текстов file-type чаще вернёт undefined, поэтому fallback.
    const detected = await fileTypeFromBuffer(buf);
    const contentType = detected?.mime || mimeFromExt(attachmentId);

    // -------------------------------------------------------------------------
    // Отдаём файл
    // -------------------------------------------------------------------------
    //
    // Content-Disposition:
    // - inline: браузер пытается показать (картинка/текст) вместо скачивания
    // - filename: здесь используем attachmentId, т.к. оригинальное имя хранится в canvas JSON,
    //   но этот endpoint намеренно не делает “поиск метаданных” (быстрее и проще).
    // ВАЖНО (типизация Next.js/TS + Web Response API):
    // - В Node.js `Buffer` является подтипом `Uint8Array`, но в типах он часто выглядит как
    //   `Buffer<ArrayBufferLike>` (из-за того, что под капотом может быть как `ArrayBuffer`,
    //   так и `SharedArrayBuffer`).
    // - Конструктор `Response` (Web API) принимает `BodyInit`, где для бинарных данных
    //   ожидаются `ArrayBuffer`/`ArrayBufferView` и т.п.
    // - В некоторых конфигурациях TypeScript (что и проявилось у тебя на `next build`)
    //   `Buffer<ArrayBufferLike>` НЕ считается совместимым с `BodyInit`.
    //
    // Поэтому здесь явно конвертируем `Buffer` в "чистый" `Uint8Array` (копия),
    // который гарантированно подходит под `BodyInit` и снимает проблему компиляции.
    const body = new Uint8Array(buf);

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${attachmentId}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        // Для отладки: если файл был восстановлен из корзины, можно увидеть это в DevTools.
        ...(restoredFromTrash ? { 'X-Attachment-Restored-From-Trash': '1' } : {}),
      },
    });
  } catch (error) {
    console.error('[Attachments API] GET error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Не удалось прочитать файл', details: message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { canvasId: string; attachmentId: string } }
) {
  try {
    const { canvasId, attachmentId } = params;

    if (!CANVAS_ID_RE.test(canvasId)) {
      return NextResponse.json({ error: 'Некорректный canvasId' }, { status: 400 });
    }
    if (!ATTACHMENT_ID_RE.test(attachmentId)) {
      return NextResponse.json({ error: 'Некорректный attachmentId' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // SOFT-DELETE (корзина) вместо физического удаления
    // -------------------------------------------------------------------------
    //
    // КРИТИЧНО:
    // - Мы НЕ делаем fs.unlink().
    // - Вместо этого переносим файл в `.trash`.
    // - Это гарантирует, что undo/redo не сломает вложения: если ссылка вернётся,
    //   серверные руты смогут восстановить файл автоматически.
    //
    // Важно про индекс:
    // - Раньше мы чистили attachments-index.json, но при soft-delete это не обязательно.
    // - Индекс нужен для будущего файлового менеджера и анализа файлов (summary/описание изображения).
    // - “Окончательная” очистка индекса должна происходить в GC (см. отдельный endpoint).
    const result = await moveAttachmentToTrash(canvasId, attachmentId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[Attachments API] DELETE error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Не удалось удалить файл', details: message },
      { status: 500 }
    );
  }
}

