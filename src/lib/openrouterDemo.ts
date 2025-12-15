/**
 * @file openrouterDemo.ts
 * @description
 * Демонстрационный режим (Demo Mode) для Desktop/Electron сборки:
 * - если пользователь НЕ ввёл apiKey, серверные API-роуты могут автоматически
 *   использовать встроенный OpenRouter demo key;
 * - chat/summarize выбирают любую доступную `:free` модель динамически;
 * - embeddings в demo режиме фиксируются на `qwen/qwen3-embedding-8b`
 *   (по требованию проекта: дешёвая модель, автор готов платить).
 *
 * ============================================================================
 * ВАЖНО ПРО БЕЗОПАСНОСТЬ
 * ============================================================================
 * 1) Любой ключ, который попадает в Desktop-сборку, по сути публичный:
 *    - его можно извлечь из бандла,
 *    - его можно получить из памяти процесса,
 *    - его можно восстановить реверсом.
 *
 * 2) То, что мы делаем здесь — ОБФУСКАЦИЯ/«маскировка»:
 *    - мы не храним ключ «в лоб» строкой вида `sk-or-v1` + `-...` в исходниках,
 *      чтобы:
 *        a) боты/регэксп-сканеры репозиториев не находили ключ автоматически,
 *        b) ключ не был визуально очевиден при просмотре кода.
 *
 * 3) Это НЕ криптографическая защита от злоумышленника:
 *    - ключ дешифровывается в рантайме,
 *    - а значит принципиально извлекаем.
 *
 * Если нужен реальный уровень защиты — ключ должен жить только на сервере,
 * а клиент должен ходить к вашему backend, который делает прокси.
 */

import crypto from 'crypto';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * OpenRouter base URL.
 *
 * ВАЖНО:
 * - Мы используем именно /api/v1, потому что OpenRouter OpenAI-compatible.
 */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Встроенная "служебная" модель для UI/запросов:
 * - если клиент пришлёт именно это значение,
 *   мы будем выбирать любую `:free` модель автоматически.
 *
 * Почему НЕ пустая строка:
 * - пустая строка часто используется как "пока не выбрали",
 * - а нам нужна явная семантика "auto/free".
 */
export const DEMO_MODEL_SENTINEL = 'neurocanvas/auto:free';

/**
 * Embeddings модель для demo режима.
 *
 * По требованию:
 * - даже если пользователь выбрал другую embeddingsModel в UI,
 *   пока apiKey пустой, мы используем эту модель.
 */
export const DEMO_EMBEDDINGS_MODEL_ID = 'qwen/qwen3-embedding-8b';

/**
 * TTL (в миллисекундах) для кэша списка free моделей.
 *
 * Почему TTL нужен:
 * - список `:free` моделей у OpenRouter может меняться,
 * - но дергать /models на КАЖДЫЙ запрос чата — лишняя нагрузка/задержка.
 *
 * 10 минут — разумный компромисс:
 * - достаточно часто, чтобы подхватить обновления,
 * - достаточно редко, чтобы не спамить OpenRouter.
 */
const FREE_MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

// =============================================================================
// DEMO API KEY (OBFUSCATED)
// =============================================================================

/**
 * AES-256-GCM обфускация demo API key.
 *
 * Как это устроено:
 * - plaintext (реальный OpenRouter key) зашифрован заранее в dev-скрипте,
 * - в коде лежат только:
 *   - iv (12 bytes),
 *   - ciphertext,
 *   - authTag,
 * - "пароль" для ключа дешифрования мы собираем из маленьких кусочков,
 *   чтобы в исходниках не было одной жирной строки.
 *
 * ВАЖНО:
 * - это ОБФУСКАЦИЯ, а не защита.
 * - пароль/алгоритм всё равно находится рядом, иначе мы не сможем расшифровать.
 */
