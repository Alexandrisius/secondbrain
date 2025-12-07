/**
 * @file hybrid.ts
 * @description Гибридный поисковый движок "Мини-Google"
 * 
 * Объединяет несколько методов поиска для максимальной релевантности:
 * 1. BM25 - классический алгоритм ранжирования (keyword matching)
 * 2. Semantic Search - семантический поиск на эмбеддингах
 * 3. Fuzzy Search - нечёткий поиск (опечатки, вариации)
 * 4. Exact Match - точное совпадение фраз
 * 
 * Результаты объединяются с помощью Reciprocal Rank Fusion (RRF):
 * RRF(d) = Σ 1/(k + rank_i(d))
 * 
 * Это даёт комбинированный скор, учитывающий позиции документа
 * в каждом из методов поиска.
 */

import { BM25Index } from './bm25';
import { FuzzyIndex } from './fuzzy';
import { normalizeText, tokenize } from './tokenizer';

// =============================================================================
// ТИПЫ И ИНТЕРФЕЙСЫ
// =============================================================================

/**
 * Документ для гибридного поиска
 */
export interface HybridDocument {
  /** Уникальный ID документа */
  id: string;
  /** Основной текст для поиска */
  text: string;
  /** ID холста (для группировки) */
  canvasId?: string;
  /** Заголовок/промпт */
  title?: string;
  /** Превью контента */
  preview?: string;
  /** Вектор эмбеддинга (если есть) */
  embedding?: number[];
  /** Дополнительные метаданные */
  metadata?: Record<string, unknown>;
}

/**
 * Результат гибридного поиска
 */
export interface HybridSearchResult {
  /** ID документа */
  id: string;
  /** Финальный RRF score */
  score: number;
  /** Нормализованный score [0, 1] */
  normalizedScore: number;
  /** ID холста */
  canvasId?: string;
  /** Заголовок/промпт */
  title?: string;
  /** Превью контента */
  preview?: string;
  /** Детали по каждому методу поиска */
  breakdown: {
    bm25?: { score: number; rank: number };
    semantic?: { score: number; rank: number };
    fuzzy?: { score: number; rank: number };
    exact?: { score: number; rank: number };
  };
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/**
 * Веса для разных методов поиска в RRF
 */
export interface HybridWeights {
  /** Вес BM25 */
  bm25: number;
  /** Вес семантического поиска */
  semantic: number;
  /** Вес fuzzy поиска */
  fuzzy: number;
  /** Вес точного совпадения */
  exact: number;
}

/**
 * Параметры гибридного поиска
 */
export interface HybridSearchParams {
  /** Веса методов поиска */
  weights: HybridWeights;
  /** Параметр k для RRF (обычно 60) */
  rrfK: number;
  /** Минимальный порог для семантического поиска */
  semanticMinSimilarity: number;
  /** Минимальный порог для fuzzy поиска */
  fuzzyMinSimilarity: number;
  /** Буст для точного совпадения в заголовке */
  titleExactMatchBoost: number;
}

/**
 * Тип функции для получения эмбеддинга запроса
 */
export type GetQueryEmbeddingFn = (query: string) => Promise<number[] | null>;

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Параметры по умолчанию для гибридного поиска
 */
export const DEFAULT_HYBRID_PARAMS: HybridSearchParams = {
  weights: {
    bm25: 1.0,      // Стандартный вес для BM25
    semantic: 1.2,  // Немного выше для семантики
    fuzzy: 0.5,     // Меньший вес для fuzzy (вспомогательный)
    exact: 1.5,     // Высокий вес для точных совпадений
  },
  rrfK: 60,                    // Стандартное значение для RRF
  semanticMinSimilarity: 0.3,  // Минимум для семантического поиска
  fuzzyMinSimilarity: 0.4,     // Минимум для fuzzy
  titleExactMatchBoost: 2.0,   // Буст если запрос в заголовке
};

// =============================================================================
// КЛАСС ГИБРИДНОГО ПОИСКОВОГО ИНДЕКСА
// =============================================================================

/**
 * HybridSearchEngine - гибридный поисковый движок
 * 
 * Объединяет BM25, семантический и fuzzy поиск
 * с помощью Reciprocal Rank Fusion.
 */
export class HybridSearchEngine {
  // ---------------------------------------------------------------------------
  // Приватные поля
  // ---------------------------------------------------------------------------
  
  /** Параметры поиска */
  private params: HybridSearchParams;
  
  /** BM25 индекс */
  private bm25Index: BM25Index;
  
  /** Fuzzy индекс */
  private fuzzyIndex: FuzzyIndex;
  
  /** Хранилище документов */
  private documents: Map<string, HybridDocument> = new Map();
  
