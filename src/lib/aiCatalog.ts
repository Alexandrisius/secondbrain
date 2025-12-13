/**
 * @file aiCatalog.ts
 * @description Единый “каталог” AI-моделей, используемых в приложении.
 *
 * Зачем этот файл существует:
 * - Мы хотим иметь ОДИН источник правды для списка моделей в UI.
 * - Нам важно хранить не только строковый `id` модели,
 *   но и метаданные, которые понадобятся в будущем:
 *   - максимальный размер контекстного окна (maxContextTokens)
 *   - разработчик (developer) для группировки
 *   - человекочитаемое имя
 * - Пользователь (вы) может быстро обновлять список моделей,
 *   не копаясь в логике компонентов.
 *
 * ВАЖНО:
 * - `id` должен совпадать с тем, что принимает ваш провайдер OpenAI-compatible.
 *   Для OpenRouter это обычно формат `vendor/model`.
 * - `maxContextTokens` — справочная величина.
 *   Она НЕ ограничивает API запросы сама по себе — это просто данные,
 *   которые UI и будущая логика могут использовать (валидация, подсказки и т.д.).
 */

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Известные разработчики (для группировки в UI).
 *
 * Можно расширять при добавлении новых моделей.
 */
export type ModelDeveloper =
  | 'OpenAI'
  | 'DeepSeek'
  | 'Anthropic'
  | 'xAI'
  | 'Google'
  | 'MoonshotAI'
  | 'Qwen'
  | 'BAAI'
  | 'Other';

/**
 * Метаданные chat-модели.
 */
export interface ChatModelInfo {
  /**
   * ID модели для API запроса.
   * Пример: `google/gemini-2.5-flash`
   */
  id: string;

  /**
   * Разработчик модели — используется для группировки списка.
   */
  developer: ModelDeveloper;

  /**
   * Человекочитаемое название (то, что показываем в UI).
   *
   * ВАЖНО:
   * - мы сознательно отделяем `displayName` от `id`
   *   (например, чтобы можно было красиво подписать “preview” и т.п.).
   */
  displayName: string;

  /**
   * Максимальный размер контекстного окна в токенах.
   *
   * Это поле — именно то “полноценное поле”, к которому вы сможете обращаться
   * из любых частей приложения, чтобы получать цифры контекста.
   */
  maxContextTokens: number;
}

/**
 * Метаданные embedding-модели.
 */
export interface EmbeddingModelInfo {
  /** ID модели для API запроса. */
  id: string;

  /** Разработчик модели — используется для группировки списка. */
  developer: ModelDeveloper;

  /** Человекочитаемое название. */
  displayName: string;

  /**
   * Размерность вектора эмбеддинга.
   *
   * ВАЖНО:
   * - У некоторых моделей размерность может быть настраиваемой параметром `dimensions`.
   *   В таких случаях мы храним “типичную/дефолтную” размерность,
   *   чтобы UI мог объяснять пользователю, что будет в базе.
   */
  dimension: number;

  /** Короткое пояснение, чтобы в UI было понятно, что это за модель. */
  description: string;
}

// =============================================================================
// CHAT MODELS (ваш список + max context)
// =============================================================================

/**
 * Список chat-моделей, доступных пользователю.
 *
 * Как быстро добавить новую модель:
 * - добавьте новый объект `{ id, developer, displayName, maxContextTokens }`
 * - UI автоматически подхватит изменения
 *
 * ВАЖНО:
 * - значения `maxContextTokens` взяты из вашего списка.
 */