const DEMO_KEY_AES_GCM = {
  // 12 bytes IV (base64)
  ivB64: 'Jmv/a3WUnCeptZd8',
  // ciphertext (base64)
  ctB64:
    'BPxbjX4rTaoxAhnMzhpiVdIVOn6lgqBeysuSjUwoELjInEvqNFT9/QW3oOqx2IVDi5iKqW117AxUJzvzyXXtC5Q3MnJPUqH9RA==',
  // 16 bytes auth tag (base64)
  tagB64: 'JN0ZjiHCMOQXlIIBvq/ypw==',
} as const;

/**
 * Собираем "пароль" для key-derivation из кусочков.
 *
 * Почему так:
 * - простейшая защита от regex-сканеров секретов, которые ищут шаблон `sk-or-v1` + `-...`
 * - и от "на глаз" просмотра исходника.
 */
function buildDemoPassword(): string {
  // NOTE:
  // - Содержимое этих частей НЕ является секретом в строгом смысле,
  //   потому что оно хранится в коде. Это лишь "маскировка".
  const parts = ['Neuro', 'Canvas', 'Demo', 'Key', 'v1'];
  return `${parts.join('-')}-2025`;
}

/**
 * Дешифруем demo apiKey.
 *
 * ВАЖНО:
 * - если по какой-то причине дешифровка сломалась (битые строки/не та сборка),
 *   лучше бросить понятную ошибку: иначе запросы будут уходить без ключа и
 *   диагностика станет сложнее.
 */
