/**
 * @file route.ts
 * @description API для загрузки вложений (картинки + текстовые файлы) в хранилище приложения.
 *
 * Почему это отдельный endpoint:
 * - В app router (Next.js) удобно принимать multipart через request.formData().
 * - Мы сохраняем файлы на диск (в папку данных приложения), а в canvas JSON
 *   сохраняем только метаданные + attachmentId.
 *
 * Архитектура хранения:
 * - data/attachments/<canvasId>/<attachmentId>
 *
 * Безопасность (КРИТИЧНО):
 * - НИКОГДА не используем имя файла как путь/ID
 * - attachmentId генерируется на сервере (UUID + расширение)
 * - тип изображения проверяем по magic bytes (file-type)
 * - для текстовых файлов дополнительно проверяем, что это “похоже на UTF-8 текст”
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import {
  getCanvasFilePath,
  getCanvasAttachmentsDirectory,
  getAttachmentFilePath,
} from '@/lib/paths';
import {
  readCanvasAttachmentsIndex,
  writeCanvasAttachmentsIndex,
  type CanvasAttachmentsIndex,
} from '@/lib/attachmentsIndex';
import type { NodeAttachment, AttachmentKind, AttachmentIngestionMode } from '@/types/canvas';

// =============================================================================
// NEXT.JS ROUTE CONFIG
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// =============================================================================
// LIMITS (MVP)
// =============================================================================
//
// ВАЖНО:
// - Эти лимиты соответствуют согласованному варианту “balanced”.
// - Отдельно (в /api/chat) будет лимит по “примерным токенам” для текстов,
//   т.к. 1MB текста может быть слишком дорогим для LLM.

const MAX_TEXT_BYTES = 1 * 1024 * 1024; // 1MB
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB
const MAX_TOTAL_BYTES_PER_NODE = 8 * 1024 * 1024; // 8MB

// =============================================================================
// ALLOWLISTS (MVP)
// =============================================================================
//
// ВАЖНО:
// - Мы используем allowlist подход: “разрешено только то, что явно разрешено”.
// - Это снижает риск подсовывания опасных бинарников, замаскированных под .jpg/.txt.

const ALLOWED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const ALLOWED_TEXT_EXTS = new Set<string>([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'yaml',
  'yml',
]);

const ALLOWED_TEXT_DECLARED_MIMES = new Set<string>([
  'text/plain',
  'text/markdown',
  // Частый MIME для .md в некоторых браузерах/OS (включая Windows)
  'text/x-markdown',
  // Редкий, но встречающийся вариант
  'text/md',
  'application/json',
  'text/csv',
  'application/yaml',
  'text/yaml',
  // В некоторых случаях браузер не может определить MIME и ставит octet-stream.
  // Мы разрешаем его ТОЛЬКО потому что дальше всё равно проверяем "похожесть на UTF-8 текст"
  // и allowlist расширения (txt/md/json/csv/yaml).
  'application/octet-stream',
]);

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Безопасно “вырезаем” расширение из имени файла.
 *
 * ВАЖНО:
 * - extension используется только как подсказка для текстовых файлов
 * - для изображений доверяем ТОЛЬКО file-type (magic bytes)
 */
const getLowerExt = (name: string): string | null => {
  const idx = name.lastIndexOf('.');
  if (idx === -1) return null;
  const ext = name.slice(idx + 1).trim().toLowerCase();
  return ext ? ext : null;
};

/**
 * Проверяем, что буфер “похож на UTF-8 текст”.
 *
 * Почему это нужно:
 * - `file-type` для текстов часто возвращает undefined (и это нормально)
 * - но пользователь может попытаться загрузить бинарник с расширением .txt
 * - простые эвристики (нет NUL-байтов + валидный UTF-8) резко снижают риск
 */
const looksLikeUtf8Text = (buf: Buffer): boolean => {
  // NUL байты — очень частый признак бинарника.
  // (Есть редкие исключения, но для MVP это адекватная защита.)
  if (buf.includes(0)) return false;

  try {
    // fatal:true — если встречаем невалидную последовательность, бросаем исключение.
    // Это лучше, чем “тихо” заменить на � и принять бинарник как текст.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(buf);
    return true;
  } catch {
    return false;
  }
};