export const CHAT_MODELS: ChatModelInfo[] = [
  // ---------------------------------------------------------------------------
  // OpenAI
  // ---------------------------------------------------------------------------
  {
    id: 'openai/gpt-5.2',
    developer: 'OpenAI',
    displayName: 'GPT-5.2',
    maxContextTokens: 400_000,
  },
  {
    id: 'openai/gpt-oss-20b',
    developer: 'OpenAI',
    displayName: 'GPT OSS 20B',
    maxContextTokens: 131_072,
  },
  {
    id: 'openai/gpt-oss-120b',
    developer: 'OpenAI',
    displayName: 'GPT OSS 120B',
    maxContextTokens: 131_072,
  },

  // ---------------------------------------------------------------------------
  // DeepSeek
  // ---------------------------------------------------------------------------
  {
    id: 'deepseek/deepseek-v3.2',
    developer: 'DeepSeek',
    displayName: 'DeepSeek V3.2',
    maxContextTokens: 163_840,
  },

  // ---------------------------------------------------------------------------
  // Anthropic
  // ---------------------------------------------------------------------------
  {
    id: 'anthropic/claude-opus-4.5',
    developer: 'Anthropic',
    displayName: 'Claude Opus 4.5',
    maxContextTokens: 200_000,
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    developer: 'Anthropic',
    displayName: 'Claude Sonnet 4.5',
    maxContextTokens: 1_000_000,
  },

  // ---------------------------------------------------------------------------
  // xAI
  // ---------------------------------------------------------------------------
  {
    id: 'x-ai/grok-4.1-fast',
    developer: 'xAI',
    displayName: 'Grok 4.1 Fast',
    maxContextTokens: 2_000_000,
  },

  // ---------------------------------------------------------------------------
  // Google
  // ---------------------------------------------------------------------------
  {
    id: 'google/gemini-3-pro-preview',
    developer: 'Google',
    displayName: 'Gemini 3 Pro Preview',
    maxContextTokens: 1_048_576,
  },
  {
    id: 'google/gemini-2.5-flash-lite',
    developer: 'Google',
    displayName: 'Gemini 2.5 Flash Lite',
    maxContextTokens: 1_048_576,
  },
  {
    // ВАЖНО: это ваша дефолтная модель (см. useSettingsStore DEFAULT_MODEL)
    id: 'google/gemini-2.5-flash',
    developer: 'Google',
    displayName: 'Gemini 2.5 Flash',
    maxContextTokens: 1_048_576,
  },

  // ---------------------------------------------------------------------------
  // MoonshotAI
  // ---------------------------------------------------------------------------
  {
    id: 'moonshotai/kimi-k2-thinking',
    developer: 'MoonshotAI',
    displayName: 'Kimi K2 Thinking',
    maxContextTokens: 262_144,
  },

  // ---------------------------------------------------------------------------
  // Qwen
  // ---------------------------------------------------------------------------
  {
    id: 'qwen/qwen3-max',
    developer: 'Qwen',
    displayName: 'Qwen3 Max',
    maxContextTokens: 256_000,
  },
];

/**
 * Дефолтная chat-модель приложения.
 *
 * Вынесено сюда, чтобы:
 * - UI/Store/логика не расходились
 * - можно было менять “дефолт” одним местом
 */
export const DEFAULT_CHAT_MODEL_ID = 'google/gemini-2.5-flash';

/**
 * Небольшой список “популярных” моделей для быстрых кнопок.
 *
 * UX-логика:
 * - кнопки должны быть коротким набором, чтобы не перегружать UI.
 * - полный список доступен в селекте.
 */
export const POPULAR_CHAT_MODEL_IDS: string[] = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'anthropic/claude-sonnet-4.5',
  'anthropic/claude-opus-4.5',
  'openai/gpt-5.2',
];

// =============================================================================
// EMBEDDING MODELS (ваш список)
// =============================================================================

/**
 * Список embedding-моделей (для OpenRouter) + размерности.
 *
 * Примечания по размерностям (источники):
 * - Qwen3 Embedding 8B: 4096 (по умолчанию)
 * - Qwen3 Embedding 4B: 2560 (по умолчанию)
 * - OpenAI text-embedding-3-small: 1536
 * - OpenAI text-embedding-3-large: 3072
 * - BAAI bge-m3: 1024
 * - Google gemini-embedding-001: дефолт 3072 (поддерживает уменьшение)
 */
