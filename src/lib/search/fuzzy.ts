/**
 * @file fuzzy.ts
 * @description Модуль нечёткого поиска (Fuzzy Search)
 * 
 * Реализует поиск с учётом опечаток и похожих слов:
 * - Расстояние Левенштейна (минимальное количество операций редактирования)
 * - N-грамм сходство (Jaccard similarity)
 * - Комбинированный fuzzy score
 * 
 * Используется как дополнение к BM25 и семантическому поиску
 * для обработки опечаток и вариаций написания.
 */

import {
  tokenize,
  normalizeText,
  generateNgrams,
  jaccardSimilarity,
} from './tokenizer';

// =============================================================================
// ТИПЫ И ИНТЕРФЕЙСЫ
// =============================================================================

/**
 * Документ для нечёткого поиска
 */
export interface FuzzyDocument {
  /** Уникальный идентификатор */
  id: string;
  /** Текст документа */
  text: string;
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/**
 * Результат нечёткого поиска
 */
export interface FuzzySearchResult {
  /** ID документа */
  id: string;
  /** Fuzzy score [0, 1] */
  score: number;
  /** Найденные совпадения */
  matches: FuzzyMatch[];
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/**
 * Информация о совпадении
 */
export interface FuzzyMatch {
  /** Терм из запроса */
  queryTerm: string;
  /** Совпавший терм в документе */
  matchedTerm: string;
  /** Сходство [0, 1] */
  similarity: number;
  /** Тип совпадения */
  matchType: 'exact' | 'fuzzy' | 'ngram';
}

/**
 * Параметры нечёткого поиска
 */
export interface FuzzySearchParams {
  /** Минимальное сходство для включения результата */
  minSimilarity: number;
  /** Максимальное расстояние Левенштейна (в % от длины слова) */
  maxEditDistancePercent: number;
  /** Размер n-грамм */
  ngramSize: number;
  /** Вес расстояния Левенштейна */
  levenshteinWeight: number;
  /** Вес n-грамм сходства */
  ngramWeight: number;
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Параметры по умолчанию для нечёткого поиска
 */
export const DEFAULT_FUZZY_PARAMS: FuzzySearchParams = {
  minSimilarity: 0.4,
  maxEditDistancePercent: 0.4, // 40% от длины слова
  ngramSize: 3,
  levenshteinWeight: 0.6,
  ngramWeight: 0.4,
};

// =============================================================================
// РАССТОЯНИЕ ЛЕВЕНШТЕЙНА
// =============================================================================

/**
 * Вычислить расстояние Левенштейна между двумя строками
 * 
 * Расстояние Левенштейна - минимальное количество операций
 * (вставка, удаление, замена символа) для преобразования
 * одной строки в другую.
 * 
 * Алгоритм: динамическое программирование O(n*m)
 * 
 * @param str1 - Первая строка
 * @param str2 - Вторая строка
 * @returns Расстояние редактирования
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  
  // Граничные случаи
  if (m === 0) return n;
  if (n === 0) return m;
  
  // Создаём матрицу расстояний
  // Оптимизация: используем только две строки вместо полной матрицы
  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);
  
  // Инициализация первой строки
  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }
  
  // Заполняем матрицу
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    
    for (let j = 1; j <= n; j++) {
      // Стоимость замены (0 если символы равны)
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      
      // Минимум из трёх операций:
      // - удаление из str1: prevRow[j] + 1
      // - вставка в str1: currRow[j - 1] + 1
      // - замена: prevRow[j - 1] + cost
      currRow[j] = Math.min(
        prevRow[j] + 1,        // удаление
        currRow[j - 1] + 1,    // вставка
        prevRow[j - 1] + cost  // замена
      );
    }
    
    // Меняем строки местами
    [prevRow, currRow] = [currRow, prevRow];
  }
  
  return prevRow[n];
}

/**
 * Вычислить сходство на основе расстояния Левенштейна
 * 
 * @param str1 - Первая строка
 * @param str2 - Вторая строка
 * @returns Сходство [0, 1], где 1 = идентичные строки
 */
export function levenshteinSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(str1, str2);
  return 1 - distance / maxLen;
}

// =============================================================================
// КОМБИНИРОВАННОЕ FUZZY СХОДСТВО
// =============================================================================

/**
 * Вычислить комбинированное fuzzy сходство между словами
 * 
 * Объединяет расстояние Левенштейна и n-грамм сходство
 * для более робастного результата.
 * 
 * @param word1 - Первое слово
 * @param word2 - Второе слово
 * @param params - Параметры поиска
 * @returns Комбинированное сходство [0, 1]
 */
export function combinedFuzzySimilarity(
  word1: string,
  word2: string,
  params: FuzzySearchParams = DEFAULT_FUZZY_PARAMS
): number {
  // Нормализуем слова
  const norm1 = normalizeText(word1);
  const norm2 = normalizeText(word2);
  
  // Точное совпадение
  if (norm1 === norm2) {
    return 1;
  }
  
  // Расстояние Левенштейна
  const levSimilarity = levenshteinSimilarity(norm1, norm2);
  
  // N-грамм сходство (Jaccard)
  const ngrams1 = generateNgrams(norm1, params.ngramSize);
  const ngrams2 = generateNgrams(norm2, params.ngramSize);
  const ngramSimilarity = jaccardSimilarity(ngrams1, ngrams2);
  
  // Взвешенное среднее
  const combined =
    params.levenshteinWeight * levSimilarity +
    params.ngramWeight * ngramSimilarity;
  
  return combined;
}

// =============================================================================
// КЛАСС FUZZY ИНДЕКСА
// =============================================================================

/**
 * Индекс для нечёткого поиска
 */
export class FuzzyIndex {
  // ---------------------------------------------------------------------------
  // Приватные поля
  // ---------------------------------------------------------------------------
  
