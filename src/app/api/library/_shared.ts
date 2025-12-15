/**
 * @file _shared.ts
 * @description Общие helper-функции для API `/api/library/*`.
 *
 * Почему этот файл существует:
 * - У нас много API endpoints (list/upload/rename/move/trash/gc...),
 * - Они все должны одинаково:
 *   - читать/писать `library-index.json`,
 *   - читать `usage-index.json`,
 *   - валидировать входные параметры,
 *   - форматировать ответы.
 *
 * Важно:
 * - Файл лежит рядом с route.ts в папке app router — это нормально:
 *   Next.js не сделает из него endpoint, пока он не называется `route.ts`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { fileTypeFromBuffer } from 'file-type';
import { promises as fs } from 'fs';
import {
  getLibraryFilePath,
  getLibraryTrashFilePath,
} from '@/lib/paths';
import {
  readLibraryIndex,
  type LibraryIndexV1,
  type LibraryDoc,
} from '@/lib/libraryIndex';
import {
  readUsageIndex,
  getCanvasIdsForDoc,
  getUsageLinksForDoc,
  hasAnyUsage,
  type UsageIndexV1,
} from '@/lib/libraryUsageIndex';
import { isValidDocId } from '@/lib/libraryFs';

// =============================================================================
// NEXT ROUTE CONFIG (shared)
// =============================================================================
//
// Мы экспортируем эти константы, чтобы каждый route.ts мог просто:
//   export { dynamic, runtime } from '../_shared'
// (или локально объявить то же самое).

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// =============================================================================
// PARAM PARSING
// =============================================================================

export function parseBooleanParam(v: string | null | undefined): boolean | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

export function getSearchParams(request: NextRequest): URLSearchParams {
  return new URL(request.url).searchParams;
}

// =============================================================================
// EXT FILTER HELPERS
// =============================================================================
//
// Почему фильтр по расширениям нужен на сервере (а не только на клиенте):
// - библиотека потенциально может стать большой;
// - фильтрация на сервере снижает нагрузку на сеть и ускоряет UI;
// - и самое главное: сервер — “источник истины” для семантики фильтра.
//
// Форматы query param `ext` (поддерживаем оба одновременно):
// - многократный параметр: ?ext=md&ext=pdf
// - CSV в одном параметре: ?ext=md,pdf
//
// Нормализация:
// - приводим к lower-case
// - удаляем ведущую точку (".md" -> "md")
// - режем пробелы
// - выкидываем пустые/явно опасные токены ("/", "\"), чтобы:
//   (a) не засорять логику фильтра
//   (b) не хранить мусор в UI состоянии
//
// Важно:
// - Мы НЕ делаем жёсткую валидацию “только [a-z0-9]”, потому что расширения
//   иногда бывают необычными (например, "tar.gz" по факту будет "gz",
//   а пользователь может захотеть фильтровать по "c++" и т.п.).
// - Но мы отбрасываем откровенно невалидные/опасные куски со слэшами.

function normalizeExtToken(raw: string): string | null {
  const s0 = String(raw || '').trim().toLowerCase();
  if (!s0) return null;
  if (s0.includes('/') || s0.includes('\\')) return null;
  // Удаляем ведущие точки: ".md" -> "md", "..md" -> "md"
  const s = s0.replace(/^\.+/, '');
  if (!s) return null;
  return s;
}

/**
 * Достаёт нормализованный список расширений из URLSearchParams.
 *
 * Поддерживаем:
 * - sp.getAll('ext')  (multi)
 * - CSV внутри одного значения
 *
 * Возвращаем уникальные значения в исходном порядке (stable unique).
 */
export function parseExtFilter(sp: URLSearchParams): string[] {
  const rawValues = sp.getAll('ext');
  if (!rawValues || rawValues.length === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawValues) {
    // Поддержка CSV: "md,pdf, txt"
    const parts = String(raw || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

    for (const p of parts) {
      const norm = normalizeExtToken(p);
      if (!norm) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
    }
  }

  return out;
}

/**
 * Получить расширение “как пользователь его ожидает” из:
 * - docId (канонично: UUID.ext)
 * - name (пользовательское имя может содержать расширение)
 *
 * Возвращаем расширение без точки, в lower-case, либо null если определить нельзя.
 */
function getExtFromDocId(docId: string): string | null {
  const s = String(docId || '').trim().toLowerCase();
  const lastDot = s.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === s.length - 1) return null;
  return normalizeExtToken(s.slice(lastDot + 1));
}

