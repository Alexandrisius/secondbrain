/**
 * @file useReadingModeStore.ts
 * @description Zustand store для управления режимом полноэкранного чтения карточек
 * 
 * Reading Mode позволяет просматривать карточки в полноэкранном режиме
 * с навигацией по графу (родители/потомки) как при чтении интерактивной книги.
 * 
 * ОСНОВНЫЕ ВОЗМОЖНОСТИ:
 * - Полноэкранный просмотр одной карточки
 * - Навигация к родителям (←) и потомкам (→)
 * - История просмотра для возврата назад (Backspace)
 * - Анимированные переходы между карточками
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Направление навигации - используется для анимаций переходов
 * - 'left' - переход к родителю (карточка уходит вправо)
 * - 'right' - переход к потомку (карточка уходит влево)
 * - null - начальное состояние или прямой переход
 */
export type NavigationDirection = 'left' | 'right' | null;

/**
 * Состояние режима чтения
 */
export interface ReadingModeState {
  /** Флаг: открыт ли режим чтения */
  isOpen: boolean;
  
  /** ID текущей отображаемой карточки */
  currentNodeId: string | null;
  
  /** 
   * История просмотренных карточек (массив ID)
   * Используется для навигации назад по Backspace
   * Последний элемент - предыдущая карточка
   */
  history: string[];
  
  /** 
   * Направление последнего перехода
   * Используется для определения направления анимации
   */
  direction: NavigationDirection;
  
  /**
   * Флаг: показан ли sidebar для выбора карточки при множественных связях
   * - 'parents' - показан sidebar с родителями
   * - 'children' - показан sidebar с потомками
   * - null - sidebar скрыт
   */
  selectorSidebar: 'parents' | 'children' | null;
  
  /**
   * Флаг: идёт ли анимация перехода
   * Используется для предотвращения быстрых повторных нажатий
   */
  isAnimating: boolean;
}

/**
 * Экшены для управления режимом чтения
 */
export interface ReadingModeActions {
  /**
   * Открыть режим чтения для указанной карточки
   * @param nodeId - ID карточки для просмотра
   */
  openReadingMode: (nodeId: string) => void;
  
  /**
   * Закрыть режим чтения
   */
  closeReadingMode: () => void;
  
  /**
   * Перейти к указанной карточке
   * @param nodeId - ID целевой карточки
   * @param direction - направление перехода для анимации
   * @param addToHistory - добавлять ли текущую карточку в историю (default: true)
   */
  navigateToNode: (nodeId: string, direction: NavigationDirection, addToHistory?: boolean) => void;
  
  /**
   * Вернуться к предыдущей карточке из истории (Backspace)
   * @returns true если переход выполнен, false если история пуста
   */
  goBack: () => boolean;
  
  /**
   * Показать/скрыть sidebar для выбора карточки
   * @param type - тип sidebar ('parents', 'children') или null для скрытия
   */
  setSelectorSidebar: (type: 'parents' | 'children' | null) => void;
  
  /**
   * Установить флаг анимации
   * @param isAnimating - идёт ли анимация
   */
  setIsAnimating: (isAnimating: boolean) => void;
  
  /**
   * Сбросить состояние к начальному
   */
  reset: () => void;
}

/**
 * Полный тип store
 */
export type ReadingModeStore = ReadingModeState & ReadingModeActions;

// =============================================================================
// НАЧАЛЬНОЕ СОСТОЯНИЕ
// =============================================================================

const initialState: ReadingModeState = {
  isOpen: false,
  currentNodeId: null,
  history: [],
  direction: null,
  selectorSidebar: null,
  isAnimating: false,
};

// =============================================================================
// STORE
// =============================================================================

/**
 * Zustand store для режима чтения
 * 
 * Использует Immer для иммутабельных обновлений вложенных структур.
 * 
 * @example
 * ```tsx
 * const { isOpen, openReadingMode, closeReadingMode } = useReadingModeStore();
 * 
 * // Открыть режим чтения
 * openReadingMode('node-123');
 * 
 * // Перейти к потомку
 * navigateToNode('node-456', 'right');
 * 
 * // Вернуться назад
 * goBack();
 * ```
 */
