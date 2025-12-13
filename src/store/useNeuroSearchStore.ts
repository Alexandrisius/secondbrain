/**
 * @file useNeuroSearchStore.ts
 * @description Store for managing ephemeral NeuroSearch state and results
 * 
 * Хранит состояние нейропоиска для каждой карточки:
 * - Результаты поиска (найденные карточки)
 * - Временные метки обновления
 * - Снимки состояния подключённых карточек для отслеживания устаревания
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SearchResult } from '@/types/embeddings';

interface NeuroSearchState {
  /**
   * Search results keyed by node ID.
   * Allows multiple nodes to have their own search context independently.
   */
  results: Record<string, SearchResult[]>;

  /**
   * Timestamp when the search results were last updated for a node.
   * Used to detect if results might be stale.
   */
  resultsUpdatedAt: Record<string, number>;

  /**
   * Снимок состояния подключённых карточек на момент поиска
   * 
   * Ключ: nodeId целевой карточки (где был произведён поиск)
   * Значение: Record<sourceNodeId, updatedAt> - updatedAt каждой найденной карточки
   * 
   * Используется для определения устаревания:
   * - Если текущий updatedAt любой подключённой карточки > сохранённого снимка
   * - Значит контекст устарел и кнопка мозга становится оранжевой
   */
  sourceNodesSnapshot: Record<string, Record<string, number>>;

  /**
   * Flag indicating if a search is currently in progress for a specific node
   */
  isSearching: Record<string, boolean>;

  /**
   * Set search results for a specific node
   * @param nodeId - ID целевой карточки
   * @param results - результаты поиска
   * @param sourceNodesUpdatedAt - опциональный снимок updatedAt подключённых карточек
   */
  setResults: (
    nodeId: string, 
    results: SearchResult[], 
    sourceNodesUpdatedAt?: Record<string, number>
  ) => void;

  /**
   * Clear search results for a specific node
   */
  clearResults: (nodeId: string) => void;

  /**
   * Set searching status for a node
   */
  setIsSearching: (nodeId: string, isSearching: boolean) => void;
  
  /**
   * Clear all results (e.g., on canvas clear)
   */
  clearAll: () => void;

  /**
   * Получить снимок состояния подключённых карточек для целевой ноды
   * @param nodeId - ID целевой карточки
   * @returns Record<sourceNodeId, updatedAt> или пустой объект
   */
  getSourceNodesSnapshot: (nodeId: string) => Record<string, number>;

  /**
   * Очистить результаты поиска, связанные с удалённым холстом
   * 
   * Удаляет из всех массивов результатов поиска те элементы,
   * которые ссылаются на удалённый холст (по canvasId).
   * Также очищает соответствующие снимки состояния.
   * 
   * @param canvasId - ID удалённого холста
   */
  clearResultsForCanvas: (canvasId: string) => void;
}

