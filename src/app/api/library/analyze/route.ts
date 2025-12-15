/**
 * @file route.ts
 * @description API: POST /api/library/analyze
 *
 * Этот endpoint делает “тяжёлую” (LLM) обработку документов библиотеки:
 * - text  → summary (2-3 предложения)
 * - image → description (caption-only, 5–10 предложений)
 *
 * Ключевая продуктовая идея (из плана):
 * - анализ принадлежит ДОКУМЕНТУ БИБЛИОТЕКИ, а не карточке (node).
 * - результаты храним в `library-index.json` рядом с метаданными файла.
 * - результаты привязаны к “версии файла” (doc.fileHash):
 *   - summaryForFileHash === doc.fileHash → summary актуален
 *   - imageForFileHash   === doc.fileHash → image.description актуален
 *
 * Идемпотентность:
 * - если анализ уже есть и привязан к текущему hash → пропускаем docId без лишних вызовов LLM.
 *
 * Best-effort:
 * - если один docId упал (нет файла/ошибка LLM) — продолжаем анализ остальных.
 * - в ответе возвращаем подробный отчёт по каждому docId.
 *
 * Безопасность:
 * - docId валидируем (anti path traversal) через `assertDocIdOrThrow`.
 * - MIME для изображения определяем по magic bytes (file-type), а не доверяем расширению.
 * - текст декодируем как строгий UTF-8 (fatal:true); если не UTF-8 → не анализируем как текст.
 *
 * Почему этот endpoint НЕ использует streaming:
 * - результат короткий (summary/description),
 * - проще сделать предсказуемым и надёжным (один JSON ответ).
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { fileTypeFromBuffer } from 'file-type';
import { DEFAULT_CHAT_MODEL_ID } from '@/lib/aiCatalog';
import { getCanvasFilePath, getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { readLibraryIndex, writeLibraryIndex, type LibraryDoc, type LibraryDocAnalysis } from '@/lib/libraryIndex';
import { readUsageIndex, getUsageLinksForDoc } from '@/lib/libraryUsageIndex';
import { assertDocIdOrThrow } from '@/app/api/library/_shared';
import type { NodeAttachment } from '@/types/canvas';
import {
  getDemoOpenRouterApiKey,
  isDemoModeApiKey,
  OPENROUTER_BASE_URL,
  pickDemoChatModelId,
} from '@/lib/openrouterDemo';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// =============================================================================
// CONFIG
// =============================================================================

/**
 * URL внешнего API провайдера по умолчанию.
 *
 * NOTE:
 * - Это совпадает с тем, что уже используется в /api/chat и /api/summarize.
 * - Пользователь может переопределить через apiBaseUrl в запросе.
 */
const DEFAULT_API_BASE_URL = 'https://api.vsellm.ru/v1';

/**
 * Таймаут на ОДИН LLM запрос (summary или image description).
 *
 * Почему 60s:
 * - vision модели часто медленнее обычного текста,
 * - но это всё ещё “UX-friendly” предел для локального приложения.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Allowlist изображений (должно совпадать с /api/chat и upload allowlist).
 * Мы используем только для определения: “это картинка → делаем vision prompt”.
 */
const ALLOWED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

// =============================================================================
// TYPES
// =============================================================================

type AnalyzeRequestBody = {
  /**
   * Какие документы нужно проанализировать.
   *
   * Важно:
   * - это docId (UUID + '.' + ext), а не file path.
   * - допускаем дубликаты на входе, но внутри дедупаем.
   */
  docIds: string[];

  // Настройки LLM (такие же, как в /api/chat):
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  corporateMode?: boolean;

  /**
   * Подсказка по языку для результата.
   *
   * Примеры:
   * - "ru"
   * - "en"
   * - "Пиши по-русски"
   *
   * Мы храним это как метаданные (descriptionLanguage) и используем в prompt,
   * но не пытаемся “жёстко” нормализовать до ISO-639 — это осознанный MVP.
   */
  languageHintText?: string;
};