  /** Функция получения эмбеддинга запроса */
  private getQueryEmbedding: GetQueryEmbeddingFn | null = null;
  
  // ---------------------------------------------------------------------------
  // Конструктор
  // ---------------------------------------------------------------------------
  
  /**
   * Создать гибридный поисковый движок
   * 
   * @param params - Параметры поиска
   * @param getQueryEmbeddingFn - Функция для получения эмбеддинга запроса
   */
  constructor(
    params: Partial<HybridSearchParams> = {},
    getQueryEmbeddingFn?: GetQueryEmbeddingFn
  ) {
    this.params = { ...DEFAULT_HYBRID_PARAMS, ...params };
    this.bm25Index = new BM25Index();
    this.fuzzyIndex = new FuzzyIndex();
    this.getQueryEmbedding = getQueryEmbeddingFn || null;
  }
  
  // ---------------------------------------------------------------------------
  // Методы индексации
  // ---------------------------------------------------------------------------
  
  /**
   * Добавить документ в индекс
   * 
   * @param doc - Документ для индексации
   */
  addDocument(doc: HybridDocument): void {
    // Сохраняем документ
    this.documents.set(doc.id, doc);
    
    // Комбинируем заголовок и текст для индексации
    // Заголовок дублируем для повышения его веса
    const fullText = [
      doc.title || '',
      doc.title || '', // Дублируем заголовок
      doc.text,
    ].filter(Boolean).join(' ');
    
    // Добавляем в BM25 индекс
    this.bm25Index.addDocument({
      id: doc.id,
      text: fullText,
      metadata: { canvasId: doc.canvasId, ...doc.metadata },
    });
    
    // Добавляем в Fuzzy индекс
    this.fuzzyIndex.addDocument({
      id: doc.id,
      text: fullText,
      metadata: { canvasId: doc.canvasId, ...doc.metadata },
    });
  }
  
  /**
   * Добавить несколько документов
   */
  addDocuments(docs: HybridDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }
  
  /**
   * Удалить документ из индекса
   */
  removeDocument(docId: string): boolean {
    if (!this.documents.has(docId)) {
      return false;
    }
    
    this.documents.delete(docId);
    this.bm25Index.removeDocument(docId);
    this.fuzzyIndex.removeDocument(docId);
    
    return true;
  }
  
  /**
   * Очистить все индексы
   */
  clear(): void {
    this.documents.clear();
    this.bm25Index.clear();
    this.fuzzyIndex.clear();
  }
  
  /**
   * Обновить документ (удалить и добавить заново)
   */
  updateDocument(doc: HybridDocument): void {
    this.removeDocument(doc.id);
    this.addDocument(doc);
  }
  
  /**
   * Установить функцию получения эмбеддинга
   */
  setEmbeddingFunction(fn: GetQueryEmbeddingFn): void {
    this.getQueryEmbedding = fn;
  }
  
  // ---------------------------------------------------------------------------
  // Методы поиска
  // ---------------------------------------------------------------------------
  