function getExtFromName(name: string): string | null {
  const s = String(name || '').trim().toLowerCase();
  const lastDot = s.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === s.length - 1) return null;
  return normalizeExtToken(s.slice(lastDot + 1));
}

// =============================================================================
// SAFE VALIDATION (anti path traversal)
// =============================================================================

/**
 * Валидация docId на уровне API:
 * - docId = UUID + '.' + ext
 * - никаких слэшей, никакого "../"
 */
export function assertDocIdOrThrow(docId: string): void {
  if (!isValidDocId(docId)) {
    throw Object.assign(new Error('INVALID_DOC_ID'), { code: 'INVALID_DOC_ID' });
  }
}

// =============================================================================
// LIST RESPONSE
// =============================================================================

export type LibraryListDoc = LibraryDoc & {
  /**
   * Список холстов, где используется документ.
   *
   * Важно:
   * - Это “денормализация” для UI.
   * - Источник истины — usage-index.json.
   */
  usedInCanvasIds: string[];

  /**
   * Детальные ссылки "где именно используется":
   * - canvasId
   * - nodeIds[]
   *
   * Это нужно для панели Links (FileManager → Details),
   * чтобы можно было перейти прямо к нужной карточке.
   *
   * Важно:
   * - UI может не использовать это поле (оно опционально),
   *   но мы отдаём его в /api/library, потому что это простая денормализация.
   */
  usedIn?: Array<{ canvasId: string; nodeIds: string[] }>;
};

export type LibraryListResponse = {
  version: 1;
  folders: LibraryIndexV1['folders'];
  docs: LibraryListDoc[];
  meta: {
    totalDocs: number;
    totalFolders: number;
    trashedDocs: number;
    /**
     * Количество "живых" документов (НЕ в корзине), у которых нет ссылок.
     *
     * Зачем это поле нужно UI:
     * - Кнопка "Убрать без ссылок" в файловом менеджере должна показывать счётчик (badge),
     *   чтобы пользователь видел, что у него есть "осиротевшие" файлы.
     * - Это число должно быть доступно без дополнительных запросов и действий пользователя.
     *
     * Важно:
     * - Счётчик глобальный (по всей библиотеке), НЕ зависит от фильтров (canvas/ext/поиск).
     * - Источник истины для "есть ли ссылка" — usage-index.json (best-effort, чинится кнопкой reindex-usage).
     */
    unlinkedLiveDocs: number;
    updatedAt: number;
  };
};

/**
 * Собирает ответ “список документов библиотеки” с фильтрами.
 *
 * Фильтры (query params):
 * - q: string — поиск по имени документа (case-insensitive)
 * - folderId: string|null — фильтр по папке (null = root)
 * - trashed: boolean — показать только корзину или только “живые”
 * - canvasId: string — показать только документы, используемые на этом холсте
 * - ext: string|string[] — фильтр по расширениям (см. parseExtFilter)
 */