type AnalyzeDocResult =
  | {
      docId: string;
      status: 'ok';
      kind: 'text' | 'image';
      didComputeSummary: boolean;
      didComputeImageDescription: boolean;
    }
  | {
      docId: string;
      status: 'skipped';
      reason:
        | 'DOC_NOT_FOUND'
        | 'FILE_NOT_FOUND'
        | 'UNSUPPORTED_KIND'
        | 'ALREADY_UP_TO_DATE'
        | 'DEMO_MODE_VISION_DISABLED'
        | 'INVALID_DOC_ID';
    }
  | {
      docId: string;
      status: 'error';
      error: string;
      details?: string;
    };

// =============================================================================
// PROMPTS (MVP)
// =============================================================================

/**
 * Системный промпт для суммаризации.
 *
 * Важно:
 * - держим его близким к /api/summarize, но добавляем languageHint (если есть),
 *   чтобы UI мог управлять языком результата, когда это важно пользователю.
 */
const buildSummarySystemPrompt = (languageHintText: string | null): string => {
  const hint = languageHintText ? String(languageHintText).trim() : '';
  const hintBlock = hint
    ? [
        '',
        'LANGUAGE PREFERENCE (soft hint):',
        `- Prefer to write the summary in: ${hint}`,
        '- If this conflicts with the input language, follow the INPUT language unless user explicitly requests otherwise.',
      ].join('\n')
    : '';

  return [
    'You are a text summarization assistant.',
    '',
    'Your task: condense the given text into 2-3 key sentences while preserving the main idea and important facts.',
    '',
    'CRITICAL LANGUAGE RULE:',
    '- Detect the language of the input text',
    '- Write your summary in THE SAME LANGUAGE as the input',
    '- If input is in Russian → summarize in Russian',
    '- If input is in English → summarize in English',
    '- If input is in any other language → summarize in that language',
    hintBlock,
    '',
    'Rules:',
    '- Be concise and to the point',
    '- Preserve key facts and conclusions',
    '- Do not add new information not present in the original',
    '- Do not use introductory phrases like "This text discusses..." or "The author talks about..."',
    '- Just provide a brief summary of the content',
  ].join('\n');
};

/**
 * Системный промпт для “описания изображения”.
 *
 * Важно:
 * - Мы НЕ делаем OCR “дословно”.
 * - Если на изображении есть текст — просим модель передать смысл.
 */
const buildImageDescriptionSystemPrompt = (languageHintText: string | null): string => {
  const hint = languageHintText ? String(languageHintText).trim() : '';
  const languageRule = hint
    ? `Write the description in: ${hint}`
    : 'Write the description in Russian (ru) unless it is clearly better to answer in English.';

  return [
    'You are an image description assistant.',
    '',
    'Task:',
    '- Describe the image content in 5-10 sentences.',
    '- Focus on meaning, context, and key visual elements.',
    '',
    'Rules:',
    `- ${languageRule}`,
    '- Do NOT transcribe long text verbatim.',
    '- If there is text in the image, summarize what it means (high level).',
    '- Do NOT include "I see..." or "The image shows..." prefaces; just the description.',
    '- Do NOT add speculative details you cannot infer from the image.',
  ].join('\n');
};

// =============================================================================
// LLM CALL (OpenAI-compatible chat/completions)
// =============================================================================

/**
 * Делает один запрос к OpenAI-compatible `/chat/completions` (stream:false).
 *
 * Мы намеренно держим реализацию “похожей” на /api/summarize:
 * - corporateMode временно отключает проверку SSL сертификатов,
 * - используем AbortController для таймаута,
 * - возвращаем понятные ошибки (status+body).
 */