  /**
   * Выполнить гибридный поиск
   * 
   * @param query - Поисковый запрос
   * @param limit - Максимум результатов
   * @param canvasId - Ограничить поиск холстом (опционально)
   * @returns Массив результатов, отсортированных по релевантности
   */
  async search(
    query: string,
    limit: number = 10,
    canvasId?: string
  ): Promise<HybridSearchResult[]> {
    if (this.documents.size === 0 || !query.trim()) {
      return [];
    }
    
    const normalizedQuery = normalizeText(query);
    
    // =======================================================================
    // ШАГ 1: Выполняем поиск каждым методом
    // =======================================================================
    
    // BM25 поиск
    const bm25Results = this.bm25Index.search(query, limit * 3);
    
    // Fuzzy поиск
    const fuzzyResults = this.fuzzyIndex.search(query, limit * 3);
    
    // Семантический поиск (если есть функция и эмбеддинги)
    const semanticResults = await this.semanticSearch(query, limit * 3);
    
    // Точное совпадение
    const exactResults = this.exactMatchSearch(normalizedQuery, limit * 3);
    
    // =======================================================================
    // ШАГ 2: Создаём ранги для каждого метода
    // =======================================================================
    
    // Map: docId -> { bm25Rank, semanticRank, fuzzyRank, exactRank }
    const ranks = new Map<string, {
      bm25?: number;
      semantic?: number;
      fuzzy?: number;
      exact?: number;
      bm25Score?: number;
      semanticScore?: number;
      fuzzyScore?: number;
      exactScore?: number;
    }>();
    
    // BM25 ранги
    bm25Results.forEach((result, index) => {
      const existing = ranks.get(result.id) || {};
      ranks.set(result.id, {
        ...existing,
        bm25: index + 1,
        bm25Score: result.normalizedScore,
      });
    });
    
    // Semantic ранги
    semanticResults.forEach((result, index) => {
      const existing = ranks.get(result.id) || {};
      ranks.set(result.id, {
        ...existing,
        semantic: index + 1,
        semanticScore: result.score,
      });
    });
    
    // Fuzzy ранги
    fuzzyResults.forEach((result, index) => {
      const existing = ranks.get(result.id) || {};
      ranks.set(result.id, {
        ...existing,
        fuzzy: index + 1,
        fuzzyScore: result.score,
      });
    });
    
    // Exact ранги
    exactResults.forEach((result, index) => {
      const existing = ranks.get(result.id) || {};
      ranks.set(result.id, {
        ...existing,
        exact: index + 1,
        exactScore: result.score,
      });
    });
    
    // =======================================================================
    // ШАГ 3: Вычисляем RRF score для каждого документа
    // =======================================================================
    
    const { weights, rrfK } = this.params;
    const results: HybridSearchResult[] = [];
    
    for (const [docId, docRanks] of ranks) {
      const doc = this.documents.get(docId);
      if (!doc) continue;
      
      // Фильтрация по canvasId если указан
      if (canvasId && doc.canvasId !== canvasId) continue;
      
      // Вычисляем RRF score
      let rrfScore = 0;
      
      if (docRanks.bm25) {
        rrfScore += weights.bm25 * (1 / (rrfK + docRanks.bm25));
      }
      if (docRanks.semantic) {
        rrfScore += weights.semantic * (1 / (rrfK + docRanks.semantic));
      }
      if (docRanks.fuzzy) {
        rrfScore += weights.fuzzy * (1 / (rrfK + docRanks.fuzzy));
      }
      if (docRanks.exact) {
        rrfScore += weights.exact * (1 / (rrfK + docRanks.exact));
      }
      
      // Буст если точное совпадение в заголовке
      if (doc.title && normalizeText(doc.title).includes(normalizedQuery)) {
        rrfScore *= this.params.titleExactMatchBoost;
      }
      
      results.push({
        id: docId,
        score: rrfScore,
        normalizedScore: 0, // Вычислим после
        canvasId: doc.canvasId,
        title: doc.title,
        preview: doc.preview,
        breakdown: {
          bm25: docRanks.bm25 ? { score: docRanks.bm25Score || 0, rank: docRanks.bm25 } : undefined,
          semantic: docRanks.semantic ? { score: docRanks.semanticScore || 0, rank: docRanks.semantic } : undefined,
          fuzzy: docRanks.fuzzy ? { score: docRanks.fuzzyScore || 0, rank: docRanks.fuzzy } : undefined,
          exact: docRanks.exact ? { score: docRanks.exactScore || 0, rank: docRanks.exact } : undefined,
        },
        metadata: doc.metadata,
      });
    }
    
    // =======================================================================
    // ШАГ 4: Сортировка и нормализация
    // =======================================================================
    
    // Сортируем по убыванию RRF score
    results.sort((a, b) => b.score - a.score);
    
    // Нормализуем scores
    const maxScore = results.length > 0 ? results[0].score : 1;
    for (const result of results) {
      result.normalizedScore = maxScore > 0 ? result.score / maxScore : 0;
    }
    
    return results.slice(0, limit);
  }
  
  /**
   * Быстрый поиск (только BM25 + Exact, без семантики)
   * Используется для мгновенных результатов при вводе
   */
  quickSearch(query: string, limit: number = 5): HybridSearchResult[] {
    if (this.documents.size === 0 || !query.trim()) {
      return [];
    }
    
    const normalizedQuery = normalizeText(query);
    
    // Только BM25 и exact match (быстрые методы)
    const bm25Results = this.bm25Index.search(query, limit * 2);
    const exactResults = this.exactMatchSearch(normalizedQuery, limit * 2);
    
    // Простое объединение
    const scores = new Map<string, number>();
    
    bm25Results.forEach((r, i) => {
      const existing = scores.get(r.id) || 0;
      scores.set(r.id, existing + (1 / (60 + i + 1)));
    });
    
    exactResults.forEach((r, i) => {
      const existing = scores.get(r.id) || 0;
      scores.set(r.id, existing + 1.5 * (1 / (60 + i + 1)));
    });
    
    const results: HybridSearchResult[] = [];
    for (const [docId, score] of scores) {
      const doc = this.documents.get(docId);
      if (!doc) continue;
      
      results.push({
        id: docId,
        score,
        normalizedScore: 0,
        canvasId: doc.canvasId,
        title: doc.title,
        preview: doc.preview,
        breakdown: {},
        metadata: doc.metadata,
      });
    }
    
    results.sort((a, b) => b.score - a.score);
    
    const maxScore = results.length > 0 ? results[0].score : 1;
    for (const result of results) {
      result.normalizedScore = maxScore > 0 ? result.score / maxScore : 0;
    }
    
    return results.slice(0, limit);
  }
  
