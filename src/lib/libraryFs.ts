/**
 * @file libraryFs.ts
 * @description Набор безопасных helper-функций для "глобальной библиотеки документов".
 *
 * Эта библиотека — новый слой хранения (data/library/**), который НЕ зависит от canvasId.
 *
 * Почему отдельный модуль:
 * - в API роутерах нельзя плодить копипасту с проверками/allowlist'ами,
 * - правила валидации форматов и вычисления hash должны быть едиными,
 * - здесь удобно держать "атомарную" (best-effort) запись JSON индексов.
 *
 * ВАЖНО (безопасность):
 * - Этот модуль содержит только “строительные блоки” (hash, проверка текста, allowlists, writeJsonAtomic).
 * - Проверку docId на “безопасный формат” мы делаем и здесь (для удобства),
 *   но ВСЁ РАВНО дублируем в API routes перед вызовом функций путей,
 *   чтобы исключить path traversal даже при неверном использовании.
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';

// =============================================================================
// ALLOWLISTS (MVP)
// =============================================================================
//
// Мы сознательно поддерживаем только:
// - изображения: png/jpg/webp/gif
// - простые тексты: txt/md/json/csv/yaml/yml
//
// Это ровно то, что согласовано в плане.
// Остальные форматы можно добавить позже (pdf/docx и т.п.).

export const LIB_ALLOWED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export const LIB_ALLOWED_TEXT_EXTS = new Set<string>([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'yaml',
  'yml',
]);

/**
 * MIME, который может прислать браузер для "текстового файла".
 *
 * Важно:
 * - Мы НЕ доверяем declaredMime целиком, но используем как подсказку.
 * - Для безопасности всё равно проверяем:
 *   - allowlist расширения,
 *   - heuristics "looksLikeUtf8Text".
 */
export const LIB_ALLOWED_TEXT_DECLARED_MIMES = new Set<string>([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/md',
  'application/json',
  'text/csv',
  'application/yaml',
  'text/yaml',
  // В браузерах часто так (особенно Windows) — дальше валидируем содержимое.
  'application/octet-stream',
]);

// =============================================================================
// docId validation
// =============================================================================
//
// По договорённости docId = UUIDv4 + '.' + ext
// Пример: 2f6c2e1a-1234-4cde-9ab0-0b19a9f2c0a1.png
//
// Почему мы НЕ используем имя файла как docId:
// - имя может содержать "../" и другие path traversal попытки,
// - имя может быть слишком длинным,
// - имя может коллизиться.

const UUID_V4_LIKE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// ext ограничиваем “безопасным” набором символов:
// - только буквы/цифры (без точек, слэшей и т.п.)
// - длину держим небольшой, но без излишней строгости
const SAFE_EXT = '[a-z0-9]{1,16}';

/**
 * Regex для docId (UUID + '.' + ext).
 *
 * Важно:
 * - Это не гарантирует “что ext соответствует MIME”, это делает серверная логика upload/replace.
 * - Но это гарантирует, что docId не содержит слэшей и не выйдет за пределы data/library/files.
 */
export const DOC_ID_REGEX = new RegExp(`^${UUID_V4_LIKE}\\.${SAFE_EXT}$`, 'i');

/**
 * Проверяет docId на ожидаемый безопасный формат.
 */
export function isValidDocId(docId: string): boolean {
  const id = String(docId || '').trim();
  if (!id) return false;
  return DOC_ID_REGEX.test(id);
}

// =============================================================================
// Text helpers (UTF-8 heuristics)
// =============================================================================

/**
 * Безопасно “вырезает” расширение из отображаемого имени файла.
 *
 * Важно:
 * - extension используется только для текстовых файлов как подсказка.
 * - Для изображений доверяем ТОЛЬКО magic bytes (file-type).
 */
export function getLowerExt(name: string): string | null {
  const idx = String(name || '').lastIndexOf('.');
  if (idx === -1) return null;
  const ext = String(name || '').slice(idx + 1).trim().toLowerCase();
  return ext ? ext : null;
}

/**
 * Проверяем, что буфер “похож на UTF-8 текст”.
 *
 * Почему это нужно:
 * - file-type для текстов часто возвращает undefined (и это нормально),
 * - но пользователь может подсунуть бинарник под видом .txt/.md/.json,
 * - эвристика “нет NUL + валидный UTF-8” резко снижает риск.
 */
export function looksLikeUtf8Text(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Декодирует UTF-8 (мы используем fatal:false, т.к. валидность проверена отдельно).
 */
export function decodeUtf8(buf: Buffer): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(buf);
}

/**
 * Быстрый excerpt для текста (fallback для превью/потомков).
 */