async function callChatCompletions(params: {
  apiUrl: string;
  apiKey: string;
  model: string;
  corporateMode: boolean;
  /**
   * Контент сообщения может быть:
   * - string (обычный текст),
   * - или “parts” массив для мультимодальных моделей.
   *
   * Мы НЕ хотим тащить сюда `any`, поэтому используем `unknown`.
   * Внутри мы просто JSON.stringify-им это и отправляем провайдеру.
   */
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>;
  temperature: number;
  maxTokens: number;
}): Promise<string> {
  const originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  if (params.corporateMode) {
    // В корпоративных сетях часто происходит SSL-инспекция.
    // Это снижает безопасность — используем только если пользователь включил это сознательно.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(params.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Авторизация через Bearer token (если ключ есть).
        // В некоторых локальных OpenAI-compatible серверах ключ может быть не нужен.
        ...(params.apiKey ? { Authorization: `Bearer ${params.apiKey}` } : {}),

        // Best-practice заголовки OpenRouter (не секреты).
        // Здесь мы не знаем, demoMode это или нет, поэтому ставим нейтральный X-Title.
        ...( /openrouter\.ai/i.test(params.apiUrl)
          ? {
              'HTTP-Referer': 'https://neurocanvas.local',
              'X-Title': 'NeuroCanvas',
            }
          : {}),
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Важно: тело ошибки часто содержит полезную диагностику провайдера.
      const errorText = await response.text();
      throw Object.assign(new Error('LLM_API_ERROR'), {
        code: 'LLM_API_ERROR',
        status: response.status,
        details: errorText,
      });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) {
      throw Object.assign(new Error('LLM_EMPTY_RESPONSE'), { code: 'LLM_EMPTY_RESPONSE' });
    }
    return text;
  } catch (err: unknown) {
    // Таймаут.
    if (err instanceof Error && err.name === 'AbortError') {
      throw Object.assign(new Error('LLM_TIMEOUT'), { code: 'LLM_TIMEOUT' });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);

    // Гарантированно возвращаем значение обратно (как в /api/summarize).
    if (params.corporateMode) {
      if (originalTlsReject !== undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
      else delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }
  }
}

// =============================================================================
// FILE IO (best-effort files/ vs .trash/)
// =============================================================================

/**
 * Читает файл документа best-effort из библиотеки.
 *
 * Почему best-effort:
 * - пользователь мог вручную переместить файл,
 * - возможны гонки между “trash/restore” и анализом,
 * - индекс мог на мгновение не соответствовать диску.
 */
async function readLibraryDocFile(doc: LibraryDoc): Promise<Buffer | null> {
  const docId = doc.docId;
  const primaryPath = doc.trashedAt ? getLibraryTrashFilePath(docId) : getLibraryFilePath(docId);
  const fallbackPath = doc.trashedAt ? getLibraryFilePath(docId) : getLibraryTrashFilePath(docId);

  try {
    return await fs.readFile(primaryPath);
  } catch (e1: unknown) {
    const code = e1 && typeof e1 === 'object' && 'code' in e1 ? String((e1 as { code?: unknown }).code) : null;
    if (code !== 'ENOENT') throw e1;
    try {
      return await fs.readFile(fallbackPath);
    } catch (e2: unknown) {
      const code2 =
        e2 && typeof e2 === 'object' && 'code' in e2 ? String((e2 as { code?: unknown }).code) : null;
      if (code2 === 'ENOENT') return null;
      throw e2;
    }
  }
}

// =============================================================================
// ERROR HELPERS (no `any`)
// =============================================================================

/**
 * Безопасно достаём строковое поле из unknown-ошибки.
 *
 * Почему так:
 * - ESLint запрещает `any`,
 * - внешние ошибки могут приходить как угодно (Error, объект, строка),
 * - нам нужно best-effort достать diagnostics (`code`, `details`).
 */
function getErrorStringField(err: unknown, field: string): string | null {
  if (!err || typeof err !== 'object') return null;
  const o = err as Record<string, unknown>;
  const v = o[field];
  return typeof v === 'string' ? v : null;
}

