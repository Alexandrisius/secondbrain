/**
 * @file embeddings.ts
 * @description TypeScript типы для системы семантического поиска
 * 
 * Определяет структуры данных для:
 * - Хранения эмбеддингов в IndexedDB
 * - API запросов/ответов
 * - Результатов поиска
 */

// =============================================================================
// ТИПЫ ДЛЯ ХРАНЕНИЯ ЭМБЕДДИНГОВ
// =============================================================================

/**
 * Запись эмбеддинга в IndexedDB
 * 
 * Хранит векторное представление карточки для семантического поиска.
 * Связана с конкретной нодой и холстом.
 */
export interface EmbeddingRecord {
  /** Уникальный ID записи (совпадает с nodeId для простоты) */
  id: string;
  
  /** ID ноды (карточки) */
  nodeId: string;
  
  /** ID холста, на котором находится нода */
  canvasId: string;
  
  /** Вектор эмбеддинга (размерность зависит от модели) */
  embedding: number[];
  
  /** Оригинальный промпт карточки (для отображения в результатах) */
  prompt: string;
  
  /** Полный ответ (ранее был responsePreview с ограничением) */
  responsePreview: string;
  
  /** Временная метка создания/обновления эмбеддинга */
  updatedAt: number;
  
  /** Размерность вектора (для валидации) */
  dimension: number;
}

// =============================================================================
// ТИПЫ ДЛЯ API
// =============================================================================

/**
 * Тело запроса к /api/embeddings
 */
export interface EmbeddingRequest {
  /** Текст для векторизации (обычно prompt + response) */
  text: string;
  
  /** API ключ для авторизации в vsellm.ru */
  apiKey: string;
  
  /** Модель эмбеддингов (опционально, по умолчанию text-embedding-3-small) */
  model?: string;
}

/**
 * Ответ от /api/embeddings
 */
export interface EmbeddingResponse {
  /** Вектор эмбеддинга */
  embedding: number[];
  
  /** Размерность вектора */
  dimension: number;
  
  /** Использованная модель */
  model: string;
  
  /** Количество токенов в тексте */
  tokenCount: number;
}

/**
 * Ошибка от /api/embeddings
 */
export interface EmbeddingError {
  /** Сообщение об ошибке */
  error: string;
  
  /** Детали ошибки (опционально) */
  details?: string;
}

// =============================================================================
// ТИПЫ ДЛЯ РЕЗУЛЬТАТОВ ПОИСКА
// =============================================================================

/**
 * Результат семантического поиска
 * 
 * Представляет одну карточку, найденную по запросу,
 * с информацией о релевантности.
 */
export interface SearchResult {
  /** ID ноды */
  nodeId: string;
  
  /** ID холста */
  canvasId: string;
  
  /** Промпт карточки */
  prompt: string;
  
  /** Превью ответа */
  responsePreview: string;
  
  /** Косинусное сходство (0-1, где 1 = идеальное совпадение) */
  similarity: number;
  
  /** Процент сходства для отображения (0-100) */
  similarityPercent: number;
}

/**
 * Параметры поиска
 */
export interface SearchParams {
  /** Поисковый запрос */
  query: string;
  
  /** ID холста для ограничения поиска (null = все холсты) */
  canvasId: string | null;
  
  /** Максимальное количество результатов */
  limit: number;
  
  /** Минимальный порог сходства (0-1) */
  minSimilarity?: number;
}

/**
 * Состояние поиска
 */
export interface SearchState {
  /** Поисковый запрос */
  query: string;
  
  /** Результаты поиска */
  results: SearchResult[];
  
  /** Флаг загрузки */
  isSearching: boolean;
  
  /** Ошибка поиска */
  error: string | null;
  
  /** Режим поиска: текущий холст или все */
  searchAllCanvases: boolean;
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Модель эмбеддингов по умолчанию (legacy, для обратной совместимости)
 * Используйте API_PROVIDERS[provider].defaultEmbeddingsModel вместо этого
 * @deprecated Используйте useSettingsStore().embeddingsModel
 */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Размерность вектора (справочное значение)
 * ВАЖНО: Разные модели имеют разную размерность!
 * - text-embedding-3-small: 1536
 * - text-embedding-3-large: 3072
 * - intfloat/multilingual-e5-large: 1024
 * - baai/bge-large-en-v1.5: 1024
 * - baai/bge-base-en-v1.5: 768
 * 
 * Проверка размерности убрана - каждая модель возвращает свою размерность
 * @deprecated Не используйте для валидации - размерность зависит от модели
 */
export const EMBEDDING_DIMENSION = 1536;

/**
 * Минимальный порог сходства для отображения результатов
 * Карточки с similarity ниже этого значения не показываются
 */
export const MIN_SIMILARITY_THRESHOLD = 0.3;

/**
 * Количество результатов поиска по умолчанию
 */
export const DEFAULT_SEARCH_LIMIT = 5;

/**
 * Максимальная длина превью ответа
 */
export const RESPONSE_PREVIEW_LENGTH = 200;