/**
 * Считываем список вложений ноды (из canvas JSON) и суммируем их размеры.
 *
 * Зачем это нужно:
 * - лимит “суммарно на ноду” (8MB) должен учитывать уже прикреплённые вложения
 * - иначе пользователь мог бы обходить лимит по частям
 *
 * ВАЖНО:
 * - canvas JSON хранит nodes как “unknown[]”, поэтому здесь много защит.
 */
const getExistingNodeAttachmentsState = async (
  canvasId: string,
  nodeId: string
): Promise<{ totalBytes: number; byAttachmentId: Map<string, number> }> => {
  const canvasFile = getCanvasFilePath(canvasId);
  const content = await fs.readFile(canvasFile, 'utf-8');
  const data = JSON.parse(content) as { nodes?: Array<{ id?: string; data?: Record<string, unknown> }> };

  const node = (data.nodes || []).find((n) => n?.id === nodeId);
  if (!node) {
    // Нода не найдена — считаем это ошибкой уровня API: клиент пытается
    // прикрепить файл к несуществующей карточке.
    throw Object.assign(new Error('Node not found'), { code: 'NODE_NOT_FOUND' });
  }

  const attachments = node.data?.attachments;
  if (!Array.isArray(attachments)) return { totalBytes: 0, byAttachmentId: new Map() };

  // Минимальная “форма”, которая нам нужна для суммирования.
  // Мы специально не тащим сюда полный тип NodeAttachment, потому что:
  // - canvas JSON может содержать старые/повреждённые данные
  // - здесь мы читаем “unknown” и защищаемся проверками
  type AttachmentLike = { attachmentId?: unknown; sizeBytes?: unknown };

  let sum = 0;
  const byId = new Map<string, number>();
  for (const a of attachments) {
    // sizeBytes — обязателен по нашему типу, но старые данные/ручные правки могут ломать структуру
    if (a && typeof a === 'object') {
      const o = a as AttachmentLike;
      const size = typeof o.sizeBytes === 'number' ? Math.max(0, o.sizeBytes) : 0;
      const id = typeof o.attachmentId === 'string' ? o.attachmentId : '';
      sum += size;
      if (id) byId.set(id, size);
    }
  }
  return { totalBytes: sum, byAttachmentId: byId };
};

/**
 * Возвращает “безопасное” имя для отображения:
 * - обрезаем длину
 * - убираем потенциально вредные управляющие символы
 */
