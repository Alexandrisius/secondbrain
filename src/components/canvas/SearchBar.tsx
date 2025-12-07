/**
 * @file SearchBar.tsx
 * @description Компонент гибридного поиска "Мини-Google" по карточкам
 * 
 * Расположен в верхней части канваса по центру.
 * 
 * ГИБРИДНЫЙ ПОИСК объединяет:
 * 1. BM25 - классический алгоритм ранжирования (keyword matching)
 * 2. Semantic Search - семантический поиск на эмбеддингах
 * 3. Fuzzy Search - нечёткий поиск (опечатки, вариации)
 * 4. Exact Match - точное совпадение фраз
 * 
 * Результаты объединяются через Reciprocal Rank Fusion (RRF)
 * 
 * Возможности:
 * - Мгновенный поиск при вводе (BM25 + Exact)
 * - Полный гибридный поиск (с семантикой) по Enter
 * - Переключение: текущий холст / все холсты
 * - Отображение топ-10 результатов с рейтингом
 * - Детали релевантности (какие методы нашли)
 * - Центрирование на карточке при клике
 * - Горячая клавиша Ctrl+P для быстрого доступа
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Search, X, Globe, FileText, Loader2, RefreshCw, 
  Sparkles, Zap, Hash, Type 
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import { 
  HybridSearchEngine, 
  type HybridSearchResult,
  type HybridDocument,
} from '@/lib/search';
import { countIndexedCards, reindexCanvasCards } from '@/lib/search/semantic';
import { getAllEmbeddings, getEmbeddingsByCanvas, syncAllEmbeddings, syncEmbeddingsWithCanvas } from '@/lib/db/embeddings';

// =============================================================================
// ТИПЫ PROPS
// =============================================================================

interface SearchBarProps {
  /** Флаг видимости (управляется извне для Ctrl+P) */
  isOpen: boolean;
  
  /** Callback закрытия */
  onClose: () => void;
  
  /** Callback при выборе результата (для центрирования) */
  onSelectResult: (nodeId: string, canvasId: string) => void;
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/** Задержка debounce для быстрого поиска (мс) */
const QUICK_SEARCH_DEBOUNCE = 100;

/** Минимальная длина запроса для поиска */
const MIN_QUERY_LENGTH = 2;

/** Максимум результатов */
const MAX_RESULTS = 10;

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