export const EMBEDDING_MODELS: EmbeddingModelInfo[] = [
  // ---------------------------------------------------------------------------
  // Qwen
  // ---------------------------------------------------------------------------
  {
    id: 'qwen/qwen3-embedding-8b',
    developer: 'Qwen',
    displayName: 'Qwen3 Embedding 8B',
    dimension: 4096,
    description: 'Мультиязычная, высокая точность (рекомендуется)',
  },
  {
    id: 'qwen/qwen3-embedding-4b',
    developer: 'Qwen',
    displayName: 'Qwen3 Embedding 4B',
    dimension: 2560,
    description: 'Мультиязычная, легче и дешевле, чем 8B',
  },

  // ---------------------------------------------------------------------------
  // OpenAI
  // ---------------------------------------------------------------------------
  {
    id: 'openai/text-embedding-3-small',
    developer: 'OpenAI',
    displayName: 'Text Embedding 3 Small',
    dimension: 1536,
    description: 'Быстрая и экономичная',
  },
  {
    id: 'openai/text-embedding-3-large',
    developer: 'OpenAI',
    displayName: 'Text Embedding 3 Large',
    dimension: 3072,
    description: 'Максимальное качество',
  },

  // ---------------------------------------------------------------------------
  // Google
  // ---------------------------------------------------------------------------
  {
    id: 'google/gemini-embedding-001',
    developer: 'Google',
    displayName: 'Gemini Embedding 001',
    dimension: 3072,
    description: 'Поддерживает настраиваемую размерность (MRL), дефолт 3072',
  },

  // ---------------------------------------------------------------------------
  // BAAI
  // ---------------------------------------------------------------------------
  {
    id: 'baai/bge-m3',
    developer: 'BAAI',
    displayName: 'BGE M3',
    dimension: 1024,
    description: 'Универсальная мультиязычная модель для retrieval',
  },
];

/**
 * Дефолтная embedding-модель для OpenRouter.
 *
 * Вы выбрали `qwen/qwen3-embedding-8b` как основной вариант.
 */
export const DEFAULT_OPENROUTER_EMBEDDING_MODEL_ID = 'qwen/qwen3-embedding-8b';

/**
 * Дефолтная embedding-модель для Custom (VSELLM).
 *
 * ВАЖНО:
 * - VSELLM исторически мог принимать и “короткое” имя без префикса.
 * - Чтобы не ломать обратную совместимость, мы будем аккуратно мигрировать
 *   и/или оставлять возможность выбрать нужное значение.
 *
 * Сейчас задаём “короткое” имя без префикса (`text-embedding-3-small`),
 * потому что многие OpenAI-compatible провайдеры (включая VSELLM) ожидают именно его.
 *
 * ВАЖНО:
 * - Для OpenRouter мы используем “vendor/model” (см. DEFAULT_OPENROUTER_EMBEDDING_MODEL_ID).
 */
export const DEFAULT_CUSTOM_EMBEDDING_MODEL_ID = 'text-embedding-3-small';

// =============================================================================
// УТИЛИТЫ (для UI и будущих задач)
// =============================================================================

/**
 * Группирует элементы по `developer`.
 *
 * Это универсальная функция, чтобы:
 * - строить `<optgroup>` в UI
 * - избегать дублирования логики группировки в компонентах
 */
export function groupByDeveloper<T extends { developer: ModelDeveloper }>(items: T[]): Record<ModelDeveloper, T[]> {
  const result: Record<ModelDeveloper, T[]> = {
    OpenAI: [],
    DeepSeek: [],
    Anthropic: [],
    xAI: [],
    Google: [],
    MoonshotAI: [],
    Qwen: [],
    BAAI: [],
    Other: [],
  };

  for (const item of items) {
    const key = item.developer ?? 'Other';
    // Если когда-то появится новый developer (расширили union),
    // TypeScript заставит обновить этот объект — это специально.
    result[key].push(item);
  }

  return result;
}

/**
 * Возвращает maxContextTokens для модели по `modelId`.
 *
 * Это ключевой helper для будущей логики:
 * - UI может показывать подсказки
 * - валидатор может предупреждать о переполнении контекста
 * - можно автоматически переключать summarization и т.д.
 */
export function getChatModelMaxContextTokens(modelId: string): number | null {
  const found = CHAT_MODELS.find((m) => m.id === modelId);
  return found ? found.maxContextTokens : null;
}

/**
 * Удобный форматтер для UI: `1_048_576` -> `1,048,576`.
 *
 * ВАЖНО:
 * - Используем en-US, потому что это “де-факто стандарт” для разрядов с запятыми.
 * - Если захотите русские пробелы, легко поменять на `ru-RU`.
 */
export function formatTokenCount(tokens: number): string {
  return new Intl.NumberFormat('en-US').format(tokens);
}