// =============================================================================
// HANDLER
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: AnalyzeRequestBody = await request.json();

    // -------------------------------------------------------------------------
    // 1) Валидация базовых полей
    // -------------------------------------------------------------------------
    const docIdsRaw = Array.isArray(body.docIds) ? body.docIds : [];

    // -------------------------------------------------------------------------
    // DEMO MODE (NO USER API KEY)
    // -------------------------------------------------------------------------
    //
    // В файловом менеджере анализ документов — это важная часть UX.
    // Поэтому в demo режиме мы делаем best-effort поддержку:
    // - текстовые документы: summary можно сделать через OpenRouter demo key (free model)
    // - изображения: vision в demo режиме НЕ гарантирован (free vision может отсутствовать),
    //   поэтому мы честно пропускаем изображения с понятной причиной.
    //
    // NOTE про localhost:
    // - как и в /api/chat, если пользователь использует локальный OpenAI-compatible сервер
    //   без ключа, не хотим ломать этот кейс.
    const incomingApiKey = String(body.apiKey || '').trim();
    const incomingBaseUrlRaw = String(body.apiBaseUrl || '').trim();
    const incomingBaseUrl = incomingBaseUrlRaw || DEFAULT_API_BASE_URL;

    const isLocalHostLike =
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(incomingBaseUrl);
    const isKnownRemoteProvider =
      /openrouter\.ai/i.test(incomingBaseUrl) || /api\.vsellm\.ru/i.test(incomingBaseUrl);

    const demoMode = isDemoModeApiKey(incomingApiKey) && !isLocalHostLike && (isKnownRemoteProvider || !incomingBaseUrlRaw);

    const apiKey = demoMode ? getDemoOpenRouterApiKey() : incomingApiKey;

    if (docIdsRaw.length === 0) {
      return NextResponse.json({ error: 'docIds обязателен (непустой массив)' }, { status: 400 });
    }

    // Дедуп docIds (и нормализуем к строкам).
    const docIds = Array.from(
      new Set(docIdsRaw.map((x) => String(x || '').trim()).filter(Boolean))
    );

    // -------------------------------------------------------------------------
    // 2) Готовим LLM конфиг
    // -------------------------------------------------------------------------
    const apiBaseUrl = demoMode ? OPENROUTER_BASE_URL : (String(body.apiBaseUrl || '').trim() || DEFAULT_API_BASE_URL);
    const apiUrl = `${apiBaseUrl}/chat/completions`;
    const model = demoMode ? await pickDemoChatModelId(body.model) : (String(body.model || '').trim() || DEFAULT_CHAT_MODEL_ID);
    const corporateMode = Boolean(body.corporateMode);
    const languageHintText = String(body.languageHintText || '').trim() || null;

    // -------------------------------------------------------------------------
    // 3) Читаем индекс один раз, патчим в памяти, пишем один раз
    // -------------------------------------------------------------------------
    const index = await readLibraryIndex();
    const docById = new Map(index.docs.map((d) => [d.docId, d] as const));

    const results: AnalyzeDocResult[] = [];
    let anyIndexChanged = false;

    // -------------------------------------------------------------------------
    // 4) Анализируем каждый документ
    // -------------------------------------------------------------------------
    for (const docId of docIds) {
      // docId validation (anti traversal)
      try {
        assertDocIdOrThrow(docId);
      } catch {
        results.push({ docId, status: 'skipped', reason: 'INVALID_DOC_ID' });
        continue;
      }

      const doc = docById.get(docId) || null;
      if (!doc) {
        results.push({ docId, status: 'skipped', reason: 'DOC_NOT_FOUND' });
        continue;
      }

      // Если fileHash отсутствует — это “аномалия” (для библиотеки fileHash должен быть всегда),
      // но мы делаем best-effort: без fileHash нельзя привязать анализ к версии → пропускаем.
      if (!doc.fileHash) {
        results.push({ docId, status: 'skipped', reason: 'UNSUPPORTED_KIND' });
        continue;
      }

      // -----------------------------------------------------------------------
      // 4.1) Читаем файл с диска (files/ или .trash/)
      // -----------------------------------------------------------------------
      let buf: Buffer | null;
      try {
        buf = await readLibraryDocFile(doc);
      } catch (readErr: unknown) {
        results.push({
          docId,
          status: 'error',
          error: 'FILE_READ_ERROR',
          details: readErr instanceof Error ? readErr.message : String(readErr),
        });
        continue;
      }

      if (!buf) {
        results.push({ docId, status: 'skipped', reason: 'FILE_NOT_FOUND' });
        continue;
      }

      // -----------------------------------------------------------------------
      // 4.2) Определяем "реальный" тип по magic bytes (если это изображение)
      //      Иначе пытаемся трактовать как UTF-8 текст.
      // -----------------------------------------------------------------------
      const detected = await fileTypeFromBuffer(buf);
      const detectedMime = detected?.mime || null;
      const isImage = Boolean(detectedMime && ALLOWED_IMAGE_MIMES.has(detectedMime));

      // -----------------------------------------------------------------------
      // 4.3) Идемпотентность на уровне документа
      // -----------------------------------------------------------------------
      const analysis: LibraryDocAnalysis = doc.analysis ? { ...doc.analysis } : {};

      const summaryUpToDate =
        Boolean(analysis.summary) && analysis.summaryForFileHash === doc.fileHash;
      const imageUpToDate =
        Boolean(analysis.image?.description) && analysis.imageForFileHash === doc.fileHash;

      // Если документ “уже полностью проанализирован” для своего типа — пропускаем.
      // (Для текста нам нужен summary, для изображения — description.)
      if ((isImage && imageUpToDate) || (!isImage && summaryUpToDate)) {
        results.push({ docId, status: 'skipped', reason: 'ALREADY_UP_TO_DATE' });
        continue;
      }

      // -----------------------------------------------------------------------
      // 4.3.5) Demo-mode ограничение: vision для изображений отключаем
      // -----------------------------------------------------------------------
      //
      // Почему отключаем:
      // - В OpenRouter free-пуле может НЕ быть мультимодальных моделей.
      // - Даже если появляются — их доступность/лимиты нестабильны.
      // - Мы не хотим, чтобы demo-опыт "ломался" из-за vision.
      //
      // Поэтому:
      // - для изображений в demo режиме возвращаем "skipped" с явной причиной,
      // - для текста — продолжаем (summary работает стабильно).
      if (demoMode && isImage) {
        results.push({ docId, status: 'skipped', reason: 'DEMO_MODE_VISION_DISABLED' });
        continue;
      }

      // -----------------------------------------------------------------------
      // 4.4) Выполняем анализ
      // -----------------------------------------------------------------------
      let didComputeSummary = false;
      let didComputeImageDescription = false;

      try {
        const ts = Date.now();

        if (isImage) {
          // ==============================================================
          // IMAGE → DESCRIPTION (multimodal)
          // ==============================================================
          // Превращаем файл в data URL, чтобы отправить как image_url part.
          // Это соответствует OpenAI-style “multimodal content”.
          const mime = detectedMime || doc.mime || 'application/octet-stream';
          const base64 = buf.toString('base64');
          const dataUrl = `data:${mime};base64,${base64}`;

          const description = await callChatCompletions({
            apiUrl,
            apiKey,
            model,
            corporateMode,
            messages: [
              { role: 'system', content: buildImageDescriptionSystemPrompt(languageHintText) },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe this image.' },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
            temperature: 0.2,
            maxTokens: 400,
          });

          // Пишем в индекс.
          analysis.image = {
            ...(analysis.image || {}),
            description,
            descriptionLanguage: languageHintText || analysis.image?.descriptionLanguage,
          };
          analysis.imageForFileHash = doc.fileHash;
          analysis.updatedAt = ts;
          analysis.model = model;
          didComputeImageDescription = true;
        } else {
          // ==============================================================
          // TEXT → SUMMARY
          // ==============================================================
          // Декодируем как строгий UTF-8, иначе лучше отказаться, чем “мусор” в summary.
          let text: string;
          try {
            const decoder = new TextDecoder('utf-8', { fatal: true });
            text = decoder.decode(buf);
          } catch {
            // Не UTF-8 → не поддерживаем анализ (MVP).
            results.push({ docId, status: 'skipped', reason: 'UNSUPPORTED_KIND' });
            continue;
          }

          const trimmed = text.trim();
          // Если текст очень короткий — summary = сам текст (как в /api/summarize).
          const summary =
            trimmed.length < 100
              ? trimmed
              : await callChatCompletions({
                  apiUrl,
                  apiKey,
                  model,
                  corporateMode,
                  messages: [
                    { role: 'system', content: buildSummarySystemPrompt(languageHintText) },
                    { role: 'user', content: `Суммаризируй следующий текст:\n\n${trimmed}` },
                  ],
                  temperature: 0.3,
                  maxTokens: 256,
                });

          analysis.summary = summary;
          analysis.summaryForFileHash = doc.fileHash;
          analysis.updatedAt = ts;
          analysis.model = model;
          didComputeSummary = true;
        }

        // Фиксируем изменения в doc (сохраняем excerpt и прочие поля, не связанные с анализом).
        doc.analysis = analysis;
        anyIndexChanged = true;

        results.push({
          docId,
          status: 'ok',
          kind: isImage ? 'image' : 'text',
          didComputeSummary,
          didComputeImageDescription,
        });
      } catch (err: unknown) {
        // Ошибка конкретного документа НЕ должна валить весь batch.
        const code = getErrorStringField(err, 'code');
        const details = getErrorStringField(err, 'details') || undefined;

        results.push({
          docId,
          status: 'error',
          error: code || (err instanceof Error ? err.message : 'UNKNOWN_ERROR'),
          details,
        });
      }
    }

    // -------------------------------------------------------------------------
    // 5) Пишем индекс ОДИН раз (если были изменения)
    // -------------------------------------------------------------------------
    if (anyIndexChanged) {
      await writeLibraryIndex(index);
    }

    // -------------------------------------------------------------------------
    // 5.5) Todo F: best-effort пропагация результатов анализа в canvases/*.json
    // -------------------------------------------------------------------------
    //
    // Продуктовая семантика:
    // - summary/description принадлежат ДОКУМЕНТУ (library-index), но карточки держат
    //   "derived caches" (attachmentSummaries / attachmentImageDescriptions / attachmentExcerpts),
    //   чтобы:
    //   - быстро формировать контекст для потомков,
    //   - показывать UI без дополнительных запросов.
    //
    // Поэтому после анализа мы best-effort патчим все холсты, которые используют docIds,
    // обновляя только DERIVED поля:
    // - текст: excerpt/summary
    // - изображение: image.description
    //
    // Важно:
    // - docId не меняется, attachments[] не меняем (это не replace),
    // - isStale НЕ выставляем (это не primary изменение контекста владельца),
    // - если usage-index неактуален/холст повреждён — просто пропускаем (best-effort).
    try {
      // Патчим только те docIds, где анализ реально вычислился (status: ok).
      const okDocIds = results.filter((r) => r.status === 'ok').map((r) => r.docId);
      if (okDocIds.length > 0) {
        const usageIndex = await readUsageIndex();

        // Группируем docIds по canvasId, чтобы читать/писать каждый canvas.json максимум один раз.
        const docIdsByCanvas = new Map<string, Set<string>>();
        for (const docId of okDocIds) {
          const links = getUsageLinksForDoc(usageIndex, docId);
          for (const l of links) {
            const set = docIdsByCanvas.get(l.canvasId) || new Set<string>();
            set.add(docId);
            docIdsByCanvas.set(l.canvasId, set);
          }
        }

        // Патчим каждый затронутый холст.
        for (const [canvasId, docIdSet] of docIdsByCanvas.entries()) {
          const canvasPath = getCanvasFilePath(canvasId);
          let raw: string;
          try {
            raw = await fs.readFile(canvasPath, 'utf-8');
          } catch {
            continue;
          }

          let canvasJson: unknown;
          try {
            canvasJson = JSON.parse(raw);
          } catch {
            continue;
          }

          if (!canvasJson || typeof canvasJson !== 'object') continue;
          const canvasObj = canvasJson as { nodes?: unknown };
          if (!Array.isArray(canvasObj.nodes)) continue;

          let changed = false;
          const ts = Date.now();

          for (const n of canvasObj.nodes) {
            if (!n || typeof n !== 'object') continue;
            const data = (n as { data?: unknown }).data;
            if (!data || typeof data !== 'object') continue;
            const dataObj = data as Record<string, unknown>;

            const atts = Array.isArray(dataObj.attachments) ? (dataObj.attachments as NodeAttachment[]) : null;
            if (!atts || atts.length === 0) continue;

            // Проверяем, что в ноде вообще есть ссылки на нужные docIds.
            const hasAny = atts.some((a) => a && docIdSet.has(String(a.attachmentId || '')));
            if (!hasAny) continue;

            const excerpts =
              dataObj.attachmentExcerpts && typeof dataObj.attachmentExcerpts === 'object'
                ? (dataObj.attachmentExcerpts as Record<string, string>)
                : {};
            const summaries =
              dataObj.attachmentSummaries && typeof dataObj.attachmentSummaries === 'object'
                ? (dataObj.attachmentSummaries as Record<string, string>)
                : {};
            const imageDescs =
              dataObj.attachmentImageDescriptions && typeof dataObj.attachmentImageDescriptions === 'object'
                ? (dataObj.attachmentImageDescriptions as Record<string, string>)
                : {};

            // Для каждой ссылки в этой ноде обновляем derived поля.
            for (const a of atts) {
              const id = String(a?.attachmentId || '').trim();
              if (!id || !docIdSet.has(id)) continue;

              const doc = docById.get(id) || null;
              if (!doc) continue;

              if (doc.kind === 'text') {
                // excerpt
                if (doc.analysis?.excerpt) excerpts[id] = doc.analysis.excerpt;
                else delete excerpts[id];

                // summary
                if (doc.analysis?.summary) summaries[id] = doc.analysis.summary;
                else delete summaries[id];

                // images not applicable
                delete imageDescs[id];
              } else {
                // image: description
                const desc = doc.analysis?.image?.description;
                if (desc) imageDescs[id] = desc;
                else delete imageDescs[id];

                // text fields not applicable
                delete excerpts[id];
                delete summaries[id];
              }
            }

            // Сохраняем обратно только непустые объекты.
            dataObj.attachmentExcerpts = Object.keys(excerpts).length > 0 ? excerpts : undefined;
            dataObj.attachmentSummaries = Object.keys(summaries).length > 0 ? summaries : undefined;
            dataObj.attachmentImageDescriptions = Object.keys(imageDescs).length > 0 ? imageDescs : undefined;
            dataObj.updatedAt = ts;
            changed = true;
          }

          if (changed) {
            await fs.writeFile(canvasPath, JSON.stringify(canvasJson, null, 2), 'utf-8');
          }
        }
      }
    } catch (patchErr) {
      console.warn('[Library API] analyze: не удалось пропатчить canvases derived-метаданными (best-effort):', patchErr);
    }

    // -------------------------------------------------------------------------
    // 6) touched (Todo D): где используются docIds
    // -------------------------------------------------------------------------
    //
    // Зачем:
    // - клиенту важно быстро обновить АКТИВНЫЙ холст в памяти,
    //   если он прямо сейчас открыт, а сервер пропатчил canvas.json на диске.
    // - touched содержит:
    //   - canvasId
    //   - nodeIds (конкретные карточки, где есть ссылка на docId)
    //
    // Важно:
    // - usage-index может быть неактуален (best-effort), поэтому и touched best-effort.
    let touched: Array<{ canvasId: string; nodeIds: string[] }> = [];
    try {
      const usageIndex = await readUsageIndex();
      const byCanvas = new Map<string, Set<string>>();
      for (const id of docIds) {
        const links = getUsageLinksForDoc(usageIndex, id);
        for (const l of links) {
          const set = byCanvas.get(l.canvasId) || new Set<string>();
          for (const nid of l.nodeIds || []) set.add(nid);
          byCanvas.set(l.canvasId, set);
        }
      }
      touched = Array.from(byCanvas.entries()).map(([canvasId, set]) => ({ canvasId, nodeIds: Array.from(set) }));
    } catch (e) {
      console.warn('[Library API] analyze: не удалось прочитать usage-index для touched (best-effort):', e);
    }

    // -------------------------------------------------------------------------
    // 7) docs (для client-side in-memory patch)
    // -------------------------------------------------------------------------
    //
    // Мы возвращаем "минимально достаточный" snapshot анализа, чтобы клиент мог:
    // - обновить node.data.attachmentSummaries / attachmentImageDescriptions / attachmentExcerpts
    //   прямо в активном холсте (без доп. запросов).
    //
    // Важно:
    // - это НЕ полный list /api/library, а только нужные поля по docIds запроса.
    const docs = docIds
      .map((id) => docById.get(id) || null)
      .filter(Boolean)
      .map((d) => ({
        docId: d!.docId,
        kind: d!.kind,
        analysis: d!.analysis
          ? {
              excerpt: d!.analysis.excerpt,
              summary: d!.analysis.summary,
              image: d!.analysis.image?.description ? { description: d!.analysis.image.description } : undefined,
            }
          : undefined,
      }));

    return NextResponse.json({
      success: true,
      updated: anyIndexChanged,
      results,
      touched,
      docs,
    });
  } catch (error) {
    console.error('[Library API] POST /api/library/analyze error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось проанализировать документы', details: message }, { status: 500 });
  }
}

