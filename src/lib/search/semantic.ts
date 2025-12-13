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
  getAllEmbeddingChunks,
  getEmbeddingChunksByCanvas,
} from '@/lib/db/embeddings';

// =============================================================================
// MARKDOWN CHUNKING (STRUCTURE-AWARE)
// =============================================================================

/**
 * Типы блоков, которые мы умеем выделять из markdown-ответа.
 *
 * Мы намеренно держим “грубый, но предсказуемый” парсинг:
 * - без внешних зависимостей (remark/markdown-it),
 * - без полного AST,
 * - но с критичными гарантиями:
 *   1) fenced code block НИКОГДА не режем “пополам” без восстановления fence,
 *   2) заголовки учитываем как контекст (headingPath),
 *   3) списки/цитаты группируем в цельные блоки.
 */
type MarkdownBlockType = 'heading' | 'paragraph' | 'list' | 'blockquote' | 'fenced_code';

interface MarkdownBlock {
  type: MarkdownBlockType;
  /**
   * Текст блока (как есть, с переводами строк).
   * Для fenced_code включаем и открывающую, и закрывающую fence-строку.
   */
  text: string;
  /**
   * “Путь заголовков” (контекст раздела) на момент этого блока.
   * Пример: "# API\n## Auth\n### Refresh token"
   */
  headingPath: string;
  /**
   * Для fenced_code полезно сохранять fence строку (``` или ~~~) + language.
   * Мы заполняем это только если type === 'fenced_code'.
   */
  fenceLine?: string;
}

/**
 * Нормализуем переносы строк (Windows → Unix), чтобы парсер работал стабильно.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Возвращает headingPath строкой из текущего стека заголовков.
 */
function buildHeadingPath(stack: Array<{ level: number; title: string }>): string {
  if (stack.length === 0) return '';
  return stack.map((h) => `${'#'.repeat(h.level)} ${h.title}`).join('\n');
}

/**
 * Грубый парсер markdown в последовательность структурных блоков.
 *
 * Поддерживаем:
 * - headings (#..######)
 * - fenced code blocks (``` or ~~~) — критично для корректного чанкинга
 * - lists (dash/asterisk/plus or numbered like 1. / 1))
 * - blockquotes (>)
 * - paragraphs (всё остальное между пустыми строками)
 */