export function buildTextExcerpt(text: string, maxChars: number = 2000): string {
  const t = String(text || '').replace(/\u0000/g, '').trim();
  if (!t) return '';
  return t.length <= maxChars ? t : t.slice(0, maxChars) + '...';
}

// =============================================================================
// Hashing
// =============================================================================

/**
 * Считает SHA-256 (hex) для содержимого файла.
 *
 * Почему SHA-256:
 * - быстрый,
 * - стабильный,
 * - достаточно безопасный как "версия файла" (не крипто-авторизация, а дедуп/версионирование).
 */
export function computeSha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// =============================================================================
// File kind detection (image vs text)
// =============================================================================

export type LibraryDetectedFile =
  | {
      kind: 'image';
      mime: string;
      ext: string;
    }
  | {
      kind: 'text';
      mime: string;
      ext: string;
    };

/**
 * Определяет тип документа библиотеки (image|text) и нормализует mime/ext.
 *
 * Правила:
 * - Если magic bytes говорят, что это image (и mime в allowlist) → image.
 * - Иначе считаем, что это text, но только если:
 *   - расширение в allowlist,
 *   - declaredMime (если есть) в allowlist,
 *   - содержимое похоже на UTF-8.
 */
export async function detectLibraryFileKind(params: {
  originalName: string;
  declaredMime: string;
  buf: Buffer;
}): Promise<LibraryDetectedFile> {
  const originalName = String(params.originalName || '').trim() || 'file';
  const declaredMimeRaw = String(params.declaredMime || '').toLowerCase().trim();
  const declaredMime = declaredMimeRaw.split(';')[0].trim();
  const buf = params.buf;

  const detected = await fileTypeFromBuffer(buf);
  if (detected?.mime && detected?.ext && LIB_ALLOWED_IMAGE_MIMES.has(detected.mime)) {
    return { kind: 'image', mime: detected.mime, ext: detected.ext };
  }

  const lowerExt = getLowerExt(originalName);
  if (!lowerExt || !LIB_ALLOWED_TEXT_EXTS.has(lowerExt)) {
    throw Object.assign(new Error('UNSUPPORTED_FORMAT'), {
      code: 'UNSUPPORTED_FORMAT',
      details: 'Разрешены только txt/md/json/csv/yaml/yml и изображения png/jpg/webp/gif',
    });
  }

  if (declaredMime && !LIB_ALLOWED_TEXT_DECLARED_MIMES.has(declaredMime)) {
    throw Object.assign(new Error('UNSUPPORTED_MIME'), {
      code: 'UNSUPPORTED_MIME',
      details: `declaredMime=${declaredMime}`,
    });
  }

  if (!looksLikeUtf8Text(buf)) {
    throw Object.assign(new Error('NOT_UTF8_TEXT'), {
      code: 'NOT_UTF8_TEXT',
      details: 'Файл не похож на UTF-8 текст (похоже на бинарный)',
    });
  }

  const effectiveMime = declaredMime === 'application/octet-stream' ? 'text/plain' : declaredMime || 'text/plain';
  return { kind: 'text', mime: effectiveMime, ext: lowerExt };
}

// =============================================================================
// JSON IO (best-effort atomic)
// =============================================================================

/**
 * Пишет JSON pretty-print в файл best-effort "атомарно":
 * - пишем во временный файл рядом,
 * - затем заменяем target.
 *
 * Почему "best-effort":
 * - на Windows rename поверх существующего файла ведёт себя иначе, чем на *nix,
 * - нам важнее устойчивость и простота для локального приложения.
 *
 * Важно:
 * - Мы делаем это достаточно осторожно, но НЕ считаем это полноценной транзакционностью.
 * - Для MVP это нормально (однопользовательский сценарий).
 */
export async function writeJsonPrettyAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp-${crypto.randomUUID()}`;
  const payload = JSON.stringify(data, null, 2);

  // 1) Пишем tmp полностью.
  await fs.writeFile(tmpPath, payload, 'utf-8');

  // 2) Best-effort replace:
  // - если target существует, удаляем (force) и делаем rename.
  // - риск "окна" очень маленький и приемлем для локального приложения.
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore
  }
  await fs.rename(tmpPath, filePath);
}

/**
 * Читает JSON файл безопасно:
 * - ENOENT → возвращаем null (caller может создать дефолт),
 * - parse error → бросаем (это важно, чтобы не скрывать порчу данных silently).
 */
export async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : null;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

// =============================================================================
// Display name normalization
// =============================================================================

/**
 * Нормализует отображаемое имя документа:
 * - обрезаем длину,
 * - удаляем управляющие символы.
 *
 * Важно:
 * - Это НЕ влияет на docId.
 * - Это поле только для UI.
 */
export function normalizeDocDisplayName(name: string): string {
  const trimmed = String(name || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  const safe = trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
  return safe || 'file';
}

