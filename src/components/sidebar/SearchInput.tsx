/**
 * @file SearchInput.tsx
 * @description Компонент поиска по холстам с debounce и подсветкой результатов
 * 
 * Функции:
 * - Debounce поиск (300ms)
 * - Поиск по названию холста и папки
 * - Клавиатурное сокращение Ctrl/Cmd + K для фокуса
 * - Очистка по кнопке X или Escape
 * - Современный дизайн с анимациями
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Search, 
  X,
  FileText,
  Folder,
  Command,
} from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// =============================================================================
// ТИПЫ
// =============================================================================

interface SearchInputProps {
  /** Callback при выборе результата поиска */
  onResultSelect?: (type: 'canvas' | 'folder', id: string) => void;
}

/**
 * Результат поиска
 */
interface SearchResult {
  type: 'canvas' | 'folder';
  id: string;
  name: string;
  /** Путь к элементу (названия родительских папок) */
  path: string[];
  /** Индексы совпадений в названии для подсветки */
  matchIndices: number[];
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/** Задержка debounce в миллисекундах */
const DEBOUNCE_DELAY = 200;

/** Максимальное количество результатов */
const MAX_RESULTS = 10;

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Находит индексы совпадений подстроки в строке (case-insensitive)
 */
function findMatchIndices(text: string, query: string): number[] {
  const indices: number[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  
  let startIndex = 0;
  let index: number;
  
  while ((index = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
    for (let i = 0; i < query.length; i++) {
      indices.push(index + i);
    }
    startIndex = index + 1;
  }
  
  return indices;
}

/**
 * Рендерит текст с подсветкой совпадений
 */
function HighlightedText({ 
  text, 
  matchIndices 
}: { 
  text: string; 
  matchIndices: number[];
}) {
  if (matchIndices.length === 0) {
    return <>{text}</>;
  }
  
  const chars = text.split('');
  const matchSet = new Set(matchIndices);
  
  return (
    <>
      {chars.map((char, index) => (
        <span
          key={index}
          className={cn(
            matchSet.has(index) && 'text-[#89b4fa] font-semibold',
          )}
        >
          {char}
        </span>
      ))}
    </>
  );
}

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * SearchInput - компонент поиска по холстам и папкам
 */
export function SearchInput({ onResultSelect }: SearchInputProps) {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // ===========================================================================
  // СОСТОЯНИЕ STORE
  // ===========================================================================
  
  const folders = useWorkspaceStore((s) => s.folders);
  const canvases = useWorkspaceStore((s) => s.canvases);
  const openCanvas = useWorkspaceStore((s) => s.openCanvas);
  const toggleFolderExpanded = useWorkspaceStore((s) => s.toggleFolderExpanded);
  
  // ===========================================================================
  // ЛОКАЛЬНОЕ СОСТОЯНИЕ
  // ===========================================================================
  
  /** Текущий поисковый запрос */
  const [query, setQuery] = useState('');
  
  /** Debounced поисковый запрос */
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  /** Показывать ли dropdown с результатами */
  const [showResults, setShowResults] = useState(false);
  
  /** Индекс выбранного результата (для keyboard navigation) */
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  /** Ref на input для фокуса */
  const inputRef = useRef<HTMLInputElement>(null);
  
  /** Ref на контейнер для клика вне */
  const containerRef = useRef<HTMLDivElement>(null);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  /**
   * Debounce для поискового запроса
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_DELAY);
    
    return () => clearTimeout(timer);
  }, [query]);
  
  /**
   * Глобальный keyboard shortcut (Ctrl/Cmd + K)
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setShowResults(true);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  /**
   * Закрытие при клике вне компонента
   */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // ===========================================================================
  // МЕМОИЗИРОВАННЫЕ ВЫЧИСЛЕНИЯ
  // ===========================================================================
  
  /**
   * Построение карты папок для быстрого получения пути
   */
  const folderMap = useMemo(() => {
    const map = new Map<string, { name: string; parentId: string | null }>();
    folders.forEach(f => {
      map.set(f.id, { name: f.name, parentId: f.parentId });
    });
    return map;
  }, [folders]);
  
  /**
   * Получить путь к элементу (названия родительских папок)
   */
  const getPath = useCallback((parentId: string | null): string[] => {
    const path: string[] = [];
    let currentId = parentId;
    
    while (currentId) {
      const folder = folderMap.get(currentId);
      if (folder) {
        path.unshift(folder.name);
        currentId = folder.parentId;
      } else {
        break;
      }
    }
    
    return path;
  }, [folderMap]);
  
  /**
   * Результаты поиска
   */
  const searchResults = useMemo((): SearchResult[] => {
    if (!debouncedQuery.trim()) return [];
    
    const results: SearchResult[] = [];
    const lowerQuery = debouncedQuery.toLowerCase();
    
    // Поиск по холстам
    canvases.forEach(canvas => {
      if (canvas.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'canvas',
          id: canvas.id,
          name: canvas.name,
          path: getPath(canvas.folderId),
          matchIndices: findMatchIndices(canvas.name, debouncedQuery),
        });
      }
    });
    
    // Поиск по папкам
    folders.forEach(folder => {
      if (folder.name.toLowerCase().includes(lowerQuery)) {
        results.push({
          type: 'folder',
          id: folder.id,
          name: folder.name,
          path: getPath(folder.parentId),
          matchIndices: findMatchIndices(folder.name, debouncedQuery),
        });
      }
    });
    
    // Сортируем: сначала точные совпадения, потом по алфавиту
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === lowerQuery;
      const bExact = b.name.toLowerCase() === lowerQuery;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.name.localeCompare(b.name);
    });
    
    return results.slice(0, MAX_RESULTS);
  }, [debouncedQuery, canvases, folders, getPath]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================
  
