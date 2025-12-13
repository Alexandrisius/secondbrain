/**
 * @file semantic.ts
 * @description Сервис семантического поиска по карточкам
 * 
 * Реализует поиск похожих карточек на основе косинусного сходства
 * векторных представлений (эмбеддингов).
 * 
 * Алгоритм:
 * 1. Получить эмбеддинг поискового запроса через API
 * 2. Загрузить эмбеддинги из IndexedDB (текущий холст или все)
 * 3. Вычислить косинусное сходство для каждой карточки
 * 4. Отсортировать по релевантности и вернуть топ-N результатов
 */

import {
  type EmbeddingRecord,
  type SearchResult,
  type SearchParams,
  type EmbeddingResponse,
  DEFAULT_SEARCH_LIMIT,
  MIN_SIMILARITY_THRESHOLD,
} from '@/types/embeddings';

import {
  getEmbeddingsByCanvas,
  getAllEmbeddings,
} from '@/lib/db/embeddings';

// =============================================================================
// МАТЕМАТИЧЕСКИЕ ФУНКЦИИ
// =============================================================================

/**
 * Вычислить косинусное сходство между двумя векторами
 * 
 * Косинусное сходство = (A · B) / (||A|| * ||B||)
 * 
 * Результат:
 * - 1.0 = идентичные векторы (одинаковое направление)
 * - 0.0 = ортогональные векторы (перпендикулярны)
 * - -1.0 = противоположные векторы
 * 
 * Для эмбеддингов текста обычно значения от 0.3 до 0.95
 * 
 * @param a - Первый вектор
 * @param b - Второй вектор
 * @returns Косинусное сходство в диапазоне [-1, 1]
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  // Проверка размерности
  if (a.length !== b.length) {
    console.warn(
      `[cosineSimilarity] Разная размерность векторов: ${a.length} vs ${b.length}`
    );
    return 0;
  }
  
  // Пустые векторы
  if (a.length === 0) {
    return 0;
  }
  
  // Вычисляем скалярное произведение и нормы
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  // Проверка на нулевые векторы
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  // Косинусное сходство
  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  
  // Ограничиваем диапазон из-за возможных погрешностей вычислений
  return Math.max(-1, Math.min(1, similarity));
}

/**
 * Нормализовать сходство в процент (0-100)
 * 
 * Преобразует косинусное сходство [-1, 1] в более интуитивный
 * процент релевантности [0, 100].
 * 
 * @param similarity - Косинусное сходство
 * @returns Процент релевантности
 */
export function similarityToPercent(similarity: number): number {
  // Преобразуем [-1, 1] в [0, 100]
  // Для текстовых эмбеддингов редко бывают отрицательные значения,
  // поэтому просто умножаем на 100 и округляем
  return Math.round(Math.max(0, similarity) * 100);
}

// =============================================================================
// ФУНКЦИЯ ПОЛУЧЕНИЯ ЭМБЕДДИНГА ЗАПРОСА
// =============================================================================

/**
 * Получить эмбеддинг для поискового запроса через API
 * 
 * @param query - Текст запроса
 * @param apiKey - API ключ для авторизации
 * @param embeddingsBaseUrl - Базовый URL для API эмбеддингов (опционально)
 * @param corporateMode - Корпоративный режим: отключает проверку SSL (опционально)
 * @param embeddingsModel - Модель эмбеддингов (опционально)
 * @returns Вектор эмбеддинга или null при ошибке
 */
export async function getQueryEmbedding(
  query: string,
  apiKey: string,
  embeddingsBaseUrl?: string,
  corporateMode?: boolean,
  embeddingsModel?: string
): Promise<number[] | null> {
  try {
    const response = await fetch('/api/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: query,
        apiKey: apiKey,
        embeddingsBaseUrl: embeddingsBaseUrl,
        // Модель эмбеддингов из настроек
        model: embeddingsModel,
        // Корпоративный режим для корпоративных сетей с SSL-инспекцией
        corporateMode: corporateMode,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error('[getQueryEmbedding] Ошибка API:', error);
      return null;
    }
    
    const data: EmbeddingResponse = await response.json();
    return data.embedding;
    
  } catch (error) {
    console.error('[getQueryEmbedding] Ошибка запроса:', error);
    return null;
  }
}

// =============================================================================
// ОСНОВНАЯ ФУНКЦИЯ ПОИСКА
// =============================================================================

/**
 * Выполнить семантический поиск по карточкам
 * 
 * Находит карточки, семантически похожие на запрос.
 * Использует косинусное сходство эмбеддингов.
 * 
 * @param params - Параметры поиска
 * @param apiKey - API ключ для получения эмбеддинга запроса
 * @param embeddingsBaseUrl - Базовый URL для API эмбеддингов (опционально)
 * @param corporateMode - Корпоративный режим: отключает проверку SSL (опционально)
 * @returns Массив результатов поиска, отсортированных по релевантности
 */