export const useReadingModeStore = create<ReadingModeStore>()(
  immer((set, get) => ({
    // =========================================================================
    // СОСТОЯНИЕ
    // =========================================================================
    ...initialState,
    
    // =========================================================================
    // ЭКШЕНЫ
    // =========================================================================
    
    /**
     * Открыть режим чтения для указанной карточки
     * 
     * Сбрасывает историю и направление при открытии.
     * Блокирует scroll на body для предотвращения прокрутки фона.
     */
    openReadingMode: (nodeId: string) => {
      set((state) => {
        state.isOpen = true;
        state.currentNodeId = nodeId;
        state.history = [];
        state.direction = null;
        state.selectorSidebar = null;
        state.isAnimating = false;
      });
      
      // Блокируем scroll на body
      document.body.style.overflow = 'hidden';
      
      console.log('[ReadingMode] Открыт для карточки:', nodeId);
    },
    
    /**
     * Закрыть режим чтения
     * 
     * Восстанавливает scroll на body.
     */
    closeReadingMode: () => {
      set((state) => {
        state.isOpen = false;
        state.selectorSidebar = null;
        state.isAnimating = false;
        // Не сбрасываем currentNodeId и history - может понадобиться для анимации выхода
      });
      
      // Восстанавливаем scroll на body
      document.body.style.overflow = '';
      
      console.log('[ReadingMode] Закрыт');
    },
    
    /**
     * Перейти к указанной карточке
     * 
     * Добавляет текущую карточку в историю (если addToHistory = true),
     * устанавливает направление для анимации.
     */
    navigateToNode: (nodeId: string, direction: NavigationDirection, addToHistory = true) => {
      const { currentNodeId, isAnimating } = get();
      
      // Предотвращаем навигацию во время анимации
      if (isAnimating) {
        console.log('[ReadingMode] Навигация заблокирована: идёт анимация');
        return;
      }
      
      // Проверяем что это не та же карточка
      if (nodeId === currentNodeId) {
        console.log('[ReadingMode] Навигация к той же карточке - пропускаем');
        return;
      }
      
      set((state) => {
        // Добавляем текущую карточку в историю
        if (addToHistory && state.currentNodeId) {
          state.history.push(state.currentNodeId);
          
          // Ограничиваем размер истории (максимум 50 записей)
          if (state.history.length > 50) {
            state.history.shift();
          }
        }
        
        state.currentNodeId = nodeId;
        state.direction = direction;
        state.selectorSidebar = null; // Закрываем sidebar при навигации
        state.isAnimating = true; // Начинаем анимацию
      });
      
      console.log('[ReadingMode] Переход к карточке:', nodeId, 'направление:', direction);
    },
    
    /**
     * Вернуться к предыдущей карточке из истории
     * 
     * Использует направление 'left' для анимации "всплытия" обратно.
     */
    goBack: () => {
      const { history, isAnimating } = get();
      
      // Предотвращаем навигацию во время анимации
      if (isAnimating) {
        console.log('[ReadingMode] GoBack заблокирован: идёт анимация');
        return false;
      }
      
      // Проверяем что история не пуста
      if (history.length === 0) {
        console.log('[ReadingMode] GoBack: история пуста');
        return false;
      }
      
      set((state) => {
        // Извлекаем последнюю карточку из истории
        const previousNodeId = state.history.pop();
        
        if (previousNodeId) {
          state.currentNodeId = previousNodeId;
          state.direction = 'left'; // Анимация "всплытия" назад
          state.selectorSidebar = null;
          state.isAnimating = true;
        }
      });
      
      console.log('[ReadingMode] GoBack: возврат к предыдущей карточке');
      return true;
    },
    
    /**
     * Показать/скрыть sidebar для выбора карточки
     */
    setSelectorSidebar: (type: 'parents' | 'children' | null) => {
      set((state) => {
        state.selectorSidebar = type;
      });
    },
    
    /**
     * Установить флаг анимации
     * 
     * Вызывается после завершения анимации перехода.
     */
    setIsAnimating: (isAnimating: boolean) => {
      set((state) => {
        state.isAnimating = isAnimating;
      });
    },
    
    /**
     * Сбросить состояние к начальному
     */
    reset: () => {
      set(() => initialState);
      document.body.style.overflow = '';
    },
  }))
);

// =============================================================================
// СЕЛЕКТОРЫ (для оптимизации ре-рендеров)
// =============================================================================

/**
 * Селектор: открыт ли режим чтения
 */
export const selectIsOpen = (state: ReadingModeStore) => state.isOpen;

/**
 * Селектор: ID текущей карточки
 */
export const selectCurrentNodeId = (state: ReadingModeStore) => state.currentNodeId;

/**
 * Селектор: направление анимации
 */
export const selectDirection = (state: ReadingModeStore) => state.direction;

/**
 * Селектор: есть ли история для возврата
 */
export const selectCanGoBack = (state: ReadingModeStore) => state.history.length > 0;

/**
 * Селектор: тип открытого sidebar
 */
export const selectSelectorSidebar = (state: ReadingModeStore) => state.selectorSidebar;

/**
 * Селектор: идёт ли анимация
 */
export const selectIsAnimating = (state: ReadingModeStore) => state.isAnimating;