  // ---------------------------------------------------------------------------
  // Приватные методы поиска
  // ---------------------------------------------------------------------------
  
  /**
   * Семантический поиск по эмбеддингам
   */
  private async semanticSearch(
    query: string,
    limit: number
  ): Promise<{ id: string; score: number }[]> {
    // Если нет функции получения эмбеддинга - пропускаем
    if (!this.getQueryEmbedding) {
      return [];
    }
    
    // Получаем эмбеддинг запроса
    const queryEmbedding = await this.getQueryEmbedding(query);
    if (!queryEmbedding) {
      return [];
    }
    
    const results: { id: string; score: number }[] = [];
    
    // Вычисляем косинусное сходство с каждым документом, у которого есть эмбеддинг
    for (const [docId, doc] of this.documents) {
      if (!doc.embedding) continue;
      
      const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
      
      if (similarity >= this.params.semanticMinSimilarity) {
        results.push({ id: docId, score: similarity });
      }
    }
    
    // Сортируем по убыванию сходства
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }
  
  /**
   * Поиск точного совпадения
   */
  private exactMatchSearch(
    normalizedQuery: string,
    limit: number
  ): { id: string; score: number }[] {
    const results: { id: string; score: number }[] = [];
    const queryTokens = tokenize(normalizedQuery);
    
    for (const [docId, doc] of this.documents) {
      const normalizedText = normalizeText(doc.text);
      const normalizedTitle = doc.title ? normalizeText(doc.title) : '';
      
      let score = 0;
      
      // Полное совпадение фразы в тексте
      if (normalizedText.includes(normalizedQuery)) {
        score += 1.0;
      }
      
      // Полное совпадение фразы в заголовке (высокий буст)
      if (normalizedTitle.includes(normalizedQuery)) {
        score += 2.0;
      }
      
      // Совпадение отдельных слов запроса
      let wordMatches = 0;
      for (const token of queryTokens) {
        if (normalizedText.includes(token) || normalizedTitle.includes(token)) {
          wordMatches++;
        }
      }
      
      // Добавляем score за совпадение слов
      if (queryTokens.length > 0) {
        score += 0.3 * (wordMatches / queryTokens.length);
      }
      
      if (score > 0) {
        results.push({ id: docId, score });
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
  
  /**
   * Вычислить косинусное сходство между векторами
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  // ---------------------------------------------------------------------------
  // Вспомогательные методы
  // ---------------------------------------------------------------------------
  
  /**
   * Получить статистику индекса
   */
  getStats(): {
    documentCount: number;
    bm25Stats: ReturnType<BM25Index['getStats']>;
    hasSemanticSearch: boolean;
  } {
    return {
      documentCount: this.documents.size,
      bm25Stats: this.bm25Index.getStats(),
      hasSemanticSearch: this.getQueryEmbedding !== null,
    };
  }
  
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
  
  /**
   * Получить документ по ID
   */
  getDocument(docId: string): HybridDocument | undefined {
    return this.documents.get(docId);
  }
  
  /**
   * Обновить веса поиска
   */
  setWeights(weights: Partial<HybridWeights>): void {
    this.params.weights = { ...this.params.weights, ...weights };
  }
  
  /**
   * Получить текущие параметры
   */
  getParams(): HybridSearchParams {
    return { ...this.params };
  }
}

// =============================================================================
// ГЛОБАЛЬНЫЙ СИНГЛТОН
// =============================================================================

let globalHybridEngine: HybridSearchEngine | null = null;

/**
 * Получить глобальный гибридный поисковый движок
 */
export function getGlobalHybridEngine(): HybridSearchEngine {
  if (!globalHybridEngine) {
    globalHybridEngine = new HybridSearchEngine();
  }
  return globalHybridEngine;
}

/**
 * Сбросить глобальный движок
 */
export function resetGlobalHybridEngine(): void {
  if (globalHybridEngine) {
    globalHybridEngine.clear();
  }
  globalHybridEngine = null;
}

/**
 * Инициализировать глобальный движок с параметрами
 */
export function initGlobalHybridEngine(
  params?: Partial<HybridSearchParams>,
  getQueryEmbeddingFn?: GetQueryEmbeddingFn
): HybridSearchEngine {
  globalHybridEngine = new HybridSearchEngine(params, getQueryEmbeddingFn);
  return globalHybridEngine;
}

