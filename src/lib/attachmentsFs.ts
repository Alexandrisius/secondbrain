/**
 * @file attachmentsFs.ts
 * @description Набор безопасных helper-функций для работы с файлами вложений на диске.
 *
 * Зачем этот модуль вообще нужен:
 * - В приложении вложения хранятся на диске (data/attachments/<canvasId>/<attachmentId>).
 * - В UI есть undo/redo (zundo), которое откатывает JSON холста, но НЕ откатывает FS.
 * - Поэтому физическое удаление файла при удалении "последней ссылки" приводит к багам:
 *   1) пользователь удалил последнюю карточку-ссылку,
 *   2) файл физически удалился,
 *   3) пользователь сделал undo → ссылка вернулась,
 *   4) файла уже нет → превью/чат/описание ломаются (ENOENT).
 *
 * Принцип исправления:
 * - DELETE вложения = "soft-delete": перенос файла в .trash (корзину),
 * - При попытке прочитать вложение:
 *   - если файла нет в основной папке, но он есть в .trash → восстановить.
 * - Полное удаление делаем отдельным процессом (GC) или будущим файловым менеджером.
 *
 * ВАЖНО (безопасность):
 * - Этот модуль НЕ валидирует canvasId/attachmentId.
 * - Валидация (regex) ДОЛЖНА выполняться в API routes ДО вызова этих функций,
 *   чтобы исключить path traversal и “неожиданные” пути.
 */
import { promises as fs } from 'fs';
import {
  getAttachmentFilePath,
  getAttachmentTrashFilePath,
  getCanvasAttachmentsDirectory,
  getCanvasAttachmentsTrashDirectory,
  getCanvasAttachmentsIndexPath,
} from '@/lib/paths';

// =============================================================================
// БАЗОВЫЕ УТИЛИТЫ
// =============================================================================

/**
 * Проверяет, существует ли файл по пути.
 *
 * Важно:
 * - fs.access() кроссплатформенно, но не гарантирует отсутствие гонок (race conditions).
 * - Нам этого достаточно, потому что дальше мы всё равно обрабатываем ошибки rename/readFile.
 */
const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Пытается сделать "безопасный" rename.
 *
 * На Windows rename может падать, если файл занят/антивирус держит handle.
 * В таких случаях мы не пытаемся “обходить” проблему, а возвращаем ошибку наверх,
 * чтобы caller мог решить (например, вернуть 500/409).
 */
const safeRename = async (from: string, to: string): Promise<void> => {
  await fs.rename(from, to);
};

// =============================================================================
// SOFT-DELETE / RESTORE
// =============================================================================

export type MoveToTrashResult = {
  /**
   * true если мы действительно переместили файл из "живой" папки в .trash.
   * false если файл не был перемещён (например, он уже был в .trash или отсутствовал).
   */
  moved: boolean;
  /** true если файл уже лежал в .trash (идемпотентность удаления). */
  alreadyTrashed: boolean;
  /** true если файл не найден ни в live, ни в .trash. */
  missingEverywhere: boolean;
};

/**
 * Перемещает вложение в "корзину" холста (soft-delete).
 *
 * Идемпотентность:
 * - Если файл уже в .trash → считаем операцию успешной.
 * - Если файла нет нигде → тоже не считаем это фатальной ошибкой (best-effort).
 *
 * Почему не удаляем физически:
 * - undo/redo может вернуть ссылку на attachmentId,
 *   а файл уже удалён → ошибки.
 */
export async function moveAttachmentToTrash(canvasId: string, attachmentId: string): Promise<MoveToTrashResult> {
  const livePath = getAttachmentFilePath(canvasId, attachmentId);
  const trashPath = getAttachmentTrashFilePath(canvasId, attachmentId);
  const trashDir = getCanvasAttachmentsTrashDirectory(canvasId);

  // Если уже в корзине — быстро выходим (идемпотентность).
  if (await exists(trashPath)) {
    return { moved: false, alreadyTrashed: true, missingEverywhere: false };
  }

  // Если live файла нет — возможно его уже удалили руками или он уже был в корзине.
  if (!(await exists(livePath))) {
    // Повторно проверяем корзину (на случай гонки между exists и rename).
    if (await exists(trashPath)) {
      return { moved: false, alreadyTrashed: true, missingEverywhere: false };
    }
    return { moved: false, alreadyTrashed: false, missingEverywhere: true };
  }

  // Гарантируем, что папка корзины существует.
  await fs.mkdir(trashDir, { recursive: true });

  try {
    await safeRename(livePath, trashPath);
    return { moved: true, alreadyTrashed: false, missingEverywhere: false };
  } catch (err: unknown) {
    // Если файл успели переместить параллельно — считаем успехом.
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : null;

    if (code === 'ENOENT' && (await exists(trashPath))) {
      return { moved: false, alreadyTrashed: true, missingEverywhere: false };
    }

    // Если в корзине уже появился файл с тем же именем (редкий кейс), пробуем "перезаписать":
    // - удаляем существующий trash-файл
    // - повторяем rename
    // Важно: корзина — не версия/архив, а безопасный буфер до GC.
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      try {
        await fs.unlink(trashPath);
        await safeRename(livePath, trashPath);
        return { moved: true, alreadyTrashed: false, missingEverywhere: false };
      } catch {
        // Если не получилось — отдадим исходную ошибку (ниже).
      }
    }

    throw err;
  }
}