function parseMarkdownToBlocks(markdown: string): MarkdownBlock[] {
  const text = normalizeNewlines(markdown);
  const lines = text.split('\n');

  const blocks: MarkdownBlock[] = [];
  const headingStack: Array<{ level: number; title: string }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Пропускаем пустые строки как разделители
    if (!line.trim()) {
      i++;
      continue;
    }

    // -----------------------------------------------------------------------
    // 1) Heading
    // -----------------------------------------------------------------------
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      // Обновляем стек: удаляем заголовки того же или более глубокого уровня
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });

      blocks.push({
        type: 'heading',
        text: line.trim(),
        headingPath: buildHeadingPath(headingStack),
      });

      i++;
      continue;
    }

    // -----------------------------------------------------------------------
    // 2) Fenced code block (``` or ~~~)
    // -----------------------------------------------------------------------
    const fenceStartMatch = /^(```+|~~~+)\s*.*$/.exec(line);
    if (fenceStartMatch) {
      const fenceLine = line;
      const fenceToken = fenceStartMatch[1]; // ``` or ~~~ (или больше)
      const blockLines: string[] = [line];
      i++;

      // Собираем до закрывающей fence
      while (i < lines.length) {
        const l = lines[i];
        blockLines.push(l);
        // Закрывающая fence: начинается с того же токена (или длиннее)
        if (l.startsWith(fenceToken)) {
          i++;
          break;
        }
        i++;
      }

      blocks.push({
        type: 'fenced_code',
        text: blockLines.join('\n'),
        headingPath: buildHeadingPath(headingStack),
        fenceLine,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // 3) Blockquote (>)
    // -----------------------------------------------------------------------
    if (/^\s*>\s?/.test(line)) {
      const blockLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        blockLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'blockquote',
        text: blockLines.join('\n').trimEnd(),
        headingPath: buildHeadingPath(headingStack),
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // 4) List (-/*/+ or 1./1))
    // -----------------------------------------------------------------------
    const isListItem = (l: string) =>
      /^(\s*)([-*+]\s+|\d+[.)]\s+)/.test(l);

    if (isListItem(line)) {
      const blockLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) break; // пустая строка завершает список
        // Список продолжается, если:
        // - новая строка — list item
        // - или это “continuation line” с отступом (подпункт/перенос)
        if (isListItem(l) || /^\s{2,}\S/.test(l)) {
          blockLines.push(l);
          i++;
          continue;
        }
        break;
      }
      blocks.push({
        type: 'list',
        text: blockLines.join('\n').trimEnd(),
        headingPath: buildHeadingPath(headingStack),
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // 5) Paragraph (до пустой строки или до следующего спец-блока)
    // -----------------------------------------------------------------------
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      // не захватываем старт следующего блока
      if (/^(#{1,6})\s+/.test(l)) break;
      if (/^(```+|~~~+)\s*.*$/.test(l)) break;
      if (/^\s*>\s?/.test(l)) break;
      if (isListItem(l)) break;
      paraLines.push(l);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      text: paraLines.join('\n').trimEnd(),
      headingPath: buildHeadingPath(headingStack),
    });
  }

  return blocks;
}

/**
 * Разделяет слишком большой блок на несколько частей, не ломая смысл.
 *
 * - Для обычных блоков режем по строкам.
 * - Для fenced_code режем по строкам кода, но всегда восстанавливаем fence.
 */
function splitOversizedBlock(
  block: MarkdownBlock,
  maxChunkChars: number
): MarkdownBlock[] {
  if (block.text.length <= maxChunkChars) return [block];

  // -------------------------------------------------------------------------
  // fenced_code: режем “тело”, но каждый кусок остаётся валидным fenced block
  // -------------------------------------------------------------------------
  if (block.type === 'fenced_code') {
    const lines = normalizeNewlines(block.text).split('\n');
    const first = lines[0] || '```';
    const last = lines[lines.length - 1] || '```';
    const body = lines.slice(1, -1); // без fence строк

    const parts: MarkdownBlock[] = [];
    let buf: string[] = [];
    let bufLen = first.length + last.length + 2; // грубая оценка

    const flush = () => {
      if (buf.length === 0) return;
      parts.push({
        type: 'fenced_code',
        text: [first, ...buf, last].join('\n'),
        headingPath: block.headingPath,
        fenceLine: block.fenceLine,
      });
      buf = [];
      bufLen = first.length + last.length + 2;
    };

    for (const l of body) {
      const nextLen = bufLen + l.length + 1;
      if (buf.length > 0 && nextLen > maxChunkChars) {
        flush();
      }
      buf.push(l);
      bufLen += l.length + 1;
    }
    flush();

    // Если даже один “кусок” всё равно превышает лимит (очень длинные строки),
    // то мы всё равно возвращаем как есть — это редкость, но важнее валидность fence.
    return parts.length > 0 ? parts : [block];
  }

  // -------------------------------------------------------------------------
  // Остальные типы: режем по строкам (простая, но предсказуемая эвристика)
  // -------------------------------------------------------------------------
  const lines = normalizeNewlines(block.text).split('\n');
  const parts: MarkdownBlock[] = [];
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    parts.push({
      ...block,
      text: buf.join('\n').trimEnd(),
    });
    buf = [];
    bufLen = 0;
  };

  for (const l of lines) {
    const nextLen = bufLen + l.length + 1;
    if (buf.length > 0 && nextLen > maxChunkChars) {
      flush();
    }
    buf.push(l);
    bufLen += l.length + 1;
  }
  flush();

  return parts.length > 0 ? parts : [block];
}

/**
 * Собирает итоговые чанки для эмбеддингов из markdown-блоков.
 *
 * Ключевые принципы:
 * - чанки структурные (block-based)
 * - каждый чанк получает “контекст раздела” (headingPath) в начале
 * - обеспечиваем лимит длины
 * - если чанков слишком много — берём “первые N/2 + последние N/2” (улучшает recall)
 */
function buildMarkdownChunks(
  markdown: string,
  maxChunkChars: number,
  maxChunksPerNode: number
): Array<{ chunkText: string; headingPath: string }> {
  const blocks = parseMarkdownToBlocks(markdown);

  const chunks: Array<{ chunkText: string; headingPath: string }> = [];
  let current = '';
  let currentHeadingPath = '';

  const flush = () => {
    const text = current.trim();
    if (!text) return;
    chunks.push({
      chunkText: text,
      headingPath: currentHeadingPath,
    });
    current = '';
    currentHeadingPath = '';
  };

  for (const rawBlock of blocks) {
    // 1) Режем oversized блоки заранее, чтобы дальше было проще соблюдать лимиты
    const parts = splitOversizedBlock(rawBlock, maxChunkChars);

    for (const block of parts) {
      const headingPath = block.headingPath;
      const prefix = headingPath
        ? `Контекст раздела:\n${headingPath}\n\n`
        : '';

      // Вставляем разделитель, чтобы блоки не “сливались” смыслом
      const blockText = block.text.trim();
      if (!blockText) continue;
      const piece = `${prefix}${blockText}`;

      // Если текущий чанк пуст — фиксируем его headingPath как “основной”
      if (!current) {
        currentHeadingPath = headingPath;
      }

      // Если не влезает — флешим и начинаем новый
      if (current && current.length + 2 + piece.length > maxChunkChars) {
        flush();
        currentHeadingPath = headingPath;
      }

      // Добавляем с “двойным переносом” (чтобы сохранять структуру)
      current = current ? `${current}\n\n${piece}` : piece;

      // Если внезапно превысили лимит (например из-за prefix) — флешим сразу
      if (current.length > maxChunkChars) {
        flush();
      }
    }
  }
  flush();

  if (chunks.length <= maxChunksPerNode) {
    return chunks;
  }

  // “Первые + последние” — покрывает и вводную часть, и выводы/сноски.
  const half = Math.floor(maxChunksPerNode / 2);
  const head = chunks.slice(0, half);
  const tail = chunks.slice(Math.max(0, chunks.length - (maxChunksPerNode - half)));
  return [...head, ...tail];
}

/**
 * Дефолты для multi-vector индексации.
 *
 * Эти значения — компромисс “качество ↔ стоимость ↔ размер IndexedDB”.
 * Их можно вынести в настройки позже, но для старта держим константами.
 */
const MIN_RESPONSE_CHARS_FOR_CHUNKS = 800;
const MAX_CHUNK_CHARS = 2800;
const MAX_CHUNKS_PER_NODE = 8;

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
  
  // Загружаем multi-vector чанки (если они есть)
  const chunkEmbeddings = canvasId
    ? await getEmbeddingChunksByCanvas(canvasId)
    : await getAllEmbeddingChunks();
  
  console.log('[searchSimilar] Загружено chunk-эмбеддингов:', chunkEmbeddings.length);
  
  // Если нет эмбеддингов - пустой результат
  // ВАЖНО:
  // - По требованиям проекта, при совпадении чанка мы подключаем ВСЮ карточку.
  // - А значит нам нужен полный response карточки, который хранится в канонической записи `embeddings`.
  // - Поэтому “только чанки без канонических эмбеддингов” мы не можем корректно использовать.
  // - В практике это ок, потому что чанки генерируются вместе с канонической записью.
  if (embeddings.length === 0) {
    return [];
  }
  
  // =========================================================================
  // ШАГ 3: Вычислить сходство для каждой карточки
  // =========================================================================
  
  /**
   * Multi-vector scoring:
   * - У одной карточки может быть:
   *   1) канонический эмбеддинг (обычно summary-based),
   *   2) несколько chunk-эмбеддингов (по markdown-структуре ответа).
   *
   * Мы считаем сходство по всем векторам и берём bestSimilarity = max(...).
   *
   * ВАЖНОЕ ТРЕБОВАНИЕ:
   * - Если совпал хотя бы один чанк, мы подключаем ВСЮ карточку,
   *   т.е. в результатах возвращаем `responsePreview` = полный ответ карточки,
   *   а не текст чанка.
   */
  const canonicalByNodeId = new Map<string, EmbeddingRecord>();
  for (const record of embeddings) {
    canonicalByNodeId.set(record.nodeId, record);
  }

  const bestByNodeId = new Map<
    string,
    {
      similarity: number;
      matchType: 'canonical' | 'chunk';
      matchChunkIndex?: number;
      matchChunkTotal?: number;
      matchHeadingPath?: string;
    }
  >();

  // 3.1. Канонические эмбеддинги
  for (const record of embeddings) {
    const similarity = cosineSimilarity(queryEmbedding, record.embedding);
    if (similarity < minSimilarity) continue;

    const prev = bestByNodeId.get(record.nodeId);
    if (!prev || similarity > prev.similarity) {
      bestByNodeId.set(record.nodeId, { similarity, matchType: 'canonical' });
    }
  }

  // 3.2. Чанк-эмбеддинги (multi-vector)
  for (const chunk of chunkEmbeddings) {
    const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (similarity < minSimilarity) continue;

    const prev = bestByNodeId.get(chunk.nodeId);
    if (!prev || similarity > prev.similarity) {
      bestByNodeId.set(chunk.nodeId, {
        similarity,
        matchType: 'chunk',
        matchChunkIndex: chunk.chunkIndex,
        matchChunkTotal: chunk.chunkTotal,
        matchHeadingPath: chunk.headingPath,
      });
    }
  }

  // 3.3. Формируем результаты: 1 карточка = 1 результат
  const results: SearchResult[] = [];
  for (const [nodeId, best] of bestByNodeId.entries()) {
    const canonical = canonicalByNodeId.get(nodeId);

    // Требование “подмешиваем full response” → нужен canonical record
    if (!canonical) {
      console.warn('[searchSimilar] Найден match по чанкам, но нет канонической записи embeddings:', {
        nodeId,
        matchType: best.matchType,
      });
      continue;
    }

    results.push({
      nodeId: canonical.nodeId,
      canvasId: canonical.canvasId,
      prompt: canonical.prompt,
      responsePreview: canonical.responsePreview, // ПОЛНЫЙ текст карточки для виртуального родителя
      similarity: best.similarity,
      similarityPercent: similarityToPercent(best.similarity),
      // Типы SearchResult сейчас не содержат метаданных матчей.
      // Мы не добавляем их сюда, чтобы не ломать типизацию/вызовы.
      // При необходимости можно расширить SearchResult и пробросить matchType/matchHeadingPath.
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

    // =========================================================================
    // MULTI-VECTOR (CHUNK) ЭМБЕДДИНГИ ДЛЯ ДЛИННЫХ ОТВЕТОВ
    //
    // ВАЖНОЕ ТРЕБОВАНИЕ:
    // - чанки используются только для scoring (поиск “деталей”)
    // - но при совпадении чанка мы подключаем всю карточку,
    //   то есть LLM получает полный response из канонической записи embeddings.
    // =========================================================================
    try {
      const { saveEmbeddingChunksForNode } = await import('@/lib/db/embeddings');

      // Если ответ короткий — чанки не нужны; но мы всё равно очищаем старые чанки,
      // чтобы при изменении ответа с “длинного” на “короткий” не остался мусор.
      if (!response || response.length < MIN_RESPONSE_CHARS_FOR_CHUNKS) {
        await saveEmbeddingChunksForNode(nodeId, canvasId, []);
        return true;
      }

      // 1) Структурный markdown-чанкинг
      const rawChunks = buildMarkdownChunks(response, MAX_CHUNK_CHARS, MAX_CHUNKS_PER_NODE);

      if (rawChunks.length === 0) {
        await saveEmbeddingChunksForNode(nodeId, canvasId, []);
        return true;
      }

      // 2) Для каждого чанка получаем эмбеддинг и сохраняем
      const chunkPayloads: Array<{
        chunkIndex: number;
        chunkTotal: number;
        headingPath: string;
        chunkText: string;
        prompt: string;
        embedding: number[];
      }> = [];

      for (let chunkIndex = 0; chunkIndex < rawChunks.length; chunkIndex++) {
        const ch = rawChunks[chunkIndex];

        // Текст, который отдаём в эмбеддинги:
        // - включаем prompt (вопрос карточки), чтобы чанки “привязались” к теме
        // - включаем сам фрагмент (в нём уже есть headingPath/структура)
        const chunkEmbeddingText =
          `Вопрос: ${prompt || 'Без вопроса'}\n\n` +
          `Фрагмент ответа (markdown):\n${ch.chunkText}`;

        const chunkEmbeddingResponse = await fetch('/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: chunkEmbeddingText,
            apiKey: apiKey,
            embeddingsBaseUrl: embeddingsBaseUrl,
            model: embeddingsModel,
            corporateMode: corporateMode,
          }),
        });

        if (!chunkEmbeddingResponse.ok) {
          const error = await chunkEmbeddingResponse.json().catch(() => ({}));
          console.error('[generateAndSaveEmbedding] Ошибка chunk-эмбеддинга:', {
            nodeId,
            chunkIndex,
            error,
          });
          // Не прерываем всю индексацию: просто пропускаем этот чанк
          continue;
        }

        const chunkData: EmbeddingResponse = await chunkEmbeddingResponse.json();

        chunkPayloads.push({
          chunkIndex,
          chunkTotal: rawChunks.length,
          headingPath: ch.headingPath,
          chunkText: ch.chunkText,
          prompt: prompt || '',
          embedding: chunkData.embedding,
        });

        // Небольшая пауза, чтобы не “прострелить” API при переиндексации
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await saveEmbeddingChunksForNode(nodeId, canvasId, chunkPayloads);
    } catch (chunkError) {
      // Ошибка чанков НЕ должна ломать базовую индексацию (канонический эмбеддинг уже сохранён).
      console.error('[generateAndSaveEmbedding] Ошибка multi-vector чанков:', chunkError);
    }

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