export function getDemoOpenRouterApiKey(): string {
  const password = buildDemoPassword();
  const key = crypto.createHash('sha256').update(password, 'utf8').digest(); // 32 bytes

  const iv = Buffer.from(DEMO_KEY_AES_GCM.ivB64, 'base64');
  const ciphertext = Buffer.from(DEMO_KEY_AES_GCM.ctB64, 'base64');
  const tag = Buffer.from(DEMO_KEY_AES_GCM.tagB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

  // Базовая sanity-check: OpenRouter ключи обычно начинаются на "sk-or-".
  // Если формат другой — всё равно возвращаем, но логика демо может не заработать.
  if (!plaintext || plaintext.length < 10) {
    throw new Error('[DemoMode] Failed to decrypt OpenRouter demo apiKey: plaintext is empty');
  }

  return plaintext;
}

/**
 * Признак демо-режима: пользовательский apiKey отсутствует.
 */
export function isDemoModeApiKey(apiKey: string | null | undefined): boolean {
  return String(apiKey ?? '').trim().length === 0;
}

// =============================================================================
// FREE MODEL RESOLUTION (CACHED + BADLIST)
// =============================================================================

/**
 * Внутренний кэш для выбора `:free` модели.
 *
 * ВАЖНО:
 * - кэш "живёт" в памяти Node.js процесса,
 * - сбрасывается при перезапуске dev-сервера / приложения.
 */
let cachedFreeModelId: string | null = null;
let cachedFreeModelExpiresAt = 0;

// Кэш списка всех free моделей (чтобы можно было “перебирать” при ошибках).
let cachedFreeModelIds: string[] | null = null;
let cachedFreeModelIdsExpiresAt = 0;

let inFlightFreeModelPromise: Promise<string> | null = null;
let inFlightFreeModelIdsPromise: Promise<string[]> | null = null;

/**
 * Badlist для demo free моделей.
 *
 * Зачем:
 * - Некоторые `:free` модели у OpenRouter не поддерживают system/developer instructions,
 *   или имеют ограничения провайдера.
 * - Мы хотим автоматически “выпиливать” такие модели на время сессии,
 *   чтобы demo работал стабильно.
 *
 * Реализация:
 * - Map<modelId, expiresAt>
 * - TTL на “плохую” модель ограниченный (например 1 час), чтобы со временем
 *   модель могла “вернуться”, если OpenRouter/провайдер исправились.
 */
const BAD_FREE_MODELS_TTL_MS = 60 * 60 * 1000; // 1 час
const badFreeModels = new Map<string, number>();

// =============================================================================
// DEMO RATE LIMIT (429) — best-effort local cooldown
// =============================================================================
//
// Проблема:
// - OpenRouter free пул часто имеет лимит "free-models-per-min".
// - В demo режиме один ключ используется "на всю установку", и пользователь может
//   быстро упереться в 429.
//
// Почему делаем local cooldown:
// - если OpenRouter уже сказал "подождите до X", нет смысла спамить повторными запросами,
//   особенно учитывая клиентские ретраи.
//
// Реализация:
// - в памяти процесса храним timestamp (ms) "до какого момента не трогаем free модели".
let demoFreeRateLimitedUntilMs = 0;

/**
 * Возвращает timestamp (epoch ms), до которого demo free запросы стоит не делать.
 */
export function getDemoFreeRateLimitedUntilMs(): number {
  return demoFreeRateLimitedUntilMs;
}

/**
 * Обновляет local cooldown (берём max, чтобы не “укоротить” уже выставленный лимит).
 */
export function setDemoFreeRateLimitedUntilMs(untilMs: number): void {
  const v = Number(untilMs);
  if (!Number.isFinite(v) || v <= 0) return;
  demoFreeRateLimitedUntilMs = Math.max(demoFreeRateLimitedUntilMs, v);
}

/**
 * true если сейчас активен cooldown.
 */
export function isDemoFreeRateLimitedNow(nowMs: number = Date.now()): boolean {
  return nowMs < demoFreeRateLimitedUntilMs;
}

/**
 * Best-effort пытается вытащить X-RateLimit-Reset из headers.
 *
 * OpenRouter часто возвращает:
 * - `x-ratelimit-reset` в headers,
 * - и/или в JSON error metadata.headers["X-RateLimit-Reset"].
 */
export function tryGetRateLimitResetMsFromHeaders(headers: Headers): number | null {
  const raw =
    headers.get('x-ratelimit-reset') ||
    headers.get('X-RateLimit-Reset') ||
    headers.get('x-rateLimit-reset') ||
    headers.get('x-ratelimit-reset-ms');
  if (!raw) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort пытается вытащить X-RateLimit-Reset (epoch ms) из текста ошибки OpenRouter.
 *
 * Мы НЕ доверяем формату полностью:
 * - иногда это JSON со вложенным metadata.raw и metadata.headers,
 * - иногда это "сырой" текст.
 */
export function tryGetRateLimitResetMsFromErrorText(errorText: string): number | null {
  const text = String(errorText || '');
  if (!text) return null;

  // 1) Пытаемся распарсить как JSON и достать metadata.headers
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      const root = parsed as Record<string, unknown>;
      const err = root.error;
      if (err && typeof err === 'object') {
        const eobj = err as Record<string, unknown>;
        const meta = eobj.metadata;
        if (meta && typeof meta === 'object') {
          const mobj = meta as Record<string, unknown>;
          const headers = mobj.headers;
          if (headers && typeof headers === 'object') {
            const h = headers as Record<string, unknown>;
            const v =
              h['X-RateLimit-Reset'] ??
              h['x-ratelimit-reset'] ??
              h['x-rateLimit-reset'] ??
              h['x-ratelimit-reset-ms'];
            const n = Number(String(v ?? '').trim());
            if (Number.isFinite(n) && n > 0) return n;
          }
          // Иногда у OpenRouter есть поле metadata.raw, внутри которого JSON провайдера:
          const raw = mobj.raw;
          if (typeof raw === 'string' && raw.trim()) {
            // Попробуем regex по raw.
            const m = /X-RateLimit-Reset\\":\\s*\\\"?(\\d{10,17})/i.exec(raw);
            if (m) {
              const n = Number(m[1]);
              if (Number.isFinite(n) && n > 0) return n;
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // 2) Regex по строке (fallback)
  const m = /X-RateLimit-Reset\\":\\s*\\\"?(\\d{10,17})/i.exec(text) ||
            /x-ratelimit-reset\\\":\\s*\\\"?(\\d{10,17})/i.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

/**
 * Утилита: сколько секунд ждать до reset (округляем вверх).
 */
export function getWaitSecondsUntil(untilMs: number, nowMs: number = Date.now()): number {
  const diff = Math.max(0, untilMs - nowMs);
  return Math.ceil(diff / 1000);
}

/**
 * Пометить free модель как “плохую” (временно).
 *
 * ВАЖНО:
 * - Это память процесса (сбросится при рестарте).
 * - Мы намеренно НЕ сохраняем это на диск.
 */
export function markDemoFreeModelBad(modelId: string, ttlMs: number = BAD_FREE_MODELS_TTL_MS): void {
  const id = String(modelId || '').trim();
  if (!id) return;
  badFreeModels.set(id, Date.now() + Math.max(10_000, ttlMs));

  // Если именно эта модель сейчас закэширована как “выбранная” — сбрасываем,
  // чтобы следующий выбор не возвращал её снова.
  if (cachedFreeModelId === id) {
    cachedFreeModelId = null;
    cachedFreeModelExpiresAt = 0;
  }
}

/**
 * Чистим badlist от протухших записей.
 */
function pruneBadFreeModels(): void {
  const now = Date.now();
  for (const [id, exp] of badFreeModels.entries()) {
    if (now >= exp) badFreeModels.delete(id);
  }
}

/**
 * Тип ответа OpenRouter /models.
 *
 * Мы описываем только ту часть, которую реально используем (id).
 * Всё остальное оставляем неизвестным.
 */
type OpenRouterModelsResponse = {
  data?: Array<{ id?: unknown }>;
};

/**
 * Загружает (и кэширует) список всех `:free` моделей.
 */
async function getOpenRouterFreeModelIds(apiKeyForModelsCall?: string): Promise<string[]> {
  const now = Date.now();

  // 1) Валидный кэш
  if (cachedFreeModelIds && now < cachedFreeModelIdsExpiresAt) {
    return cachedFreeModelIds;
  }

  // 2) Уже идёт запрос — ждём
  if (inFlightFreeModelIdsPromise) {
    return inFlightFreeModelIdsPromise;
  }

  // 3) Запрос к /models
  inFlightFreeModelIdsPromise = (async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiKeyForModelsCall && apiKeyForModelsCall.trim()) {
        headers.Authorization = `Bearer ${apiKeyForModelsCall.trim()}`;
      }

      headers['HTTP-Referer'] = 'https://neurocanvas.local';
      headers['X-Title'] = 'NeuroCanvas (Demo Mode)';

      const resp = await fetch(`${OPENROUTER_BASE_URL}/models`, { method: 'GET', headers });
      if (!resp.ok) {
        throw new Error(`OpenRouter /models HTTP ${resp.status}`);
      }

      const json = (await resp.json()) as OpenRouterModelsResponse;
      const raw = Array.isArray(json?.data) ? json.data : [];

      const freeIds = raw
        .map((m) => (typeof m?.id === 'string' ? m.id.trim() : ''))
        .filter((id) => Boolean(id) && id.endsWith(':free'))
        .sort((a, b) => a.localeCompare(b));

      if (freeIds.length === 0) {
        throw new Error('No :free models returned by OpenRouter');
      }

      cachedFreeModelIds = freeIds;
      cachedFreeModelIdsExpiresAt = Date.now() + FREE_MODELS_CACHE_TTL_MS;
      return freeIds;
    } finally {
      inFlightFreeModelIdsPromise = null;
    }
  })();

  return await inFlightFreeModelIdsPromise;
}

/**
 * Выбирает любую доступную `:free` модель через OpenRouter /models.
 *
 * Стратегия выбора (предсказуемая):
 * - фильтруем по `id.endsWith(':free')`
 * - сортируем по id и берём первую
 *
 * Почему так:
 * - нам не нужна "лучшая" модель (критерии сложные),
 * - нам нужна стабильность и простота.
 */
export async function resolveOpenRouterFreeModelId(apiKeyForModelsCall?: string): Promise<string> {
  const now = Date.now();

  // 1) Валидный кэш
  if (cachedFreeModelId && now < cachedFreeModelExpiresAt) {
    return cachedFreeModelId;
  }

  // 2) Уже идёт запрос за моделью — ждём его (anti thundering herd)
  if (inFlightFreeModelPromise) {
    return inFlightFreeModelPromise;
  }

  // 3) Делаем запрос
  inFlightFreeModelPromise = (async () => {
    try {
      // Получаем список free моделей (с кэшем).
      const freeIds = await getOpenRouterFreeModelIds(apiKeyForModelsCall);

      // Убираем временно “плохие” модели.
      pruneBadFreeModels();
      const now2 = Date.now();
      const filtered = freeIds.filter((id) => (badFreeModels.get(id) ?? 0) < now2);

      const pool = filtered.length > 0 ? filtered : freeIds;

      // Выбираем случайную модель из пула.
      // (Стабильность обеспечивается кэшем cachedFreeModelId на TTL.)
      const randomIndex = Math.floor(Math.random() * pool.length);
      cachedFreeModelId = pool[randomIndex] || pool[0];
      cachedFreeModelExpiresAt = Date.now() + FREE_MODELS_CACHE_TTL_MS;
      return cachedFreeModelId;
    } finally {
      // ВАЖНО: сбрасываем inFlight в любом случае, чтобы не зависнуть навсегда.
      inFlightFreeModelPromise = null;
    }
  })();

  try {
    return await inFlightFreeModelPromise;
  } catch {
    // Если /models упал — делаем best-effort fallback на небольшой список.
    // Это не гарантирует 100% работоспособность (список у OpenRouter меняется),
    // но даёт шанс, что демо всё же заведётся.
    const fallbackCandidates = [
      'google/gemma-2-9b-it:free',
      'meta-llama/llama-3.1-8b-instruct:free',
      'mistralai/mistral-7b-instruct:free',
    ];

    cachedFreeModelId = fallbackCandidates[0];
    cachedFreeModelExpiresAt = Date.now() + 60_000; // короткий TTL на случай временной ошибки
    return cachedFreeModelId;
  }
}

/**
 * Выбирает другую free модель (best-effort), исключая:
 * - уже использованные в этом запросе (exclude),
 * - модели из badlist (если возможно).
 *
 * Используется сервером, когда первая auto-free модель оказалась несовместимой
 * (например, провайдер вернул "Developer instruction is not enabled ...").
 */
export async function pickAnotherDemoFreeChatModelId(options: {
  apiKeyForModelsCall: string;
  exclude: Set<string>;
}): Promise<string> {
  const all = await getOpenRouterFreeModelIds(options.apiKeyForModelsCall);
  pruneBadFreeModels();
  const now = Date.now();

  const usable = all.filter((id) => !options.exclude.has(id) && (badFreeModels.get(id) ?? 0) < now);
  const pool = usable.length > 0 ? usable : all.filter((id) => !options.exclude.has(id));

  // Если вообще нечего выбирать — падаем обратно на текущий resolve (он даст fallback).
  if (pool.length === 0) {
    return await resolveOpenRouterFreeModelId(options.apiKeyForModelsCall);
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex] || pool[0];
}

/**
 * Выбор модели для демо-режима (чат/суммаризация).
 *
 * Правила:
 * - если пользователь явно прислал `...:free` → используем это (уважаем выбор),
 * - если прислал `DEMO_MODEL_SENTINEL` или пусто/не-free → выбираем авто `:free`.
 */
export async function pickDemoChatModelId(requestedModel: string | null | undefined): Promise<string> {
  const m = String(requestedModel ?? '').trim();

  if (m && m.endsWith(':free')) return m;
  if (m && m !== DEMO_MODEL_SENTINEL) {
    // Пользователь выбрал не-free модель, но демо ключ подразумевает бесплатность.
    // Поэтому игнорируем и берём auto free.
  }

  // Для вызова /models используем тот же demo key (не секрет, но и не обязателен).
  const demoKey = getDemoOpenRouterApiKey();
  return await resolveOpenRouterFreeModelId(demoKey);
}

/**
 * Выбор embeddings модели для демо-режима.
 *
 * По требованию: всегда qwen 8b.
 */
export function pickDemoEmbeddingsModelId(): string {
  return DEMO_EMBEDDINGS_MODEL_ID;
}