const normalizeOriginalName = (name: string): string => {
  const trimmed = (name || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed || 'file';
};

/**
 * Нормализованный ключ имени файла для "файлового менеджера холста".
 *
 * ВАЖНО:
 * - Это НЕ путь и НЕ ID. Это только ключ в JSON-индексе.
 * - Цель ключа: считать "одно и то же имя" одинаковым на разных OS (особенно Windows),
 *   где ФС часто case-insensitive.
 * - Поэтому приводим к lower-case.
 */
const normalizeNameKey = (originalName: string): string => {
  return normalizeOriginalName(originalName).toLowerCase();
};

// =============================================================================
// FAST ANALYSIS HELPERS (NO LLM)
// =============================================================================
//
// Здесь остаются только "дешёвые" вычисления, которые можно делать прямо при upload:
// - excerpt для текстовых файлов (быстрая выжимка/превью)
//
// Всё, что требует LLM (summary, описание изображения), перенесено в ленивый анализ:
// - /api/attachments/analyze (вызывается фоном при генерации ответа карточки)

/**
 * Быстрый excerpt для текста:
 * - нужен как fallback контекст для потомков
 * - не требует LLM
 */
const buildTextExcerpt = (text: string, maxChars: number = 2000): string => {
  const t = (text || '').replace(/\u0000/g, '').trim();
  if (!t) return '';
  return t.length <= maxChars ? t : t.slice(0, maxChars) + '...';
};

/**
 * Безопасно декодируем UTF-8 текст (сервер уже проверяет "похожесть на UTF-8").
 */
const decodeUtf8 = (buf: Buffer): string => {
  // В Node 18+ TextDecoder доступен глобально.
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(buf);
};

/**
 * Таймауты для "анализа файлов" (vision/summary) на сервере.
 * Эти операции могут быть медленными, но они выполняются единоразово на уровне файла холста.
 */
/**
 * ВАЖНОЕ ИЗМЕНЕНИЕ ПРОДУКТОВОЙ ЛОГИКИ:
 *
 * Раньше мы делали "тяжёлую" LLM-обработку вложений ПРЯМО ПРИ UPLOAD:
 * - text: summary (LLM)
 * - image: подробное описание (caption-only) (LLM)
 *
 * Это ухудшало UX (пользователь ждёт загрузку файла, хотя хочет просто прикрепить его).
 *
 * Теперь upload делает ТОЛЬКО дешёвую и быструю часть:
 * - сохраняем файл на диск
 * - обновляем attachments-index.json
 * - для текста считаем excerpt (быстрый fallback без LLM)
 *
 * А LLM-атрибуты (summary, описание изображения) считаются лениво:
 * - при первой генерации ответа карточки (см. /api/attachments/analyze + useNodeGeneration)
 */

// =============================================================================
// POST /api/attachments
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    // -------------------------------------------------------------------------
    // 1) Парсим multipart/form-data
    // -------------------------------------------------------------------------
    //
    // ВАЖНО:
    // - Next.js app router умеет разбирать multipart через request.formData()
    // - File здесь — Web API File (не Node.js fs)
    const form = await request.formData();

    const canvasId = String(form.get('canvasId') || '').trim();
    const nodeId = String(form.get('nodeId') || '').trim();
    const files = form.getAll('files');

    // -------------------------------------------------------------------------
    // 1.1) Параметры "файлового менеджера" / обработки
    // -------------------------------------------------------------------------
    //
    // Важно:
    // - Клиент может сначала сделать preflight (/api/attachments/preflight),
    //   а потом отправить upload с replaceExisting=true.
    // - Сервер ДОЛЖЕН защититься сам: без replaceExisting мы НЕ заменяем файл по имени.
    const replaceExisting = String(form.get('replaceExisting') || '').trim().toLowerCase() === 'true';

    // Раньше сюда приходили параметры для LLM-обработки (apiKey/model/useSummarization),
    // но теперь upload НЕ должен делать LLM-вызовы. Эти параметры намеренно удалены.

    if (!canvasId) {
      return NextResponse.json({ error: 'canvasId обязателен' }, { status: 400 });
    }
    if (!nodeId) {
      return NextResponse.json({ error: 'nodeId обязателен' }, { status: 400 });
    }
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'files[] обязателен (хотя бы 1 файл)' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // 2) Проверяем существование холста (иначе 404)
    // -------------------------------------------------------------------------
    //
    // ВАЖНО:
    // - так мы не создадим “мусорную” папку вложений для несуществующего холста
    const canvasFile = getCanvasFilePath(canvasId);
    try {
      await fs.access(canvasFile);
    } catch {
      return NextResponse.json({ error: 'Холст не найден', canvasId }, { status: 404 });
    }

    // -------------------------------------------------------------------------
    // 3) Считаем текущий суммарный размер вложений ноды (для лимита 8MB)
    // -------------------------------------------------------------------------
    let existingBytes = 0;
    let existingBytesByAttachmentId = new Map<string, number>();
    try {
      const state = await getExistingNodeAttachmentsState(canvasId, nodeId);
      existingBytes = state.totalBytes;
      existingBytesByAttachmentId = state.byAttachmentId;
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : null;

      if (code === 'NODE_NOT_FOUND') {
        return NextResponse.json({ error: 'Нода не найдена', nodeId }, { status: 404 });
      }
      throw err;
    }

    // -------------------------------------------------------------------------
    // 4) Подготовка директории для сохранения файлов
    // -------------------------------------------------------------------------
    const dir = getCanvasAttachmentsDirectory(canvasId);
    await fs.mkdir(dir, { recursive: true });

    // -------------------------------------------------------------------------
    // 4) Загружаем индекс файлов холста (для upsert по имени)
    // -------------------------------------------------------------------------
    //
    // Это - "задел под файловый менеджер":
    // - файл один на холст
    // - карточки хранят ссылки (attachmentId)
    // - обновление файла по имени обновляет ВСЕ ссылки
    const index = await readCanvasAttachmentsIndex(canvasId);

    // -------------------------------------------------------------------------
    // 4.1) PREPARE + REAL CONFLICTS (anti silent overwrite, но по КОНТЕНТУ)
    // -------------------------------------------------------------------------
    //
    // Продуктовое правило (обновлённое):
    // - Имя файла действительно уникально в пределах холста (nameKey → attachmentId).
    // - Но диалог "Заменить?" должен появляться НЕ по одному лишь совпадению имени,
    //   а только если пользователь реально пытается загрузить ДРУГОЕ содержимое.
    //
    // Серверная защита (КРИТИЧНО):
    // - мы по-прежнему не допускаем "тихую замену";
    // - если контент отличается и replaceExisting !== true → возвращаем 409 с конфликтами;
    // - при 409 мы НЕ должны сделать частичные записи на диск/в индекс.
    //
    // Следствие:
    // - Чтобы корректно определить "реальный конфликт", нам нужно сначала посчитать SHA-256
    //   входного файла (fileHash), и сравнить его с тем, что уже записано в индексе.

    const requestTs = Date.now();

    type PreparedUploadFile = {
      /** Web File из multipart. */
      entry: File;
      /** Имя файла, безопасное для отображения. */
      originalName: string;
      /** Ключ имени (case-insensitive) — как в attachments-index.json. */
      nameKey: string;
      /** MIME (как сообщил браузер) без параметров типа ";charset=utf-8". */
      declaredMime: string;
      /** Содержимое файла в памяти (MVP лимиты маленькие). */
      buf: Buffer;
      /** Размер в байтах. */
      sizeBytes: number;
      /** SHA-256 (hex) — "версия" файла. */
      fileHash: string;
    };

    // -------------------------------------------------------------------------
    // 4.1.A) PREPARE: читаем файлы в память и считаем их хэши ДО любых записей.
    // -------------------------------------------------------------------------
    //
    // Почему это важно:
    // - только так мы можем честно понять, есть ли "реальный конфликт" (контент отличается),
    //   и вернуть 409 без каких-либо частичных изменений на диске.
    const prepared: PreparedUploadFile[] = [];

    // Лимит “на ноду” учитывает уже существующие вложения.
    // Мы пересчитываем лимит на основе размеров входных файлов.
    let newBytesSum = 0;

    for (const entry of files) {
      if (!(entry instanceof File)) {
        // На всякий случай: если кто-то отправил “не file”, игнорируем.
        continue;
      }

      const originalName = normalizeOriginalName(entry.name);
      const nameKey = normalizeNameKey(originalName);

      const declaredMimeRaw = (entry.type || '').toLowerCase().trim();
      // На всякий случай убираем параметры (например ";charset=utf-8"), если вдруг прилетят.
      const declaredMime = declaredMimeRaw.split(';')[0].trim();

      // Читаем файл в память (лимиты маленькие → ок для MVP).
      const ab = await entry.arrayBuffer();
      const buf = Buffer.from(ab);
      const sizeBytes = buf.byteLength;

      // Нулевая длина — бессмысленно хранить.
      if (sizeBytes <= 0) {
        return NextResponse.json({ error: `Файл "${originalName}" пустой` }, { status: 400 });
      }

      // SHA-256 хэш содержимого — "версия" файла.
      const fileHash = crypto.createHash('sha256').update(buf).digest('hex');

      // ---------------------------------------------------------------------
      // Лимит “на ноду” (8MB): считаем так же, как раньше, но в prepare-стадии.
      // ---------------------------------------------------------------------
      //
      // ВАЖНО: upsert по имени должен считаться как "замена", а не "добавление".
      // Если этот файл уже прикреплён к ноде (по attachmentId из индекса),
      // мы вычитаем его старый размер из existingBytes.
      const existingIndexEntry = index.byNameKey[nameKey];
      const willUpsertExisting = Boolean(existingIndexEntry?.attachmentId);
      const oldSizeForThisNode =
        willUpsertExisting && existingIndexEntry?.attachmentId
          ? (existingBytesByAttachmentId.get(existingIndexEntry.attachmentId) || 0)
          : 0;

      newBytesSum += sizeBytes;
      if (existingBytes - oldSizeForThisNode + newBytesSum > MAX_TOTAL_BYTES_PER_NODE) {
        return NextResponse.json(
          {
            error: 'Превышен суммарный лимит вложений на карточку',
            details: `Лимит: ${MAX_TOTAL_BYTES_PER_NODE} bytes (≈ ${Math.round(MAX_TOTAL_BYTES_PER_NODE / 1024 / 1024)}MB)`,
          },
          { status: 413 }
        );
      }

      prepared.push({ entry, originalName, nameKey, declaredMime, buf, sizeBytes, fileHash });
    }

    // -------------------------------------------------------------------------
    // 4.1.B) REAL CONFLICT CHECK: совпало имя, но контент другой → 409 (если не replaceExisting)
    // -------------------------------------------------------------------------
    const conflicts: Array<{ originalName: string; attachmentId: string }> = [];
    const seenConflictNameKeys = new Set<string>();
    for (const p of prepared) {
      if (seenConflictNameKeys.has(p.nameKey)) continue;
      seenConflictNameKeys.add(p.nameKey);

      const existing = index.byNameKey[p.nameKey];
      if (!existing?.attachmentId) continue;

      // Если хэш совпадает — это тот же файл, конфликта НЕТ.
      // Именно этого UX мы добиваемся: "одинаковый файл" не должен требовать подтверждения замены.
      const existingHash = typeof existing.fileHash === 'string' ? existing.fileHash.trim().toLowerCase() : '';
      if (existingHash && existingHash === p.fileHash) continue;

      // Если existingHash пустой (редкий кейс старых/повреждённых данных),
      // мы не можем доказать идентичность → безопаснее считать это конфликтом.
      conflicts.push({ originalName: p.originalName, attachmentId: existing.attachmentId });
    }

    if (conflicts.length > 0 && !replaceExisting) {
      return NextResponse.json(
        {
          error: 'Файл с таким именем уже существует на холсте (но содержимое отличается)',
          details: 'Передайте replaceExisting=true, если пользователь подтвердил замену, или загрузите файл под новым именем.',
          conflicts,
        },
        { status: 409 }
      );
    }

    // -------------------------------------------------------------------------
    // 5) Обрабатываем каждый файл
    // -------------------------------------------------------------------------
    const result: NodeAttachment[] = [];

    // Метаданные "быстрого анализа", которые вернём клиенту сразу.
    //
    // Важно:
    // - excerpt считаем быстро и без LLM
    // - summary/описание изображения здесь НЕ считаем и возвращаем пустыми (совместимость протокола)
    const analysisExcerpts: Record<string, string> = {};
    const analysisSummaries: Record<string, string> = {};
    const analysisImageDescriptions: Record<string, string> = {};
    // Какие attachmentId реально обновились (hash изменился или файл новый).
    const updatedAttachmentIds: string[] = [];

    // Здесь мы используем `prepared[]`, чтобы:
    // - не читать файл повторно
    // - гарантировать, что конфликтный ответ (409) произошёл ДО любых write операций
    for (const p of prepared) {
      const originalName = p.originalName;
      const nameKey = p.nameKey;
      const declaredMime = p.declaredMime;
      const buf = p.buf;
      const sizeBytes = p.sizeBytes;
      const fileHash = p.fileHash;

      // Определяем “реальный” тип по magic bytes.
      // Для текстов чаще всего будет undefined — это норм.
      const detected = await fileTypeFromBuffer(buf);

      // ---------------------------------------------------------------------
      // Ветвление: image vs text
      // ---------------------------------------------------------------------
      let kind: AttachmentKind;
      let mime: string;
      let ext: string;

      // 1) Если magic bytes говорят, что это изображение — доверяем этому.
      if (detected?.mime && detected?.ext && ALLOWED_IMAGE_MIMES.has(detected.mime)) {
        kind = 'image';
        mime = detected.mime;
        ext = detected.ext;

        if (sizeBytes > MAX_IMAGE_BYTES) {
          return NextResponse.json(
            {
              error: `Изображение "${originalName}" слишком большое`,
              details: `Максимум: ${MAX_IMAGE_BYTES} bytes (≈ ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB)`,
            },
            { status: 413 }
          );
        }
      } else {
        // 2) Иначе пытаемся трактовать как текстовый файл.
        //    Мы намеренно НЕ пытаемся поддерживать PDF/Docx в MVP — только простые тексты.
        kind = 'text';

        const lowerExt = getLowerExt(originalName);
        if (!lowerExt || !ALLOWED_TEXT_EXTS.has(lowerExt)) {
          return NextResponse.json(
            {
              error: `Формат файла "${originalName}" не поддерживается`,
              details: 'Разрешены только текстовые файлы (txt/md/json/csv/yaml) и изображения (png/jpg/webp/gif).',
            },
            { status: 400 }
          );
        }

        if (declaredMime && !ALLOWED_TEXT_DECLARED_MIMES.has(declaredMime)) {
          // ВАЖНО:
          // - браузеры иногда ставят “странный” mime для .md (например text/plain),
          //   но мы allowlist'ом учитываем типичные варианты.
          return NextResponse.json(
            {
              error: `MIME тип файла "${originalName}" не поддерживается`,
              details: `Получили: ${declaredMime || '(empty)'}; ожидаем текстовые MIME.`,
            },
            { status: 400 }
          );
        }

        if (sizeBytes > MAX_TEXT_BYTES) {
          return NextResponse.json(
            {
              error: `Текстовый файл "${originalName}" слишком большой`,
              details: `Максимум: ${MAX_TEXT_BYTES} bytes (≈ ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)}MB)`,
            },
            { status: 413 }
          );
        }

        if (!looksLikeUtf8Text(buf)) {
          return NextResponse.json(
            {
              error: `Файл "${originalName}" не похож на UTF-8 текст`,
              details: 'Похоже, что это бинарный файл. В MVP поддерживаем только простые текстовые документы.',
            },
            { status: 400 }
          );
        }

        // MIME для текста:
        // - берём declared mime (если он есть и в allowlist)
        // - иначе делаем безопасный fallback
        //
        // Важно:
        // - если declaredMime === application/octet-stream — это "непонятный" mime,
        //   но мы уже проверили allowlist расширения + looksLikeUtf8Text(buf).
        //   Поэтому для хранения/UX выставляем более дружелюбный текстовый mime.
        mime =
          declaredMime === 'application/octet-stream'
            ? 'text/plain'
            : (declaredMime || 'text/plain');
        ext = lowerExt;
      }

      // ---------------------------------------------------------------------
      // Генерируем attachmentId (UUID + ext)
      // ---------------------------------------------------------------------
      //
      // ВАЖНО:
      // - UUID делаем на сервере, чтобы клиент не мог подсовывать пути
      // - ext берём из:
      //   - detected.ext (для image) — надёжно
      //   - расширения originalName (для text) — ок, т.к. это только расширение
      //     и оно проходит allowlist
      // Ключевая часть "файлового менеджера холста":
      // - attachmentId должен быть СТАБИЛЬНЫМ для одинакового имени (в пределах холста),
      //   чтобы все карточки продолжали ссылаться на тот же файл.
      // - поэтому если nameKey уже есть в индексе — переиспользуем attachmentId,
      //   и просто перезаписываем файл на диске.
      //
      // Важно:
      // - `index` мы обновляем в ходе обработки файлов (upsert),
      //   поэтому для каждого файла берём актуальную запись ИМЕННО ЗДЕСЬ.
      const existingIndexEntry = index.byNameKey[nameKey];
      const attachmentId = existingIndexEntry?.attachmentId
        ? existingIndexEntry.attachmentId
        : `${crypto.randomUUID()}.${ext}`;

      // ---------------------------------------------------------------------
      // Сохраняем файл на диск
      // ---------------------------------------------------------------------
      const filePath = getAttachmentFilePath(canvasId, attachmentId);
      await fs.writeFile(filePath, buf);

      // ---------------------------------------------------------------------
      // Обновляем индекс (upsert)
      // ---------------------------------------------------------------------
      const prev = index.byNameKey[nameKey];
      // ВАЖНО:
      // - если пользователь загрузил "тот же самый" файл (хэш не изменился),
      //   мы НЕ меняем fileUpdatedAt, чтобы:
      //   1) не триггерить ложный stale во всех карточках-ссылках,
      //   2) сохранить корректную семантику "файл действительно обновлялся".
      const isContentChanged = !(prev?.fileHash && prev.fileHash === fileHash);
      const effectiveUpdatedAt = isContentChanged ? requestTs : (prev?.fileUpdatedAt || requestTs);

      // Если контент изменился — это сигнал для всех карточек-ссылок:
      // - нужно обновить метаданные (fileHash/fileUpdatedAt/sizeBytes)
      // - нужно обновить analysis (summary/описания)
      if (isContentChanged) {
        updatedAttachmentIds.push(attachmentId);
      }

      // Режим включения файла в контекст (задел под chunking).
      // Сейчас в MVP всегда inline.
      const ingestionMode: AttachmentIngestionMode = 'inline';

      // ---------------------------------------------------------------------
      // 5.x) FAST ANALYSIS (excerpt) на уровне ФАЙЛА ХОЛСТА
      // ---------------------------------------------------------------------
      //
      // Ключевой принцип:
      // - upload НЕ делает LLM-вызовы, чтобы не тормозить UX.
      // - Здесь мы оставляем только дешёвый "excerpt" для текстовых файлов.
      //
      // LLM-атрибуты будут вычисляться позже, лениво, в /api/attachments/analyze.
      const previousAnalysis = prev?.analysis || undefined;
      const nextAnalysis: NonNullable<CanvasAttachmentsIndex['byNameKey'][string]['analysis']> = {
        ...previousAnalysis,
      };

      if (kind === 'text') {
        const text = decodeUtf8(buf);
        const excerpt = buildTextExcerpt(text);
        if (excerpt) {
          nextAnalysis.excerpt = excerpt;
        }
      }
      // Для изображений и summary мы НИЧЕГО не считаем на upload.

      // Если контент изменился, мы обязаны сбросить LLM-результаты в индексе,
      // иначе потомки могут получать устаревшее summary/описание изображения от "прошлой версии" файла.
      if (isContentChanged) {
        // summary
        delete nextAnalysis.summary;
        // image
        if (nextAnalysis.image) {
          // Новый канонический формат:
          delete nextAnalysis.image.description;
          delete nextAnalysis.image.descriptionLanguage;
          // Legacy поля (старые данные)
          delete nextAnalysis.image.combined;
          delete nextAnalysis.image.caption;
        }
        // Модель/таймстемпы анализа — относятся к LLM-части; сбрасываем чтобы не вводить в заблуждение.
        delete nextAnalysis.model;
        delete nextAnalysis.updatedAt;
      }

      // Пишем/обновляем индекс (v2) с analysis.
      index.byNameKey[nameKey] = {
        attachmentId,
        fileCreatedAt: prev?.fileCreatedAt || requestTs,
        fileUpdatedAt: effectiveUpdatedAt,
        fileHash,
        kind,
        mime,
        sizeBytes,
        ingestionMode,
        analysis: nextAnalysis,
      };

      // Заполняем карты анализа для ответа клиенту (даже если анализ был "старый").
      if (index.byNameKey[nameKey].analysis?.excerpt) {
        analysisExcerpts[attachmentId] = index.byNameKey[nameKey].analysis!.excerpt!;
      }
      if (index.byNameKey[nameKey].analysis?.summary) {
        analysisSummaries[attachmentId] = index.byNameKey[nameKey].analysis!.summary!;
      }
      // Изображения: в ответ возвращаем “caption-only description”.
      // Важно:
      // - readCanvasAttachmentsIndex() делает best-effort нормализацию legacy (caption/combined -> description),
      //   поэтому если у старого холста было combined/caption, здесь чаще всего уже будет description.
      if (index.byNameKey[nameKey].analysis?.image?.description) {
        analysisImageDescriptions[attachmentId] = index.byNameKey[nameKey].analysis!.image!.description!;
      }

      // ---------------------------------------------------------------------
      // Формируем метаданные
      // ---------------------------------------------------------------------
      result.push({
        attachmentId,
        kind,
        originalName,
        mime,
        sizeBytes,
        createdAt: index.byNameKey[nameKey].fileCreatedAt,
        ingestionMode,
        // Эти поля (fileHash/fileUpdatedAt) расширяют NodeAttachment (см types/canvas.ts).
        // Они критичны для:
        // - корректного stale во всех карточках, которые ссылаются на этот файл,
        // - будущего файлового менеджера (версионирование/обновления).
        fileHash,
        fileUpdatedAt: effectiveUpdatedAt,
      });
    }

    // -------------------------------------------------------------------------
    // 6) Сохраняем индекс на диск (после обработки всех файлов)
    // -------------------------------------------------------------------------
    //
    // Почему пишем один раз:
    // - меньше IO
    // - проще обеспечить консистентность (в пределах одного запроса)
    await writeCanvasAttachmentsIndex(canvasId, index);

    return NextResponse.json({
      attachments: result,
      updatedAttachmentIds,
      analysis: {
        attachmentExcerpts: analysisExcerpts,
        attachmentSummaries: analysisSummaries,
        attachmentImageDescriptions: analysisImageDescriptions,
      },
    });
  } catch (error) {
    console.error('[Attachments API] Upload error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Не удалось загрузить вложения', details: message },
      { status: 500 }
    );
  }
}