  /** Параметры поиска */
  private params: FuzzySearchParams;
  
  /** Документы: id -> { tokens, ngrams, text, metadata } */
  private documents: Map<string, {
    id: string;
    tokens: string[];
    tokenNgrams: Map<string, Set<string>>; // token -> ngrams
    text: string;
    metadata?: Record<string, unknown>;
  }> = new Map();
  
  /** Инвертированный индекс n-грамм: ngram -> Set<{docId, token}> */
  private ngramIndex: Map<string, Set<string>> = new Map(); // ngram -> "docId:token"
  
  // ---------------------------------------------------------------------------
  // Конструктор
  // ---------------------------------------------------------------------------
  
  constructor(params: Partial<FuzzySearchParams> = {}) {
    this.params = { ...DEFAULT_FUZZY_PARAMS, ...params };
  }
  
  // ---------------------------------------------------------------------------
  // Методы индексации
  // ---------------------------------------------------------------------------
  
  /**
   * Добавить документ в индекс
   */
  addDocument(doc: FuzzyDocument): void {
    const tokens = tokenize(doc.text);
    const tokenNgrams = new Map<string, Set<string>>();
    
    // Генерируем n-граммы для каждого токена
    for (const token of tokens) {
      const ngrams = generateNgrams(token, this.params.ngramSize);
      tokenNgrams.set(token, ngrams);
      
      // Добавляем в инвертированный индекс
      for (const ngram of ngrams) {
        if (!this.ngramIndex.has(ngram)) {
          this.ngramIndex.set(ngram, new Set());
        }
        this.ngramIndex.get(ngram)!.add(`${doc.id}:${token}`);
      }
    }
    
    this.documents.set(doc.id, {
      id: doc.id,
      tokens,
      tokenNgrams,
      text: doc.text,
      metadata: doc.metadata,
    });
  }
  
  /**
   * Добавить несколько документов
   */
  addDocuments(docs: FuzzyDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }
  
  /**
   * Удалить документ
   */
  removeDocument(docId: string): boolean {
    const doc = this.documents.get(docId);
    if (!doc) return false;
    
    // Удаляем из n-грамм индекса
    for (const [token, ngrams] of doc.tokenNgrams) {
      for (const ngram of ngrams) {
        const entries = this.ngramIndex.get(ngram);
        if (entries) {
          entries.delete(`${docId}:${token}`);
          if (entries.size === 0) {
            this.ngramIndex.delete(ngram);
          }
        }
      }
    }
    
    this.documents.delete(docId);
    return true;
  }
  
  /**
   * Очистить индекс
   */
  clear(): void {
    this.documents.clear();
    this.ngramIndex.clear();
  }
  
  // ---------------------------------------------------------------------------
  // Методы поиска
  // ---------------------------------------------------------------------------
  
  /**
   * Нечёткий поиск по документам
   * 
   * @param query - Поисковый запрос
   * @param limit - Максимум результатов
   * @returns Отсортированные результаты
   */
  search(query: string, limit: number = 10): FuzzySearchResult[] {
    if (this.documents.size === 0) {
      return [];
    }
    
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }
    
    // Собираем кандидатов через n-грамм индекс
    const candidates = this.findCandidates(queryTokens);
    
    // Вычисляем fuzzy score для каждого кандидата
    const results: FuzzySearchResult[] = [];
    
    for (const docId of candidates) {
      const doc = this.documents.get(docId)!;
      const { score, matches } = this.computeFuzzyScore(queryTokens, doc);
      
      if (score >= this.params.minSimilarity) {
        results.push({
          id: docId,
          score,
          matches,
          metadata: doc.metadata,
        });
      }
    }
    
