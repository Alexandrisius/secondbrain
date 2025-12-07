/**
 * @file index.ts
 * @description Экспорты модуля поиска "Мини-Google"
 * 
 * Гибридный поисковый движок, объединяющий:
 * - BM25 (классический алгоритм ранжирования)
 * - Семантический поиск (эмбеддинги)
 * - Fuzzy поиск (опечатки, похожие слова)
 * - Точное совпадение
 * 
 * Результаты объединяются через Reciprocal Rank Fusion (RRF)
 */

// =============================================================================
// ОСНОВНОЙ ГИБРИДНЫЙ ДВИЖОК
// =============================================================================

export {
  HybridSearchEngine,
  getGlobalHybridEngine,
  resetGlobalHybridEngine,
  initGlobalHybridEngine,
  DEFAULT_HYBRID_PARAMS,
  type HybridDocument,
  type HybridSearchResult,
  type HybridWeights,
  type HybridSearchParams,
  type GetQueryEmbeddingFn,
} from './hybrid';

// =============================================================================
// BM25 ПОИСК
// =============================================================================

export {
  BM25Index,
  getGlobalBM25Index,
  resetGlobalBM25Index,
  DEFAULT_BM25_PARAMS,
  type BM25Document,
  type BM25SearchResult,
  type BM25Params,
  type BM25Stats,
} from './bm25';

// =============================================================================
// FUZZY ПОИСК
// =============================================================================

export {
  FuzzyIndex,
  getGlobalFuzzyIndex,
  resetGlobalFuzzyIndex,
  levenshteinDistance,
  levenshteinSimilarity,
  combinedFuzzySimilarity,
  areSimilar,
  findMostSimilar,
  DEFAULT_FUZZY_PARAMS,
  type FuzzyDocument,
  type FuzzySearchResult,
  type FuzzyMatch,
  type FuzzySearchParams,
} from './fuzzy';

// =============================================================================
// ТОКЕНИЗАЦИЯ
// =============================================================================

export {
  normalizeText,
  tokenize,
  tokenizeWithStopWords,
  tokenizeAndStem,
  getTermFrequencies,
  generateNgrams,
  generateTextNgrams,
  jaccardSimilarity,
  countWords,
  extractKeywords,
  isStopWord,
  stem,
} from './tokenizer';