export async function buildLibraryListResponse(request: NextRequest): Promise<LibraryListResponse> {
  const sp = getSearchParams(request);

  const q = String(sp.get('q') || '').trim().toLowerCase();
  const folderIdParam = sp.get('folderId');
  const folderId = folderIdParam == null || folderIdParam === '' ? null : String(folderIdParam).trim();
  const trashed = parseBooleanParam(sp.get('trashed'));
  const canvasId = String(sp.get('canvasId') || '').trim() || null;
  const extFilter = parseExtFilter(sp);

  const [index, usage] = await Promise.all([readLibraryIndex(), readUsageIndex()]);

  const totalDocs = index.docs.length;
  const totalFolders = index.folders.length;
  const trashedDocs = index.docs.filter((d) => Boolean(d.trashedAt)).length;
  // "Живые" документы без ссылок — считаем по всему индексу, до применения фильтров,
  // чтобы UI мог показать глобальный счётчик и дать пользователю предсказуемую кнопку:
  // "переместить ВСЕ без ссылок в корзину".
  const unlinkedLiveDocs = index.docs.filter((d) => !d.trashedAt && !hasAnyUsage(usage, d.docId)).length;

  let docs = index.docs.slice();

  // 1) trashed filter
  if (trashed === true) {
    docs = docs.filter((d) => Boolean(d.trashedAt));
  } else if (trashed === false) {
    docs = docs.filter((d) => !d.trashedAt);
  }

  // 2) folder filter (применяем только к "не удалённым" или если пользователь явно просит)
  if (folderIdParam != null) {
    docs = docs.filter((d) => (d.folderId ?? null) === folderId);
  }

  // 3) q filter
  if (q) {
    docs = docs.filter((d) => String(d.name || '').toLowerCase().includes(q));
  }

  // 4) canvas filter
  if (canvasId) {
    docs = docs.filter((d) => {
      const canvasIds = getCanvasIdsForDoc(usage, d.docId);
      return canvasIds.includes(canvasId);
    });
  }

  // 5) ext filter
  //
  // Семантика:
  // - фильтр "ext" отбирает документы, у которых расширение совпало хотя бы по одному источнику:
  //   (a) docId (источник истины: UUID.ext)
  //   (b) name (для UX, если пользователь видит расширение в имени)
  //
  // Почему проверяем и docId и name:
  // - docId гарантированно содержит расширение, но пользователь может мыслить в терминах “.md” из имени;
  // - при этом мы НЕ хотим полагаться только на name, потому что name может быть произвольным.
  if (extFilter.length > 0) {
    const extSet = new Set(extFilter);
    docs = docs.filter((d) => {
      const byDocId = getExtFromDocId(d.docId);
      if (byDocId && extSet.has(byDocId)) return true;
      const byName = getExtFromName(d.name);
      if (byName && extSet.has(byName)) return true;
      return false;
    });
  }

  // Стабильная сортировка для UI: по имени, затем по createdAt.
  docs.sort((a, b) => {
    const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const docsWithUsage: LibraryListDoc[] = docs.map((d) => ({
    ...d,
    usedInCanvasIds: getCanvasIdsForDoc(usage, d.docId),
    usedIn: getUsageLinksForDoc(usage, d.docId).map((x) => ({ canvasId: x.canvasId, nodeIds: x.nodeIds })),
  }));

  return {
    version: 1,
    folders: index.folders,
    docs: docsWithUsage,
    meta: {
      totalDocs,
      totalFolders,
      trashedDocs,
      unlinkedLiveDocs,
      updatedAt: Date.now(),
    },
  };
}

// =============================================================================
// FILE SERVING
// =============================================================================

/**
 * Для выдачи файла нам нужно:
 * - найти метаданные (mime, name, trashedAt),
 * - найти фактический файл на диске (files/ или .trash/),
 * - выставить корректные заголовки.
 */
export async function serveLibraryFile(params: { docId: string }): Promise<Response> {
  const docId = String(params.docId || '').trim();
  assertDocIdOrThrow(docId);

  /**
   * RFC 5987 / RFC 6266 helpers для Content-Disposition.
   *
   * Контекст (почему это нужно):
   * - Next.js (runtime=nodejs) использует undici для реализации Fetch/Response.
   * - undici валидирует значения header'ов как ByteString (0..255 на каждый символ).
   * - Если мы положим в header "чистый" Unicode (например кириллицу) — Response(...) упадёт:
   *   `TypeError: Cannot convert argument to a ByteString ... value ... > 255`.
   * - Это ровно то, что вы увидели в логах при rename/имени на кириллице.
   *
   * Что мы делаем:
   * - Всегда отдаём ASCII-safe `filename="..."` как fallback (для старых клиентов).
   * - Дополнительно отдаём `filename*=UTF-8''...` (RFC 5987), чтобы современные браузеры
   *   корректно показывали и сохраняли имя с Unicode (кириллица, диакритика и т.п.).
   *
   * Важно:
   * - В заголовках НЕ должно быть CR/LF, иначе возможна header injection.
   * - Мы не пытаемся транслитерировать кириллицу в латиницу — это отдельная задача и спорно для UX.
   *   Вместо этого fallback заменяет non-ASCII на '_' и сохраняет расширение по возможности.
   */
  function encodeRfc5987Value(v: string): string {
    // encodeURIComponent гарантирует ASCII (через %XX),
    // но по RFC 5987 нужно дополнительно кодировать некоторые символы,
    // которые encodeURIComponent оставляет "как есть": ' ( ) *
    return encodeURIComponent(v)
      .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  function buildAsciiFallbackFilename(inputName: string, fallback: string): string {
    // 1) Приводим к строке, режем whitespace по краям.
    const raw = String(inputName || '').trim();
    const base = raw || String(fallback || '').trim() || 'file';

    // 2) Убираем потенциально опасные/некорректные символы для header:
    // - двойные кавычки ломают формат filename="..."
    // - CR/LF теоретически могут привести к инъекции заголовков
    // - NUL и прочие control chars — мусор
    const noCtl = base.replace(/["\r\n\u0000-\u001F\u007F]/g, '');

    // 3) В ASCII-fallback оставляем только безопасный диапазон.
    // Важно: здесь мы НЕ стремимся к "красивому" имени — только к валидности.
    // Unicode (в т.ч. кириллица) заменяем на '_', чтобы undici не падал.
    const ascii = noCtl.replace(/[^\x20-\x7E]/g, '_');

    // 4) Убираем слэши и обратные слэши, чтобы не было "псевдо-путей".
    const noSlashes = ascii.replace(/[\/\\]+/g, '_');

    // 5) Сжимаем повторяющиеся пробелы/подчёркивания — чисто для эстетики.
    const normalized = noSlashes.replace(/\s+/g, ' ').replace(/_+/g, '_').trim();

    // 6) Ограничиваем длину, чтобы не плодить гигантские заголовки.
    // (200 — тот же порядок, что мы используем для display-name.)
    const limited = normalized.length > 200 ? normalized.slice(0, 200) : normalized;

    return limited || 'file';
  }

  function buildInlineContentDisposition(originalName: string, fallbackName: string): string {
    // `filename*` должен быть только ASCII (у нас %XX, значит ок).
    const encoded = encodeRfc5987Value(originalName);

    // `filename="..."` — только ASCII fallback, без кавычек/CRLF.
    const asciiFallback = buildAsciiFallbackFilename(fallbackName, 'file');

    // Важно: `filename*` добавляем всегда, даже если имя ASCII —
    // это делает поведение единообразным, а клиенты выберут лучшую форму.
    return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
  }

  const index = await readLibraryIndex();
  const doc = index.docs.find((d) => d.docId === docId) || null;
  if (!doc) {
    return NextResponse.json({ error: 'Документ не найден', docId }, { status: 404 });
  }

  // Где лежит файл:
  // - если doc.trashedAt есть → ожидаем файл в .trash
  // - но делаем best-effort: если в ожидаемом месте нет, проверяем второе место
  const primaryPath = doc.trashedAt ? getLibraryTrashFilePath(docId) : getLibraryFilePath(docId);
  const fallbackPath = doc.trashedAt ? getLibraryFilePath(docId) : getLibraryTrashFilePath(docId);

  let buf: Buffer | null = null;
  let actualPath = primaryPath;
  try {
    buf = await fs.readFile(primaryPath);
  } catch (e1: unknown) {
    const code =
      e1 && typeof e1 === 'object' && 'code' in e1 ? String((e1 as { code?: unknown }).code) : null;
    if (code !== 'ENOENT') throw e1;
    try {
      buf = await fs.readFile(fallbackPath);
      actualPath = fallbackPath;
    } catch (e2: unknown) {
      const code2 =
        e2 && typeof e2 === 'object' && 'code' in e2 ? String((e2 as { code?: unknown }).code) : null;
      if (code2 === 'ENOENT') {
        return NextResponse.json({ error: 'Файл документа не найден на диске', docId }, { status: 404 });
      }
      throw e2;
    }
  }

  // MIME:
  // - берём из метаданных (главный источник истины),
  // - если пусто/сломано — пробуем file-type,
  // - иначе fallback.
  const detected = await fileTypeFromBuffer(buf);
  const contentType = doc.mime || detected?.mime || 'application/octet-stream';

  // Content-Disposition:
  // - Для UX мы хотим показывать/сохранять файл с именем, которое дал пользователь (doc.name),
  //   и это имя может содержать Unicode (кириллица).
  // - Но undici/Node требуют, чтобы значения заголовков были ByteString (0..255),
  //   иначе создание Response упадёт и мы вернём 500.
  // Поэтому мы собираем заголовок по RFC 6266:
  // - filename="..."     -> ASCII fallback (всегда безопасен)
  // - filename*=UTF-8''  -> настоящее имя в UTF-8, percent-encoded (RFC 5987)
  const originalFilename = String(doc.name || docId).trim() || docId;
  const contentDisposition = buildInlineContentDisposition(originalFilename, originalFilename);

  // Конвертируем Buffer → Uint8Array для совместимости типов Response в Next.js.
  const body = new Uint8Array(buf);

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      // Для дебага: где физически лежал файл.
      'X-Library-File-Location': actualPath.includes('/.trash/') || actualPath.includes('\\.trash\\') ? 'trash' : 'files',
    },
  });
}

// =============================================================================
// GC HELPERS
// =============================================================================

/**
 * Проверяет "можно ли удалять документ навсегда":
 * - да, если usage-index не содержит ссылок (вообще никаких).
 */
export function isDocEligibleForPermanentDeletion(usage: UsageIndexV1, docId: string): boolean {
  return !hasAnyUsage(usage, docId);
}