export type EnsureAttachmentAvailableResult = {
  /** Абсолютный путь к файлу вложения в "живой" папке. */
  filePath: string;
  /** true если файл пришлось восстановить из .trash. */
  restoredFromTrash: boolean;
};

/**
 * Гарантирует, что файл вложения доступен в "живой" папке:
 * - если live файл есть → ок
 * - если live файла нет, но он есть в .trash → переносим обратно
 * - если нет нигде → кидаем ENOENT (caller решит, что делать: 404/skip)
 */
export async function ensureAttachmentAvailable(
  canvasId: string,
  attachmentId: string
): Promise<EnsureAttachmentAvailableResult> {
  const livePath = getAttachmentFilePath(canvasId, attachmentId);
  const trashPath = getAttachmentTrashFilePath(canvasId, attachmentId);

  // Быстрый путь: файл на месте.
  if (await exists(livePath)) {
    return { filePath: livePath, restoredFromTrash: false };
  }

  // Пытаемся восстановить из корзины.
  if (!(await exists(trashPath))) {
    // Нигде нет — возвращаем “как есть” (caller получит ENOENT при readFile).
    // Мы сознательно кидаем ENOENT сами, чтобы поведение было предсказуемым.
    const e = new Error('Attachment file not found');
    (e as NodeJS.ErrnoException).code = 'ENOENT';
    throw e;
  }

  // Возвращаем обратно в live.
  // Важно: папка live уже должна существовать, но на всякий случай создадим parent.
  // (В dev/edge случаях структура могла быть повреждена пользователем.)
  await fs.mkdir(getCanvasAttachmentsDirectory(canvasId), { recursive: true });

  try {
    await safeRename(trashPath, livePath);
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : null;

    // Если кто-то уже восстановил параллельно — это ок.
    if (code === 'ENOENT' && (await exists(livePath))) {
      return { filePath: livePath, restoredFromTrash: true };
    }

    // Windows-особенность:
    // - если livePath уже существует, rename может бросить EEXIST.
    // - Это может произойти при параллельных запросах (две вкладки UI, чат + превью и т.д.).
    // Мы считаем это успехом и (best-effort) пытаемся удалить “хвост” в корзине.
    if (code === 'EEXIST' && (await exists(livePath))) {
      try {
        await fs.unlink(trashPath);
      } catch {
        // ignore
      }
      return { filePath: livePath, restoredFromTrash: true };
    }

    throw err;
  }

  return { filePath: livePath, restoredFromTrash: true };
}

/**
 * Удобный helper: прочитать файл вложения (Buffer), автоматически восстанавливая из .trash при необходимости.
 */
export async function readAttachmentFile(canvasId: string, attachmentId: string): Promise<{ buf: Buffer; restoredFromTrash: boolean }> {
  const { filePath, restoredFromTrash } = await ensureAttachmentAvailable(canvasId, attachmentId);
  const buf = await fs.readFile(filePath);
  return { buf, restoredFromTrash };
}

// =============================================================================
// ATTACHMENTS INDEX: best-effort cleanup (для GC)
// =============================================================================

/**
 * Best-effort: удалить записи из attachments-index.json по списку attachmentId.
 *
 * Почему best-effort:
 * - индекс может отсутствовать (старые холсты),
 * - индекс может быть повреждён,
 * - формат мог измениться.
 *
 * Почему это нужно:
 * - Если мы “навсегда” удаляем файл (GC), а индекс оставить,
 *   то preflight по имени будет видеть "конфликт" на файл, которого уже нет.
 * - Впрочем, upload с replaceExisting может снова “оживить” attachmentId,
 *   но UX хуже, поэтому при GC лучше чистить индекс.
 */
export async function removeAttachmentIdsFromIndex(
  canvasId: string,
  attachmentIds: string[]
): Promise<{ changed: boolean; removedCount: number }> {
  if (!attachmentIds || attachmentIds.length === 0) return { changed: false, removedCount: 0 };

  const setToRemove = new Set(attachmentIds.map((x) => String(x || '').trim()).filter(Boolean));
  if (setToRemove.size === 0) return { changed: false, removedCount: 0 };

  const indexPath = getCanvasAttachmentsIndexPath(canvasId);
  try {
    const raw = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown; byNameKey?: unknown };
    const byNameKey =
      parsed && typeof parsed === 'object' && parsed.byNameKey && typeof parsed.byNameKey === 'object'
        ? (parsed.byNameKey as Record<string, unknown>)
        : null;

    if (!byNameKey) return { changed: false, removedCount: 0 };

    // Сохраняем исходную версию индекса (v1/v2) — не деградируем формат.
    const version =
      parsed && typeof parsed === 'object' && parsed.version === 2
        ? 2
        : 1;

    let changed = false;
    let removedCount = 0;

    for (const [nameKey, entry] of Object.entries(byNameKey)) {
      const eo = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
      const id = eo && typeof eo.attachmentId === 'string' ? eo.attachmentId : '';
      if (id && setToRemove.has(id)) {
        delete byNameKey[nameKey];
        changed = true;
        removedCount += 1;
      }
    }

    if (!changed) return { changed: false, removedCount: 0 };

    await fs.writeFile(indexPath, JSON.stringify({ version, byNameKey }, null, 2), 'utf-8');
    return { changed: true, removedCount };
  } catch {
    // ignore — best-effort
    return { changed: false, removedCount: 0 };
  }
}