export async function searchSimilar(
  params: SearchParams,
  apiKey: string,
  embeddingsBaseUrl?: string,
  corporateMode?: boolean,
  embeddingsModel?: string // Добавляем параметр
): Promise<SearchResult[]> {
  const {
    query,
    canvasId,
    limit = DEFAULT_SEARCH_LIMIT,
    minSimilarity = MIN_SIMILARITY_THRESHOLD,
  } = params;
  
  // Пустой запрос - пустой результат
  if (!query.trim()) {
    return [];
  }
  
  console.log('[searchSimilar] Поиск:', query, 'холст:', canvasId || 'все', 'модель:', embeddingsModel);
  
  // =========================================================================
  // ШАГ 1: Получить эмбеддинг запроса
  // =========================================================================
  
  const queryEmbedding = await getQueryEmbedding(query, apiKey, embeddingsBaseUrl, corporateMode, embeddingsModel);
  
  if (!queryEmbedding) {
    console.error('[searchSimilar] Не удалось получить эмбеддинг запроса');
    throw new Error('Не удалось обработать поисковый запрос');
  }
  
  console.log('[searchSimilar] Получен эмбеддинг запроса, размерность:', queryEmbedding.length);
  
  // =========================================================================
  // ШАГ 2: Загрузить эмбеддинги из базы данных
  // =========================================================================
  
  let embeddings: EmbeddingRecord[];
  
  if (canvasId) {
    // Поиск только по текущему холсту
    embeddings = await getEmbeddingsByCanvas(canvasId);
  } else {
    // Поиск по всем холстам
    embeddings = await getAllEmbeddings();
  }
  
  console.log('[searchSimilar] Загружено эмбеддингов:', embeddings.length);
  
  // Если нет эмбеддингов - пустой результат
  if (embeddings.length === 0) {
    return [];
  }
  
  // =========================================================================
  // ШАГ 3: Вычислить сходство для каждой карточки
  // =========================================================================
  
  const results: SearchResult[] = [];
  
  for (const record of embeddings) {
    // Вычисляем косинусное сходство
    const similarity = cosineSimilarity(queryEmbedding, record.embedding);
    
    // Пропускаем карточки ниже порога
    if (similarity < minSimilarity) {
      continue;
    }
    
    results.push({
      nodeId: record.nodeId,
      canvasId: record.canvasId,
      prompt: record.prompt,
      responsePreview: record.responsePreview, // Теперь здесь ПОЛНЫЙ текст
      similarity: similarity,
      similarityPercent: similarityToPercent(similarity),
    });
  }
  
  // =========================================================================
  // ШАГ 4: Сортировка и ограничение результатов
  // =========================================================================
  
  // Сортируем по убыванию сходства
  results.sort((a, b) => b.similarity - a.similarity);
  
  // Берём только топ-N результатов
  const topResults = results.slice(0, limit);
  
  console.log(
    '[searchSimilar] Найдено результатов:',
    results.length,
    'показано:',
    topResults.length
  );
  
  return topResults;
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Проверить, есть ли эмбеддинги для поиска
 * 
 * @param canvasId - ID холста (null для проверки всех)
 * @returns true если есть хотя бы один эмбеддинг
 */
export async function hasEmbeddingsForSearch(canvasId: string | null): Promise<boolean> {
  const embeddings = canvasId
    ? await getEmbeddingsByCanvas(canvasId)
    : await getAllEmbeddings();
  
  return embeddings.length > 0;
}

/**
 * Подсчитать количество проиндексированных карточек
 * 
 * @param canvasId - ID холста (null для всех)
 * @returns Количество проиндексированных карточек
 */
export async function countIndexedCards(canvasId: string | null): Promise<number> {
  const embeddings = canvasId
    ? await getEmbeddingsByCanvas(canvasId)
    : await getAllEmbeddings();
  
  return embeddings.length;
}

/**
 * Быстрый поиск по точному совпадению промпта
 * 
 * Используется для быстрой фильтрации перед семантическим поиском.
 * НЕ использует эмбеддинги - простое текстовое сравнение.
 * 
 * @param query - Поисковый запрос
 * @param canvasId - ID холста (null для всех)
 * @returns Массив записей с совпадением в промпте
 */
export async function quickTextSearch(
  query: string,
  canvasId: string | null
): Promise<EmbeddingRecord[]> {
  const normalizedQuery = query.toLowerCase().trim();
  
  if (!normalizedQuery) {
    return [];
  }
  
  const embeddings = canvasId
    ? await getEmbeddingsByCanvas(canvasId)
    : await getAllEmbeddings();
  
  return embeddings.filter((record) =>
    record.prompt.toLowerCase().includes(normalizedQuery) ||
    record.responsePreview.toLowerCase().includes(normalizedQuery)
  );
}

// =============================================================================
// ФУНКЦИЯ ГЕНЕРАЦИИ ЭМБЕДДИНГА ДЛЯ КАРТОЧКИ
// =============================================================================

/**
 * Сгенерировать и сохранить эмбеддинг для карточки
 * 
 * Объединяет промпт и ответ, получает эмбеддинг через API
 * и сохраняет в IndexedDB.
 * 
 * @param nodeId - ID карточки
 * @param canvasId - ID холста
 * @param prompt - Текст промпта
 * @param response - Текст ответа
 * @param apiKey - API ключ
 * @param embeddingsBaseUrl - Базовый URL для API эмбеддингов (опционально)
 * @param corporateMode - Корпоративный режим: отключает проверку SSL (опционально)
 * @param embeddingsModel - Модель эмбеддингов (опционально)
 * @returns true если успешно сохранено
 */
export async function generateAndSaveEmbedding(
  nodeId: string,
  canvasId: string,
  prompt: string,
  response: string,
  apiKey: string,
  embeddingsBaseUrl?: string,
  corporateMode?: boolean,
  embeddingsModel?: string,
  summary?: string
): Promise<boolean> {
  try {
    // Проверяем что есть данные для индексации
    if (!prompt && !response && !summary) {
      console.log('[generateAndSaveEmbedding] Пропуск: нет данных для индексации');
      return false;
    }
    
    // Используем summary как основной источник для эмбеддинга
    // Если summary нет, используем полный ответ (fallback)
    const contentText = summary || response || 'Без ответа';
    const fullText = `Вопрос: ${prompt || 'Без вопроса'}\n\nТема: ${contentText}`;
    
    console.log(
      '[generateAndSaveEmbedding] Генерация эмбеддинга для ноды',
      nodeId,
      'модель:',
      embeddingsModel,
      'используется summary:',
      !!summary,
      'длина текста:',
      fullText.length
    );
    
    // Получаем эмбеддинг через API
    const embeddingResponse = await fetch('/api/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: fullText,
        apiKey: apiKey,
        embeddingsBaseUrl: embeddingsBaseUrl,
        // Модель эмбеддингов из настроек
        model: embeddingsModel,
        // Корпоративный режим для корпоративных сетей с SSL-инспекцией
        corporateMode: corporateMode,
      }),
    });
    
    if (!embeddingResponse.ok) {
      const error = await embeddingResponse.json();
      console.error('[generateAndSaveEmbedding] Ошибка API:', error);
      return false;
    }
    
    const data: EmbeddingResponse = await embeddingResponse.json();
    
    // Сохраняем в IndexedDB
    const { saveEmbedding } = await import('@/lib/db/embeddings');
    await saveEmbedding(nodeId, canvasId, data.embedding, prompt || '', response || '');
    
    console.log(
      '[generateAndSaveEmbedding] Эмбеддинг сохранён для ноды',
      nodeId,
      'токенов:',
      data.tokenCount
    );
    
    return true;
    
  } catch (error) {
    console.error('[generateAndSaveEmbedding] Ошибка:', error);
    return false;
  }
}

