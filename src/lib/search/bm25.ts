/**
 * @file bm25.ts
 * @description Реализация алгоритма BM25 (Best Matching 25)
 * 
 * BM25 - это вероятностный алгоритм ранжирования документов,
 * основанный на TF-IDF с дополнительными корректировками:
 * - Сатурация TF (term frequency) - частота термина насыщается
 * - Нормализация по длине документа
 * - IDF (inverse document frequency) - учёт редкости термина
 * 
 * Формула BM25:
 * score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D|/avgdl))
 * 
 * Где:
 * - f(qi, D) - частота термина qi в документе D
 * - |D| - длина документа в словах
 * - avgdl - средняя длина документа в коллекции
 * - k1 - параметр насыщения (обычно 1.2-2.0)
 * - b - параметр нормализации длины (обычно 0.75)
 */

import {
  tokenizeAndStem,
  getTermFrequencies,
  countWords,
  normalizeText,
} from './tokenizer';

// =============================================================================
// ТИПЫ И ИНТЕРФЕЙСЫ
// =============================================================================

/**
 * Документ для индексации в BM25
 */
export interface BM25Document {
  /** Уникальный идентификатор документа */
  id: string;
  /** Текст документа */
  text: string;
  /** Дополнительные метаданные */
  metadata?: Record<string, unknown>;
}

/**
 * Индексированный документ (внутреннее представление)
 */
interface IndexedDocument {
  /** ID документа */
  id: string;
  /** Частоты терминов в документе */
  termFrequencies: Map<string, number>;
  /** Длина документа в словах */
  length: number;
  /** Оригинальный текст (для отладки) */
  originalText?: string;
  /** Метаданные */
  metadata?: Record<string, unknown>;
}

/**
 * Результат поиска BM25
 */
export interface BM25SearchResult {
  /** ID документа */
  id: string;
  /** BM25 score */
  score: number;
  /** Нормализованный score [0, 1] */
  normalizedScore: number;
  /** Метаданные документа */
  metadata?: Record<string, unknown>;
}

/**
 * Параметры BM25
 */
export interface BM25Params {
  /** Параметр насыщения частоты терминов (k1) */
  k1: number;
  /** Параметр нормализации длины документа (b) */
  b: number;
  /** Буст для точного совпадения */
  exactMatchBoost: number;
}

/**
 * Статистика индекса
 */
export interface BM25Stats {
  /** Количество документов */
  documentCount: number;
  /** Количество уникальных терминов */
  termCount: number;
  /** Средняя длина документа */
  averageDocumentLength: number;
  /** Общее количество слов во всех документах */
  totalWords: number;
}

// =============================================================================
// КОНСТАНТЫ И ПАРАМЕТРЫ ПО УМОЛЧАНИЮ
// =============================================================================

/**
 * Параметры BM25 по умолчанию
 * Эти значения хорошо работают для большинства случаев
 */
export const DEFAULT_BM25_PARAMS: BM25Params = {
  k1: 1.5,             // Стандартное значение 1.2-2.0
  b: 0.75,             // Стандартное значение
  exactMatchBoost: 2.0, // Буст для точных совпадений
};

// =============================================================================
// КЛАСС BM25 ИНДЕКСА
// =============================================================================

/**
 * BM25 поисковый индекс
 * 
 * Реализует инвертированный индекс и алгоритм BM25 для
 * ранжирования документов по релевантности запросу.
 */
export class BM25Index {
  // ---------------------------------------------------------------------------
  // Приватные поля
  // ---------------------------------------------------------------------------
  
  /** Параметры алгоритма */
  private params: BM25Params;
  
  /** Инвертированный индекс: term -> Set<docId> */
  private invertedIndex: Map<string, Set<string>> = new Map();
  
  /** Индексированные документы: docId -> IndexedDocument */
  private documents: Map<string, IndexedDocument> = new Map();
  
  /** IDF (Inverse Document Frequency) для каждого терма */
  private idfCache: Map<string, number> = new Map();
  
  /** Средняя длина документа */
  private avgDocLength: number = 0;
  
  /** Общее количество слов */
  private totalWords: number = 0;
  
  // ---------------------------------------------------------------------------
  // Конструктор
  // ---------------------------------------------------------------------------
  
  /**
   * Создать новый BM25 индекс
   * 
   * @param params - Параметры BM25 (опционально)
   */
  constructor(params: Partial<BM25Params> = {}) {
    this.params = { ...DEFAULT_BM25_PARAMS, ...params };
  }
  
  // ---------------------------------------------------------------------------
  // Методы индексации
  // ---------------------------------------------------------------------------
  