export function SearchBar({ isOpen, onClose, onSelectResult }: SearchBarProps) {
  // ===========================================================================
  // ХУКИ
  // ===========================================================================
  
  const { t } = useTranslation();
  const apiKey = useSettingsStore((s) => s.apiKey);
  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const nodes = useCanvasStore((s) => s.nodes);
  
  // ===========================================================================
  // СОСТОЯНИЕ
  // ===========================================================================
  
  /** Поисковый запрос */
  const [query, setQuery] = useState('');
  
  /** Результаты поиска */
  const [results, setResults] = useState<HybridSearchResult[]>([]);
  
  /** Флаг загрузки (быстрый поиск) */
  const [isQuickSearching, setIsQuickSearching] = useState(false);
  
  /** Флаг загрузки (полный поиск с семантикой) */
  const [isFullSearching, setIsFullSearching] = useState(false);
  
  /** Ошибка поиска */
  const [error, setError] = useState<string | null>(null);
  
  /** Режим поиска: true = все холсты, false = текущий */
  const [searchAllCanvases, setSearchAllCanvases] = useState(false);
  
  /** Количество проиндексированных карточек */
  const [indexedCount, setIndexedCount] = useState(0);
  
  /** Индекс выбранного результата для навигации клавишами */
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  /** Флаг переиндексации */
  const [isReindexing, setIsReindexing] = useState(false);
  
  /** Прогресс переиндексации */
  const [reindexProgress, setReindexProgress] = useState({ current: 0, total: 0 });
  
  /** Количество карточек на холсте */
  const [totalCards, setTotalCards] = useState(0);
  
  /** Режим поиска: 'quick' (без семантики) или 'full' (с семантикой) */
  const [searchMode, setSearchMode] = useState<'quick' | 'full'>('quick');
  
  
  // ===========================================================================
  // REFS
  // ===========================================================================
  
  const inputRef = useRef<HTMLInputElement>(null);
  const quickDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const fullDebounceRef = useRef<NodeJS.Timeout | null>(null);
  
  /** Гибридный поисковый движок */
  const searchEngineRef = useRef<HybridSearchEngine | null>(null);
  
  // ===========================================================================
  // ИНИЦИАЛИЗАЦИЯ ПОИСКОВОГО ДВИЖКА
  // ===========================================================================
  
  /**
   * Создать и проиндексировать поисковый движок
   */
  const initSearchEngine = useCallback(async () => {
    console.log('[SearchBar] Инициализация гибридного поиска...');
    
    // =========================================================================
    // СИНХРОНИЗАЦИЯ ЭМБЕДДИНГОВ
    // Удаляем "призраки" - эмбеддинги для удалённых карточек
    // =========================================================================
    try {
      if (searchAllCanvases) {
        // При поиске по всем холстам - глобальная синхронизация
        console.log('[SearchBar] Глобальная синхронизация эмбеддингов...');
        await syncAllEmbeddings();
      } else if (activeCanvasId) {
        // При поиске по текущему холсту - синхронизация только с ним
        console.log('[SearchBar] Синхронизация эмбеддингов с текущим холстом...');
        const existingNodeIds = nodes.map(n => n.id);
        await syncEmbeddingsWithCanvas(activeCanvasId, existingNodeIds);
      }
    } catch (error) {
      console.error('[SearchBar] Ошибка синхронизации эмбеддингов:', error);
    }
    
    // Создаём движок с функцией получения эмбеддинга
    const engine = new HybridSearchEngine(
      {}, // Параметры по умолчанию
      async (queryText: string) => {
        // Функция для получения эмбеддинга запроса
        if (!apiKey) return null;
        
        try {
          const response = await fetch('/api/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: queryText, apiKey }),
          });
          
          if (!response.ok) return null;
          
          const data = await response.json();
          return data.embedding;
        } catch {
          return null;
        }
      }
    );
    
    // Загружаем эмбеддинги из IndexedDB (уже синхронизированные)
    const embeddings = searchAllCanvases 
      ? await getAllEmbeddings()
      : activeCanvasId 
        ? await getEmbeddingsByCanvas(activeCanvasId)
        : [];
    
    // Индексируем документы
    const documents: HybridDocument[] = [];
    
    for (const emb of embeddings) {
      documents.push({
        id: emb.nodeId,
        canvasId: emb.canvasId,
        title: emb.prompt,
        text: `${emb.prompt} ${emb.responsePreview}`,
        preview: emb.responsePreview,
        embedding: emb.embedding,
      });
    }
    
    // Добавляем также карточки из текущего холста, которые ещё не проиндексированы
    // (чтобы можно было искать по ним через BM25)
    const indexedIds = new Set(documents.map(d => d.id));
    
    for (const node of nodes) {
      if (!indexedIds.has(node.id) && node.data.response) {
        documents.push({
          id: node.id,
          canvasId: activeCanvasId || '',
          title: node.data.prompt,
          text: `${node.data.prompt} ${node.data.response}`,
          preview: node.data.response.slice(0, 200),
          // Без эмбеддинга - будет только BM25/fuzzy/exact
        });
      }
    }
    
    engine.addDocuments(documents);
    searchEngineRef.current = engine;
    
    console.log(`[SearchBar] Проиндексировано ${documents.length} документов`);
    
    return engine;
  }, [apiKey, activeCanvasId, searchAllCanvases, nodes]);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  /**
   * Фокус на input при открытии и инициализация движка
   */
  useEffect(() => {
    if (isOpen) {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
      
      // Инициализируем поисковый движок
      initSearchEngine();
    }
  }, [isOpen, initSearchEngine]);
  
  /**
   * Переинициализация при смене режима (все холсты / текущий)
   */
  useEffect(() => {
    if (isOpen) {
      initSearchEngine();
    }
  }, [searchAllCanvases, isOpen, initSearchEngine]);
  
  /**
   * Автоматический перезапуск поиска при смене режима
   */
  const prevSearchAllCanvasesRef = useRef(searchAllCanvases);
  useEffect(() => {
    // Проверяем, что режим действительно изменился (а не это первый рендер)
    if (prevSearchAllCanvasesRef.current !== searchAllCanvases && isOpen) {
      prevSearchAllCanvasesRef.current = searchAllCanvases;
      
      // Перезапускаем поиск если есть запрос
      if (query.length >= MIN_QUERY_LENGTH && searchEngineRef.current) {
        // Небольшая задержка чтобы индекс успел обновиться
        const timer = setTimeout(() => {
          if (searchEngineRef.current) {
            setIsQuickSearching(true);
            try {
              const canvasFilter = searchAllCanvases ? undefined : (activeCanvasId || undefined);
              const searchResults = searchEngineRef.current.quickSearch(query, MAX_RESULTS);
              const filtered = canvasFilter 
                ? searchResults.filter(r => r.canvasId === canvasFilter)
                : searchResults;
              setResults(filtered);
              setSearchMode('quick');
              setError(filtered.length === 0 ? t.search.noResults : null);
            } catch (err) {
              console.error('[SearchBar] Ошибка перезапуска поиска:', err);
            } finally {
              setIsQuickSearching(false);
            }
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [searchAllCanvases, isOpen, query, activeCanvasId, t.search.noResults]);
  
  /**
   * Сброс состояния при закрытии
   */
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setQuery('');
        setResults([]);
        setError(null);
        setSelectedIndex(0);
        setSearchMode('quick');
        searchEngineRef.current = null;
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);
  
  /**
   * Загрузка количества проиндексированных карточек
   */
  useEffect(() => {
    if (isOpen) {
      const loadCounts = async () => {
        const indexed = await countIndexedCards(searchAllCanvases ? null : activeCanvasId);
        setIndexedCount(indexed);
        
        const cardsWithResponse = nodes.filter((n) => n.data.response).length;
        setTotalCards(cardsWithResponse);
      };
      loadCounts();
    }
  }, [isOpen, searchAllCanvases, activeCanvasId, nodes]);
  
  /**
   * Сброс выбранного индекса при изменении результатов
   */
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ ПОИСКА
  // ===========================================================================
  
  /**
   * Быстрый поиск (BM25 + Exact, без семантики)
   */
  const performQuickSearch = useCallback((searchQuery: string) => {
    if (quickDebounceRef.current) {
      clearTimeout(quickDebounceRef.current);
    }
    
    if (!searchQuery.trim() || searchQuery.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      return;
    }
    
    quickDebounceRef.current = setTimeout(() => {
      if (!searchEngineRef.current) return;
      
      setIsQuickSearching(true);
      
      try {
        const canvasFilter = searchAllCanvases ? undefined : (activeCanvasId || undefined);
        const searchResults = searchEngineRef.current.quickSearch(searchQuery, MAX_RESULTS);
        
        // Фильтруем по холсту если нужно
        const filtered = canvasFilter 
          ? searchResults.filter(r => r.canvasId === canvasFilter)
          : searchResults;
        
        setResults(filtered);
        setSearchMode('quick');
        
        if (filtered.length === 0 && searchQuery.length >= MIN_QUERY_LENGTH) {
          setError(t.search.noResults);
        } else {
          setError(null);
        }
      } catch (err) {
        console.error('[SearchBar] Ошибка быстрого поиска:', err);
      } finally {
        setIsQuickSearching(false);
      }
    }, QUICK_SEARCH_DEBOUNCE);
  }, [activeCanvasId, searchAllCanvases, t]);
  
  /**
   * Полный гибридный поиск (с семантикой)
   */
  const performFullSearch = useCallback(async (searchQuery: string) => {
    if (fullDebounceRef.current) {
      clearTimeout(fullDebounceRef.current);
    }
    
    if (!searchQuery.trim() || searchQuery.length < MIN_QUERY_LENGTH) {
      return;
    }
    
    if (!apiKey) {
      setError(t.node.apiKeyMissing);
      return;
    }
    
    setIsFullSearching(true);
    setError(null);
    
    try {
      if (!searchEngineRef.current) {
        await initSearchEngine();
      }
      
      if (!searchEngineRef.current) return;
      
      const canvasFilter = searchAllCanvases ? undefined : (activeCanvasId || undefined);
      const searchResults = await searchEngineRef.current.search(
        searchQuery, 
        MAX_RESULTS,
        canvasFilter
      );
      
      setResults(searchResults);
      setSearchMode('full');
      
      if (searchResults.length === 0) {
        setError(t.search.noResults);
      }
    } catch (err) {
      console.error('[SearchBar] Ошибка полного поиска:', err);
      setError(err instanceof Error ? err.message : t.search.searchError);
    } finally {
      setIsFullSearching(false);
    }
  }, [apiKey, activeCanvasId, searchAllCanvases, t, initSearchEngine]);
  
  /**
   * Обработчик изменения запроса
   */
  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value;
    setQuery(newQuery);
    performQuickSearch(newQuery);
  };
  
  /**
   * Обработчик выбора результата
   */
  const handleSelectResult = (result: HybridSearchResult) => {
    if (result.canvasId) {
      onSelectResult(result.id, result.canvasId);
    }
    onClose();
  };
  
  /**
   * Обработчик клавиш
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < results.length - 1 ? prev + 1 : prev
        );
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
        
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelectResult(results[selectedIndex]);
        } else if (query.length >= MIN_QUERY_LENGTH) {
          // Если нет результатов - запускаем полный поиск
          performFullSearch(query);
        }
        break;
        
      case 'Tab':
        e.preventDefault();
        // Переключаем режим - поиск перезапустится автоматически через useEffect
        setSearchAllCanvases((prev) => !prev);
        break;
    }
  };
  
  /**
   * Получить название холста по ID
   */
  const getCanvasName = (canvasId: string): string => {
    const canvas = canvases.find((c) => c.id === canvasId);
    return canvas?.name || canvasId;
  };
  
  /**
   * Переиндексация всех карточек текущего холста
   */
  const handleReindex = async () => {
    if (!apiKey || !activeCanvasId || isReindexing) return;
    
    setIsReindexing(true);
    setReindexProgress({ current: 0, total: 0 });
    
    try {
      const count = await reindexCanvasCards(
        activeCanvasId,
        nodes,
        apiKey,
        (current, total) => {
          setReindexProgress({ current, total });
        }
      );
      
      const newIndexedCount = await countIndexedCards(searchAllCanvases ? null : activeCanvasId);
      setIndexedCount(newIndexedCount);
      
      // Переинициализируем движок с новыми эмбеддингами
      await initSearchEngine();
      
      console.log(`[SearchBar] Переиндексировано ${count} карточек`);
    } catch (err) {
      console.error('[SearchBar] Ошибка переиндексации:', err);
      setError(t.search.searchError);
    } finally {
      setIsReindexing(false);
      setReindexProgress({ current: 0, total: 0 });
    }
  };
  
  // ===========================================================================
  // ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ
  // ===========================================================================
  
  /**
   * Бейдж метода поиска
   */
  const MethodBadge = ({ 
    type, 
    score, 
    rank 
  }: { 
    type: 'bm25' | 'semantic' | 'fuzzy' | 'exact'; 
    score: number; 
    rank: number;
  }) => {
    const config = {
      bm25: { icon: Hash, label: 'BM25', color: 'bg-blue-500/20 text-blue-600 dark:text-blue-400' },
      semantic: { icon: Sparkles, label: 'AI', color: 'bg-purple-500/20 text-purple-600 dark:text-purple-400' },
      fuzzy: { icon: Type, label: 'Fuzzy', color: 'bg-orange-500/20 text-orange-600 dark:text-orange-400' },
      exact: { icon: Zap, label: 'Exact', color: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' },
    };
    
    const { icon: Icon, label, color } = config[type];
    
    return (
      <span 
        className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium ${color}`}
        title={`${label}: rank #${rank}, score ${(score * 100).toFixed(0)}%`}
      >
        <Icon className="w-2.5 h-2.5" />
        {rank}
      </span>
    );
  };
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  if (!isOpen) return null;
  
  const isSearching = isQuickSearching || isFullSearching;
  
  return (
    <>
      {/* ----- ОВЕРЛЕЙ ----- */}
      <div
        className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* ----- ПОИСКОВЫЙ КОНТЕЙНЕР ----- */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[101] w-full max-w-2xl px-4">
        <div className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">
          
          {/* ----- ПОЛЕ ВВОДА ----- */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            {/* Иконка поиска / лоадер */}
            {isSearching ? (
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            ) : (
              <Search className="w-5 h-5 text-muted-foreground" />
            )}
            
            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={handleKeyDown}
              placeholder={t.search.placeholder}
              className="flex-1 bg-transparent border-none outline-none text-base text-foreground placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
            
            {/* Кнопка полного поиска с AI */}
            {query.length >= MIN_QUERY_LENGTH && !isFullSearching && (
              <button
                onClick={() => performFullSearch(query)}
                disabled={!apiKey}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50"
                title="Полный поиск с AI (Enter)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI
              </button>
            )}
            
            {/* Переключатель режима */}
            <button
              onClick={() => setSearchAllCanvases((prev) => !prev)}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
                transition-colors duration-150
                ${searchAllCanvases
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }
              `}
              title={searchAllCanvases ? t.search.allCanvases : t.search.currentCanvas}
            >
              {searchAllCanvases ? (
                <Globe className="w-3.5 h-3.5" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              <span>{searchAllCanvases ? t.search.all : t.search.current}</span>
            </button>
            
            {/* Кнопка закрытия */}
            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={t.common.close}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* ----- ИНДИКАТОР РЕЖИМА ПОИСКА ----- */}
          {searchMode === 'full' && results.length > 0 && (
            <div className="px-4 py-1.5 bg-purple-500/5 border-b border-purple-500/10 flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Гибридный поиск: BM25 + AI Semantic + Fuzzy + Exact Match</span>
            </div>
          )}
          
          {/* ----- РЕЗУЛЬТАТЫ ----- */}
          <div className="max-h-96 overflow-y-auto">
            {/* Ошибка */}
            {error && !isSearching && results.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            )}
            
            {/* Пустой запрос */}
            {!query && !error && (
              <div className="px-4 py-6 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Hash className="w-4 h-4 text-blue-500" />
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  <Type className="w-4 h-4 text-orange-500" />
                  <Zap className="w-4 h-4 text-emerald-500" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.search.hint}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-2">
                  Гибридный поиск: BM25 + Semantic + Fuzzy + Exact
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {t.search.indexedCards.replace('{count}', String(indexedCount))}
                </p>
                
                {/* Кнопка переиндексации */}
                {totalCards > 0 && indexedCount < totalCards && !isReindexing && (
                  <button
                    onClick={handleReindex}
                    disabled={!apiKey}
                    className="mt-4 px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4 inline-block mr-2" />
                    {t.search.reindex} ({totalCards - indexedCount})
                  </button>
                )}
                
                {/* Прогресс переиндексации */}
                {isReindexing && (
                  <div className="mt-4">
                    <div className="flex items-center justify-center gap-2 text-sm text-primary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {t.search.reindexing} {reindexProgress.current}/{reindexProgress.total}
                      </span>
                    </div>
                    <div className="mt-2 w-48 mx-auto h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-200"
                        style={{ 
                          width: reindexProgress.total > 0 
                            ? `${(reindexProgress.current / reindexProgress.total) * 100}%` 
                            : '0%' 
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            
            {/* Список результатов */}
            {results.length > 0 && (
              <ul className="py-2">
                {results.map((result, index) => (
                  <li key={result.id}>
                    <button
                      onClick={() => handleSelectResult(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`
                        w-full px-4 py-3 text-left transition-colors duration-100
                        ${index === selectedIndex
                          ? 'bg-accent/50'
                          : 'hover:bg-accent/30'
                        }
                      `}
                    >
                      {/* Заголовок */}
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground line-clamp-1 flex-1">
                          {result.title || t.search.untitled}
                        </span>
                        
                        {/* Скор релевантности */}
                        <span
                          className={`
                            text-xs font-semibold px-1.5 py-0.5 rounded
                            ${result.normalizedScore >= 0.7
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              : result.normalizedScore >= 0.4
                                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                : 'bg-muted text-muted-foreground'
                            }
                          `}
                        >
                          {Math.round(result.normalizedScore * 100)}%
                        </span>
                      </div>
                      
                      {/* Превью ответа */}
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {result.preview || t.search.noResponse}
                      </p>
                      
                      {/* Детали методов поиска */}
                      {searchMode === 'full' && (
                        <div className="flex items-center gap-1 mt-1.5">
                          {result.breakdown.bm25 && (
                            <MethodBadge 
                              type="bm25" 
                              score={result.breakdown.bm25.score} 
                              rank={result.breakdown.bm25.rank} 
                            />
                          )}
                          {result.breakdown.semantic && (
                            <MethodBadge 
                              type="semantic" 
                              score={result.breakdown.semantic.score} 
                              rank={result.breakdown.semantic.rank} 
                            />
                          )}
                          {result.breakdown.fuzzy && (
                            <MethodBadge 
                              type="fuzzy" 
                              score={result.breakdown.fuzzy.score} 
                              rank={result.breakdown.fuzzy.rank} 
                            />
                          )}
                          {result.breakdown.exact && (
                            <MethodBadge 
                              type="exact" 
                              score={result.breakdown.exact.score} 
                              rank={result.breakdown.exact.rank} 
                            />
                          )}
                        </div>
                      )}
                      
                      {/* Название холста */}
                      {searchAllCanvases && result.canvasId && result.canvasId !== activeCanvasId && (
                        <p className="text-xs text-primary/70 mt-1 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {getCanvasName(result.canvasId)}
                        </p>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          {/* ----- ПОДСКАЗКИ ----- */}
          <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">↑↓</kbd>
              {' '}{t.search.navigate}
              {' • '}
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">Enter</kbd>
              {' '}{t.search.select}
              {' • '}
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">Tab</kbd>
              {' '}{t.search.toggleScope}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono">Esc</kbd>
              {' '}{t.search.close}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

// =============================================================================
// ЭКСПОРТ
// =============================================================================

export default SearchBar;