/**
 * Тип для карточки при индексации
 */
interface NodeForIndexing {
  id: string;
  data: {
    prompt: string;
    response: string | null;
  };
}

/**
 * Переиндексировать все карточки холста
 * 
 * Используется для индексации существующих карточек,
 * которые были созданы до внедрения семантического поиска.
 * 
 * @param canvasId - ID холста
 * @param nodes - Массив нод холста
 * @param apiKey - API ключ
 * @param embeddingsBaseUrl - Базовый URL для API эмбеддингов (опционально)
 * @param onProgress - Callback для отслеживания прогресса
 * @param corporateMode - Корпоративный режим: отключает проверку SSL (опционально)
 * @param embeddingsModel - Модель эмбеддингов (опционально)
 * @returns Количество успешно проиндексированных карточек
 */
export async function reindexCanvasCards(
  canvasId: string,
  nodes: NodeForIndexing[],
  apiKey: string,
  embeddingsBaseUrl?: string,
  onProgress?: (current: number, total: number) => void,
  corporateMode?: boolean,
  embeddingsModel?: string
): Promise<number> {
  // Фильтруем карточки с ответами (только их имеет смысл индексировать)
  const cardsToIndex = nodes.filter((node) => node.data.response);
  
  if (cardsToIndex.length === 0) {
    console.log('[reindexCanvasCards] Нет карточек для индексации');
    return 0;
  }
  
  console.log(`[reindexCanvasCards] Начало индексации ${cardsToIndex.length} карточек, модель: ${embeddingsModel}`);
  
  let successCount = 0;
  
  for (let i = 0; i < cardsToIndex.length; i++) {
    const node = cardsToIndex[i];
    
    // Обновляем прогресс
    if (onProgress) {
      onProgress(i + 1, cardsToIndex.length);
    }
    
    // Генерируем и сохраняем эмбеддинг
    const success = await generateAndSaveEmbedding(
      node.id,
      canvasId,
      node.data.prompt,
      node.data.response || '',
      apiKey,
      embeddingsBaseUrl,
      corporateMode,
      embeddingsModel
    );
    
    if (success) {
      successCount++;
    }
    
    // Небольшая пауза чтобы не перегружать API
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  
  console.log(
    `[reindexCanvasCards] Завершено: ${successCount}/${cardsToIndex.length} карточек`
  );
  
  return successCount;
}