  /**
   * Добавить документ в индекс
   * 
   * @param doc - Документ для индексации
   */
  addDocument(doc: BM25Document): void {
    // Токенизируем и стеммируем текст
    const termFrequencies = getTermFrequencies(doc.text);
    const docLength = countWords(doc.text);
    
    // Создаём индексированный документ
    const indexedDoc: IndexedDocument = {
      id: doc.id,
      termFrequencies,
      length: docLength,
      originalText: doc.text.slice(0, 500), // Сохраняем превью
      metadata: doc.metadata,
    };
    
    // Сохраняем документ
    this.documents.set(doc.id, indexedDoc);
    
    // Обновляем инвертированный индекс
    for (const term of termFrequencies.keys()) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set());
      }
      this.invertedIndex.get(term)!.add(doc.id);
    }
    
    // Обновляем статистику
    this.totalWords += docLength;
    this.updateStats();
  }
  
  /**
   * Добавить несколько документов
   * 
   * @param docs - Массив документов
   */
  addDocuments(docs: BM25Document[]): void {
    for (const doc of docs) {
      // Токенизируем и стеммируем текст
      const termFrequencies = getTermFrequencies(doc.text);
      const docLength = countWords(doc.text);
      
      // Создаём индексированный документ
      const indexedDoc: IndexedDocument = {
        id: doc.id,
        termFrequencies,
        length: docLength,
        originalText: doc.text.slice(0, 500),
        metadata: doc.metadata,
      };
      
      // Сохраняем документ
      this.documents.set(doc.id, indexedDoc);
      
      // Обновляем инвертированный индекс
      for (const term of termFrequencies.keys()) {
        if (!this.invertedIndex.has(term)) {
          this.invertedIndex.set(term, new Set());
        }
        this.invertedIndex.get(term)!.add(doc.id);
      }
      
      this.totalWords += docLength;
    }
    
    // Обновляем статистику один раз после всех добавлений
    this.updateStats();
  }
  
  /**
   * Удалить документ из индекса
   * 
   * @param docId - ID документа для удаления
   */
  removeDocument(docId: string): boolean {
    const doc = this.documents.get(docId);
    if (!doc) {
      return false;
    }
    
    // Удаляем из инвертированного индекса
    for (const term of doc.termFrequencies.keys()) {
      const postings = this.invertedIndex.get(term);
      if (postings) {
        postings.delete(docId);
        // Удаляем терм если больше нет документов
        if (postings.size === 0) {
          this.invertedIndex.delete(term);
        }
      }
    }
    
    // Обновляем статистику
    this.totalWords -= doc.length;
    
    // Удаляем документ
    this.documents.delete(docId);
    
    this.updateStats();
    return true;
  }
  
  /**
   * Очистить весь индекс
   */
  clear(): void {
    this.invertedIndex.clear();
    this.documents.clear();
    this.idfCache.clear();
    this.avgDocLength = 0;
    this.totalWords = 0;
  }
  
  // ---------------------------------------------------------------------------
  // Методы поиска
  // ---------------------------------------------------------------------------
  
  /**
   * Поиск документов по запросу
   * 
   * @param query - Поисковый запрос
   * @param limit - Максимальное количество результатов
   * @returns Массив результатов, отсортированных по релевантности
   */
  search(query: string, limit: number = 10): BM25SearchResult[] {
    if (this.documents.size === 0) {
      return [];
    }
    
    // Токенизируем запрос
    const queryTerms = tokenizeAndStem(query);
    
    if (queryTerms.length === 0) {
      return [];
    }
    
    // Нормализованный запрос для проверки точного совпадения
    const normalizedQuery = normalizeText(query);
    
    // Собираем документы-кандидаты (содержащие хотя бы один терм)
    const candidateDocIds = new Set<string>();
    for (const term of queryTerms) {
      const postings = this.invertedIndex.get(term);
      if (postings) {
        for (const docId of postings) {
          candidateDocIds.add(docId);
        }
      }
    }
    
    // Вычисляем BM25 score для каждого кандидата
    const results: BM25SearchResult[] = [];
    let maxScore = 0;
    
    for (const docId of candidateDocIds) {
      const doc = this.documents.get(docId)!;
      let score = this.computeBM25Score(queryTerms, doc);
      
      // Буст для точного совпадения
      if (doc.originalText && normalizeText(doc.originalText).includes(normalizedQuery)) {
        score *= this.params.exactMatchBoost;
      }
      
      maxScore = Math.max(maxScore, score);
      
      results.push({
        id: docId,
        score,
        normalizedScore: 0, // Вычислим после
        metadata: doc.metadata,
      });
    }
    
    // Нормализуем scores
    if (maxScore > 0) {
      for (const result of results) {
        result.normalizedScore = result.score / maxScore;
      }
    }
    
    // Сортируем по убыванию score
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, limit);
  }
  
  /**
   * Вычислить BM25 score для документа
   * 
   * @param queryTerms - Термы запроса
   * @param doc - Индексированный документ
   * @returns BM25 score
   */
  private computeBM25Score(queryTerms: string[], doc: IndexedDocument): number {
    const { k1, b } = this.params;
    let score = 0;
    
    for (const term of queryTerms) {
      // Частота термина в документе
      const tf = doc.termFrequencies.get(term) || 0;
      if (tf === 0) continue;
      
      // IDF термина
      const idf = this.getIDF(term);
      
      // BM25 формула
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (doc.length / this.avgDocLength));
      
      score += idf * (numerator / denominator);
    }
    
    return score;
  }
  
  /**
   * Получить IDF для термина
   * 
   * IDF = log((N - n + 0.5) / (n + 0.5) + 1)
   * 
   * Где N - общее количество документов, n - количество документов с термином
   * 
   * @param term - Терм
   * @returns IDF значение
   */
  private getIDF(term: string): number {
    // Проверяем кэш
    if (this.idfCache.has(term)) {
      return this.idfCache.get(term)!;
    }
    
    const N = this.documents.size;
    const postings = this.invertedIndex.get(term);
    const n = postings ? postings.size : 0;
    
    // BM25 IDF формула (с добавлением 1 для избежания отрицательных значений)
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    
    // Кэшируем
    this.idfCache.set(term, idf);
    
    return idf;
  }
  
  /**
   * Обновить статистику индекса
   */
  private updateStats(): void {
    // Средняя длина документа
    if (this.documents.size > 0) {
      this.avgDocLength = this.totalWords / this.documents.size;
    } else {
      this.avgDocLength = 0;
    }
    
    // Сбрасываем кэш IDF (нужно пересчитать)
    this.idfCache.clear();
  }
  
  // ---------------------------------------------------------------------------
  // Вспомогательные методы
  // ---------------------------------------------------------------------------
  
  /**
   * Получить статистику индекса
   */
  getStats(): BM25Stats {
    return {
      documentCount: this.documents.size,
      termCount: this.invertedIndex.size,
      averageDocumentLength: this.avgDocLength,
      totalWords: this.totalWords,
    };
  }
  
  /**
   * Проверить, есть ли документ в индексе
   */
  hasDocument(docId: string): boolean {
    return this.documents.has(docId);
  }
  
  /**
   * Получить количество документов
   */
  getDocumentCount(): number {
    return this.documents.size;
  }
  
  /**
   * Получить все ID документов
   */
  getDocumentIds(): string[] {
    return [...this.documents.keys()];
  }
  
  /**
   * Экспортировать индекс в JSON (для сохранения)
   */
  exportIndex(): string {
    const data = {
      params: this.params,
      documents: [...this.documents.entries()].map(([id, doc]) => ({
        id,
        termFrequencies: [...doc.termFrequencies.entries()],
        length: doc.length,
        metadata: doc.metadata,
      })),
      invertedIndex: [...this.invertedIndex.entries()].map(([term, docIds]) => ({
        term,
        docIds: [...docIds],
      })),
      avgDocLength: this.avgDocLength,
      totalWords: this.totalWords,
    };
    return JSON.stringify(data);
  }
  
  /**
   * Импортировать индекс из JSON
   */
  importIndex(json: string): void {
    const data = JSON.parse(json);
    
    this.params = data.params;
    this.avgDocLength = data.avgDocLength;
    this.totalWords = data.totalWords;
    
    // Восстанавливаем документы
    this.documents.clear();
    for (const doc of data.documents) {
      this.documents.set(doc.id, {
        id: doc.id,
        termFrequencies: new Map(doc.termFrequencies),
        length: doc.length,
        metadata: doc.metadata,
      });
    }
    
    // Восстанавливаем инвертированный индекс
    this.invertedIndex.clear();
    for (const entry of data.invertedIndex) {
      this.invertedIndex.set(entry.term, new Set(entry.docIds));
    }
    
    // Сбрасываем кэш IDF
    this.idfCache.clear();
  }
}

// =============================================================================
// ГЛОБАЛЬНЫЙ СИНГЛТОН ДЛЯ УДОБСТВА
// =============================================================================

/**
 * Глобальный экземпляр BM25 индекса
 * Используется для индексации карточек приложения
 */
let globalBM25Index: BM25Index | null = null;

/**
 * Получить глобальный BM25 индекс
 */
export function getGlobalBM25Index(): BM25Index {
  if (!globalBM25Index) {
    globalBM25Index = new BM25Index();
  }
  return globalBM25Index;
}

/**
 * Сбросить глобальный BM25 индекс
 */
export function resetGlobalBM25Index(): void {
  if (globalBM25Index) {
    globalBM25Index.clear();
  }
  globalBM25Index = null;
}