  /**
   * Изменение поискового запроса
   */
  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(-1);
    setShowResults(true);
  }, []);
  
  /**
   * Очистка поиска
   */
  const handleClear = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }, []);
  
  /**
   * Выбор результата
   */
  const handleSelectResult = useCallback((result: SearchResult) => {
    if (result.type === 'canvas') {
      openCanvas(result.id);
    } else {
      // Раскрываем папку и её родителей
      let currentId: string | null = result.id;
      while (currentId) {
        toggleFolderExpanded(currentId);
        const folder = folderMap.get(currentId);
        currentId = folder?.parentId || null;
      }
    }
    
    onResultSelect?.(result.type, result.id);
    setQuery('');
    setDebouncedQuery('');
    setShowResults(false);
  }, [openCanvas, toggleFolderExpanded, folderMap, onResultSelect]);
  
  /**
   * Keyboard navigation
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (query) {
          handleClear();
        } else {
          setShowResults(false);
          inputRef.current?.blur();
        }
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < searchResults.length - 1 ? prev + 1 : 0
        );
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : searchResults.length - 1
        );
        break;
        
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && searchResults[selectedIndex]) {
          handleSelectResult(searchResults[selectedIndex]);
        }
        break;
    }
  }, [query, searchResults, selectedIndex, handleClear, handleSelectResult]);
  
  /**
   * Фокус на input
   */
  const handleFocus = useCallback(() => {
    setShowResults(true);
  }, []);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  return (
    <div 
      ref={containerRef}
      className="relative"
    >
      {/* ===================================================================== */}
      {/* INPUT */}
      {/* ===================================================================== */}
      
      <div 
        className={cn(
          // Базовые стили
          'relative flex items-center',
          'h-9 px-3',
          'rounded-lg',
          // Цвета
          'bg-[#181825]',
          'border border-[#313244]',
          // Фокус состояние
          'focus-within:border-[#89b4fa]/50',
          'focus-within:ring-2 focus-within:ring-[#89b4fa]/20',
          // Переход
          'transition-all duration-200',
        )}
      >
        {/* Иконка поиска */}
        <Search className="w-4 h-4 text-[#6c7086] flex-shrink-0" />
        
        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={t.sidebar.searchPlaceholder}
          className={cn(
            // Специальный класс для отключения глобального focus-visible ring
            'sidebar-search-input',
            'flex-1 bg-transparent',
            'px-2 text-sm text-[#cdd6f4]',
            'placeholder:text-[#6c7086]',
            // Полностью убираем все эффекты фокуса с input
            // (красивая подсветка идёт от родительского контейнера)
            'focus:outline-none focus:ring-0 focus:border-0',
            'outline-none ring-0 border-0',
          )}
        />
        
        {/* Кнопка очистки или хинт */}
        {query ? (
          <button
            onClick={handleClear}
            className={cn(
              'p-1 rounded',
              'text-[#6c7086] hover:text-[#cdd6f4]',
              'hover:bg-[#313244]',
              'transition-colors duration-100',
            )}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <div className="flex items-center gap-0.5 text-[#6c7086]">
            <kbd className={cn(
              'px-1.5 py-0.5 rounded',
              'text-[10px] font-medium',
              'bg-[#313244] border border-[#45475a]',
            )}>
              <Command className="w-2.5 h-2.5 inline-block" />
            </kbd>
            <kbd className={cn(
              'px-1.5 py-0.5 rounded',
              'text-[10px] font-medium',
              'bg-[#313244] border border-[#45475a]',
            )}>
              K
            </kbd>
          </div>
        )}
      </div>
      
      {/* ===================================================================== */}
      {/* РЕЗУЛЬТАТЫ */}
      {/* ===================================================================== */}
      
      {showResults && debouncedQuery && (
        <div 
          className={cn(
            // Позиционирование
            'absolute top-full left-0 right-0 mt-2',
            'z-50',
            // Стили
            'py-2 rounded-xl',
            'bg-[#1e1e2e]/95 backdrop-blur-xl',
            'border border-[#313244]',
            'shadow-2xl shadow-black/40',
            // Анимация
            'animate-in fade-in-0 zoom-in-95 duration-150',
          )}
        >
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none rounded-xl" />
          
          {searchResults.length > 0 ? (
            <div className="relative max-h-64 overflow-y-auto">
              {searchResults.map((result, index) => {
                const Icon = result.type === 'canvas' ? FileText : Folder;
                const isSelected = index === selectedIndex;
                
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    onClick={() => handleSelectResult(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'w-full flex items-center gap-3',
                      'px-3 py-2 mx-1.5',
                      'w-[calc(100%-12px)]',
                      'text-left rounded-lg',
                      'transition-all duration-100',
                      isSelected && 'bg-[#89b4fa]/20',
                      !isSelected && 'hover:bg-[#313244]',
                    )}
                  >
                    {/* Иконка */}
                    <Icon 
                      className={cn(
                        'w-4 h-4 flex-shrink-0',
                        result.type === 'canvas' ? 'text-[#89b4fa]' : 'text-[#f9e2af]',
                      )}
                    />
                    
                    {/* Название с подсветкой */}
                    <div className="flex-1 min-w-0">
                      <div 
                        className="text-sm text-[#cdd6f4] line-clamp-2 break-words"
                        title={result.name}
                      >
                        <HighlightedText 
                          text={result.name} 
                          matchIndices={result.matchIndices}
                        />
                      </div>
                      
                      {/* Путь */}
                      {result.path.length > 0 && (
                        <div className="text-[10px] text-[#6c7086] truncate mt-0.5">
                          {result.path.join(' / ')}
                        </div>
                      )}
                    </div>
                    
                    {/* Тип */}
                    <span className="text-[10px] text-[#6c7086] flex-shrink-0">
                      {result.type === 'canvas' ? t.sidebar.canvas : t.sidebar.folder}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-center">
              <Search className="w-8 h-8 mx-auto mb-2 text-[#6c7086]/50" />
              <p className="text-sm text-[#6c7086]">
                {t.sidebar.searchNoResults}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchInput;