export const useNeuroSearchStore = create<NeuroSearchState>()(
  persist(
    (set, get) => ({
      // === СОСТОЯНИЕ ===
      results: {},
      resultsUpdatedAt: {},
      sourceNodesSnapshot: {},
      isSearching: {},

      // === МЕТОДЫ ===

      /**
       * Установить результаты поиска для карточки
       * 
       * @param nodeId - ID целевой карточки
       * @param results - массив результатов поиска
       * @param sourceNodesUpdatedAt - снимок updatedAt подключённых карточек
       */
      setResults: (nodeId, results, sourceNodesUpdatedAt) =>
        set((state) => ({
          results: { ...state.results, [nodeId]: results },
          resultsUpdatedAt: { ...state.resultsUpdatedAt, [nodeId]: Date.now() },
          // Сохраняем снимок состояния подключённых карточек
          // Если снимок не передан - создаём пустой объект
          sourceNodesSnapshot: { 
            ...state.sourceNodesSnapshot, 
            [nodeId]: sourceNodesUpdatedAt || {} 
          },
        })),

      /**
       * Очистить результаты поиска для карточки
       */
      clearResults: (nodeId) =>
        set((state) => {
          const newResults = { ...state.results };
          const newUpdatedAt = { ...state.resultsUpdatedAt };
          const newSnapshot = { ...state.sourceNodesSnapshot };
          
          delete newResults[nodeId];
          delete newUpdatedAt[nodeId];
          delete newSnapshot[nodeId];
          
          return { 
            results: newResults, 
            resultsUpdatedAt: newUpdatedAt,
            sourceNodesSnapshot: newSnapshot,
          };
        }),

      /**
       * Установить статус поиска
       */
      setIsSearching: (nodeId, isSearching) =>
        set((state) => ({
          isSearching: { ...state.isSearching, [nodeId]: isSearching },
        })),

      /**
       * Очистить все результаты (при очистке холста)
       */
      clearAll: () => set({ 
        results: {}, 
        isSearching: {}, 
        resultsUpdatedAt: {},
        sourceNodesSnapshot: {},
      }),

      /**
       * Получить снимок состояния подключённых карточек
       */
      getSourceNodesSnapshot: (nodeId) => {
        const state = get();
        return state.sourceNodesSnapshot[nodeId] || {};
      },

      /**
       * Очистить результаты поиска, связанные с удалённым холстом
       * 
       * Проходит по всем сохранённым результатам поиска и:
       * 1. Удаляет результаты, которые ссылаются на удалённый холст (по canvasId)
       * 2. Очищает соответствующие снимки состояния
       * 
       * Это предотвращает появление "призраков" в кэше поиска
       * при переходе к удалённым карточкам.
       * 
       * @param canvasId - ID удалённого холста
       */
      clearResultsForCanvas: (canvasId) =>
        set((state) => {
          const newResults: Record<string, typeof state.results[string]> = {};
          const newUpdatedAt: Record<string, number> = {};
          const newSnapshot: Record<string, Record<string, number>> = {};
          
          // Проходим по всем записям результатов поиска
          for (const [nodeId, results] of Object.entries(state.results)) {
            // Фильтруем результаты, оставляя только те, что не принадлежат удалённому холсту
            const filteredResults = results.filter(
              (result) => result.canvasId !== canvasId
            );
            
            // Если после фильтрации остались результаты - сохраняем их
            if (filteredResults.length > 0) {
              newResults[nodeId] = filteredResults;
              
              // Сохраняем timestamp если был
              if (state.resultsUpdatedAt[nodeId]) {
                newUpdatedAt[nodeId] = state.resultsUpdatedAt[nodeId];
              }
              
              // Обновляем снимок состояния, удаляя записи для удалённого холста
              if (state.sourceNodesSnapshot[nodeId]) {
                const filteredSnapshot: Record<string, number> = {};
                for (const [sourceNodeId, updatedAt] of Object.entries(state.sourceNodesSnapshot[nodeId])) {
                  // Оставляем только те записи, которые ещё есть в отфильтрованных результатах
                  if (filteredResults.some(r => r.nodeId === sourceNodeId)) {
                    filteredSnapshot[sourceNodeId] = updatedAt;
                  }
                }
                if (Object.keys(filteredSnapshot).length > 0) {
                  newSnapshot[nodeId] = filteredSnapshot;
                }
              }
            }
          }
          
          console.log(`[NeuroSearchStore] Очищены результаты поиска для холста ${canvasId}`);
          
          return {
            results: newResults,
            resultsUpdatedAt: newUpdatedAt,
            sourceNodesSnapshot: newSnapshot,
          };
        }),
    }),
    {
      name: 'neuro-search-storage', // unique name for localStorage
      storage: createJSONStorage(() => localStorage),
      // Persist results, timestamps, and snapshots (not loading state)
      partialize: (state) => ({ 
        results: state.results, 
        resultsUpdatedAt: state.resultsUpdatedAt,
        sourceNodesSnapshot: state.sourceNodesSnapshot,
      }),
    }
  )
);