    // Сортируем по убыванию score
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }
  
  /**
   * Найти документы-кандидаты через n-грамм индекс
   */
  private findCandidates(queryTokens: string[]): Set<string> {
    const candidates = new Set<string>();
    
    for (const token of queryTokens) {
      const ngrams = generateNgrams(token, this.params.ngramSize);
      
      for (const ngram of ngrams) {
        const entries = this.ngramIndex.get(ngram);
        if (entries) {
          for (const entry of entries) {
            const docId = entry.split(':')[0];
            candidates.add(docId);
          }
        }
      }
    }
    
    return candidates;
  }
  
  /**
   * Вычислить fuzzy score для документа
   */
  private computeFuzzyScore(
    queryTokens: string[],
    doc: { tokens: string[]; text: string }
  ): { score: number; matches: FuzzyMatch[] } {
    const matches: FuzzyMatch[] = [];
    let totalSimilarity = 0;
    
    // Для каждого токена запроса ищем лучшее совпадение в документе
    for (const queryToken of queryTokens) {
      let bestMatch: FuzzyMatch | null = null;
      let bestSimilarity = 0;
      
      for (const docToken of doc.tokens) {
        // Точное совпадение
        if (queryToken === docToken) {
          bestMatch = {
            queryTerm: queryToken,
            matchedTerm: docToken,
            similarity: 1,
            matchType: 'exact',
          };
          bestSimilarity = 1;
          break;
        }
        
        // Fuzzy сходство
        const similarity = combinedFuzzySimilarity(queryToken, docToken, this.params);
        
        if (similarity > bestSimilarity && similarity >= this.params.minSimilarity) {
          bestSimilarity = similarity;
          bestMatch = {
            queryTerm: queryToken,
            matchedTerm: docToken,
            similarity,
            matchType: similarity === 1 ? 'exact' : 'fuzzy',
          };
        }
      }
      
      if (bestMatch) {
        matches.push(bestMatch);
        totalSimilarity += bestSimilarity;
      }
    }
    
    // Средний score с учётом покрытия запроса
    const coverage = matches.length / queryTokens.length;
    const avgSimilarity = matches.length > 0 ? totalSimilarity / matches.length : 0;
    const score = avgSimilarity * Math.sqrt(coverage); // Корень для мягкого штрафа
    
    return { score, matches };
  }
  
  // ---------------------------------------------------------------------------
  // Вспомогательные методы
  // ---------------------------------------------------------------------------
  
  /**
   * Получить количество документов
   */
  getDocumentCount(): number {
    return this.documents.size;
  }
  
  /**
   * Проверить наличие документа
   */
  hasDocument(docId: string): boolean {
    return this.documents.has(docId);
  }
}

// =============================================================================
// ФУНКЦИИ ДЛЯ БЫСТРОГО ИСПОЛЬЗОВАНИЯ
// =============================================================================

/**
 * Быстрая проверка: похожи ли две строки?
 * 
 * @param str1 - Первая строка
 * @param str2 - Вторая строка
 * @param threshold - Порог сходства (по умолчанию 0.6)
 * @returns true если строки похожи
 */
export function areSimilar(
  str1: string,
  str2: string,
  threshold: number = 0.6
): boolean {
  return combinedFuzzySimilarity(str1, str2) >= threshold;
}

/**
 * Найти наиболее похожую строку из списка
 * 
 * @param target - Искомая строка
 * @param candidates - Список кандидатов
 * @returns Наиболее похожая строка или null
 */
export function findMostSimilar(
  target: string,
  candidates: string[]
): { match: string; similarity: number } | null {
  let bestMatch: string | null = null;
  let bestSimilarity = 0;
  
  for (const candidate of candidates) {
    const similarity = combinedFuzzySimilarity(target, candidate);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = candidate;
    }
  }
  
  return bestMatch ? { match: bestMatch, similarity: bestSimilarity } : null;
}

// =============================================================================
// ГЛОБАЛЬНЫЙ СИНГЛТОН
// =============================================================================

let globalFuzzyIndex: FuzzyIndex | null = null;

/**
 * Получить глобальный Fuzzy индекс
 */
export function getGlobalFuzzyIndex(): FuzzyIndex {
  if (!globalFuzzyIndex) {
    globalFuzzyIndex = new FuzzyIndex();
  }
  return globalFuzzyIndex;
}

/**
 * Сбросить глобальный Fuzzy индекс
 */
export function resetGlobalFuzzyIndex(): void {
  if (globalFuzzyIndex) {
    globalFuzzyIndex.clear();
  }
  globalFuzzyIndex = null;
}

