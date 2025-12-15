/**
 * @file ContextMenu.tsx
 * @description Универсальный компонент контекстного меню с современным дизайном
 * 
 * Функции:
 * - Анимации появления/скрытия (fade + scale)
 * - Keyboard navigation (стрелки, Enter, Escape)
 * - Автопозиционирование относительно viewport
 * - Поддержка иконок, разделителей, состояния danger
 * - Glassmorphism эффект
 * - Закрытие при клике вне области
 * - React Portal для рендеринга вне DOM-иерархии (избегает overflow clipping)
 * - Поддержка preferLeft для открытия меню слева от точки клика
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Элемент контекстного меню
 */
export interface ContextMenuItem {
  /** Уникальный идентификатор действия */
  id: string;
  /** Отображаемый текст */
  label: string;
  /** Иконка (компонент lucide-react) */
  icon?: LucideIcon;
  /** Элемент опасный (красный цвет) */
  danger?: boolean;
  /** Элемент отключен */
  disabled?: boolean;
  /** Разделитель перед элементом */
  dividerBefore?: boolean;
  /** Клавиатурное сокращение (для отображения) */
  shortcut?: string;
}

/**
 * Props компонента ContextMenu
 */
interface ContextMenuProps {
  /** Показать меню */
  isOpen: boolean;
  /** Позиция меню (координаты клика) */
  position: { x: number; y: number };
  /** Элементы меню */
  items: ContextMenuItem[];
  /** Callback при выборе элемента */
  onSelect: (itemId: string) => void;
  /** Callback при закрытии меню */
  onClose: () => void;
  /** Минимальная ширина меню */
  minWidth?: number;
  /** Предпочтительное открытие слева от точки клика (для кнопок у правого края) */
  preferLeft?: boolean;
  /** Предпочтительное открытие сверху от точки клика */
  preferTop?: boolean;
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/** Минимальная ширина меню по умолчанию */
const DEFAULT_MIN_WIDTH = 180;

/** Отступ от края viewport */
const VIEWPORT_PADDING = 8;

/** Длительность анимации (мс) */
const ANIMATION_DURATION = 150;

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * ContextMenu - универсальный компонент контекстного меню
 * 
 * Использует glassmorphism эффект, поддерживает keyboard navigation
 * и автоматически позиционируется относительно viewport
 */
export function ContextMenu({
  isOpen,
  position,
  items,
  onSelect,
  onClose,
  minWidth = DEFAULT_MIN_WIDTH,
  preferLeft = false,
  preferTop = false,
}: ContextMenuProps) {
  // ===========================================================================
  // СОСТОЯНИЕ
  // ===========================================================================
  
  /** Реф на контейнер меню */
  const menuRef = useRef<HTMLDivElement>(null);
  
  /** Индекс выбранного элемента для keyboard navigation */
  const [focusedIndex, setFocusedIndex] = useState(-1);
  
  /** Скорректированная позиция меню */
  const [adjustedPosition, setAdjustedPosition] = useState({ x: 0, y: 0 });
  
  /** Состояние анимации (для плавного закрытия) */
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  
  /** Флаг монтирования на клиенте (для Portal) */
  const [isMounted, setIsMounted] = useState(false);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  /**
   * Устанавливаем флаг монтирования для Portal (SSR совместимость)
   */
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  /**
   * Управление анимацией появления/скрытия
   */
  useEffect(() => {
    if (isOpen) {
      // Устанавливаем начальную позицию с учётом preferLeft/preferTop
      // Используем minWidth как приблизительную ширину меню до измерения
      // Это предотвращает "прыжок" меню при первом открытии
      const initialX = preferLeft ? position.x - minWidth : position.x;
      const initialY = position.y;
      setAdjustedPosition({ x: initialX, y: initialY });
      
      // Показываем меню
      setIsVisible(true);
      setIsAnimating(true);
      
      // Сброс фокуса
      setFocusedIndex(-1);
      
      // Запускаем анимацию появления
      requestAnimationFrame(() => {
        setIsAnimating(false);
      });
    } else if (isVisible) {
      // Запускаем анимацию скрытия
      setIsAnimating(true);
      
      // Скрываем после завершения анимации
      const timer = setTimeout(() => {
        setIsVisible(false);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
      
      return () => clearTimeout(timer);
    }
  }, [isOpen, isVisible, position, preferLeft, minWidth]);
  
  /**
   * Автопозиционирование меню относительно viewport (корректировка после рендера)
   * Учитывает preferLeft и preferTop для правильного отображения у границ сайдбара
   */
  React.useLayoutEffect(() => {
    if (!isOpen || !isVisible || !menuRef.current) return;
    
    // Измеряем реальные размеры меню
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const { x, y } = position;
    
    // 1. Determine preferred position based on props
    // Используем реальную ширину меню (rect.width) вместо minWidth
    let finalX = preferLeft ? x - rect.width : x;
    let finalY = preferTop ? y - rect.height : y;

    // 2. Intelligent flip if preferred position doesn't fit
    // Horizontal flip
    if (preferLeft) {
      // If preferred left doesn't fit (left edge < padding), try right
      if (finalX < VIEWPORT_PADDING) {
         // Check if right side fits better
         if (x + rect.width <= viewportWidth - VIEWPORT_PADDING) {
           finalX = x;
         }
      }
    } else {
      // If preferred right doesn't fit (right edge > viewport), try left
      if (finalX + rect.width > viewportWidth - VIEWPORT_PADDING) {
         // Check if left side fits better
         if (x - rect.width >= VIEWPORT_PADDING) {
           finalX = x - rect.width;
         }
      }
    }

    // Vertical flip
    if (preferTop) {
       if (finalY < VIEWPORT_PADDING) {
          if (y + rect.height <= viewportHeight - VIEWPORT_PADDING) {
             finalY = y;
          }
       }
    } else {
       if (finalY + rect.height > viewportHeight - VIEWPORT_PADDING) {
          if (y - rect.height >= VIEWPORT_PADDING) {
             finalY = y - rect.height;
          }
       }
    }

    // 3. Hard Clamp to Viewport (Safety Net)
    // This ensures the menu is ALWAYS fully visible, even if it overlaps the cursor/trigger
    const maxX = viewportWidth - rect.width - VIEWPORT_PADDING;
    const maxY = viewportHeight - rect.height - VIEWPORT_PADDING;

    finalX = Math.max(VIEWPORT_PADDING, Math.min(finalX, maxX));
    finalY = Math.max(VIEWPORT_PADDING, Math.min(finalY, maxY));
    
    setAdjustedPosition({ x: finalX, y: finalY });
  }, [isOpen, isVisible, position, preferLeft, preferTop]);
  
  /**
   * Закрытие при клике вне меню
   */
  useEffect(() => {
    if (!isOpen) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    
    // Используем capture фазу для перехвата клика до других обработчиков
    document.addEventListener('mousedown', handleClickOutside, true);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen, onClose]);
  
  /**
   * Keyboard navigation
   */
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Получаем индексы только активных элементов (не disabled)
      const activeIndices = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.disabled)
        .map(({ index }) => index);
      
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
          
        case 'ArrowDown':
          e.preventDefault();
          if (activeIndices.length > 0) {
            // Находим следующий активный элемент
            const currentActiveIndex = activeIndices.indexOf(focusedIndex);
            const nextIndex = currentActiveIndex < activeIndices.length - 1
              ? activeIndices[currentActiveIndex + 1]
              : activeIndices[0];
            setFocusedIndex(nextIndex);
          }
          break;
          
        case 'ArrowUp':
          e.preventDefault();
          if (activeIndices.length > 0) {
            // Находим предыдущий активный элемент
            const currentActiveIndex = activeIndices.indexOf(focusedIndex);
            const prevIndex = currentActiveIndex > 0
              ? activeIndices[currentActiveIndex - 1]
              : activeIndices[activeIndices.length - 1];
            setFocusedIndex(prevIndex);
          }
          break;
          
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (focusedIndex >= 0 && !items[focusedIndex]?.disabled) {
            onSelect(items[focusedIndex].id);
            onClose();
          }
          break;
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, items, focusedIndex, onSelect, onClose]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================
  
  /**
   * Клик по элементу меню
   */
  const handleItemClick = useCallback((item: ContextMenuItem) => {
    if (item.disabled) return;
    
    onSelect(item.id);
    onClose();
  }, [onSelect, onClose]);
  
  /**
   * Наведение на элемент меню
   */
  const handleItemMouseEnter = useCallback((index: number) => {
    if (!items[index].disabled) {
      setFocusedIndex(index);
    }
  }, [items]);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  // Не рендерим если меню полностью скрыто или компонент не смонтирован (SSR)
  if (!isVisible || !isMounted) return null;
  
  // Контент меню (рендерится через Portal в body)
  const menuContent = (
    <div
      ref={menuRef}
      className={cn(
        // Позиционирование - fixed для отвязки от родительских overflow
        'fixed z-[99999]',
        // Glassmorphism эффект
        'bg-[#1e1e2e]/95 backdrop-blur-xl',
        // Граница и тень
        'border border-[#313244]/80',
        'shadow-2xl shadow-black/40',
        // Скругление
        'rounded-xl overflow-hidden',
        // Анимация
        'transition-all duration-150 ease-out',
        // Origin зависит от направления открытия
        preferLeft && preferTop && 'origin-bottom-right',
        preferLeft && !preferTop && 'origin-top-right',
        !preferLeft && preferTop && 'origin-bottom-left',
        !preferLeft && !preferTop && 'origin-top-left',
        // Состояния анимации
        isAnimating && !isOpen && 'opacity-0 scale-95 pointer-events-none',
        isAnimating && isOpen && 'opacity-0 scale-95',
        !isAnimating && isOpen && 'opacity-100 scale-100',
      )}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        minWidth,
      }}
      role="menu"
      aria-orientation="vertical"
    >
      {/* Gradient overlay для глубины */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />
      
      {/* Элементы меню */}
      <div className="py-1.5 relative">
        {items.map((item, index) => {
          const Icon = item.icon;
          const isFocused = focusedIndex === index;
          
          return (
            <React.Fragment key={item.id}>
              {/* Разделитель перед элементом */}
              {item.dividerBefore && index > 0 && (
                <div className="h-px mx-2 my-1.5 bg-gradient-to-r from-transparent via-[#45475a] to-transparent" />
              )}
              
              {/* Элемент меню */}
              <button
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => handleItemMouseEnter(index)}
                disabled={item.disabled}
                className={cn(
                  // Базовые стили
                  'w-full flex items-center gap-3',
                  'px-3 py-2 mx-1.5',
                  'text-left text-sm',
                  'rounded-lg',
                  'transition-all duration-100',
                  // Ширина с учётом margin
                  'w-[calc(100%-12px)]',
                  // Состояние focus/hover
                  isFocused && !item.disabled && !item.danger && 'bg-[#89b4fa]/20 text-[#cdd6f4]',
                  isFocused && !item.disabled && item.danger && 'bg-[#f38ba8]/20 text-[#f38ba8]',
                  // Обычное состояние
                  !isFocused && !item.danger && 'text-[#cdd6f4] hover:bg-[#313244]',
                  !isFocused && item.danger && 'text-[#f38ba8] hover:bg-[#f38ba8]/10',
                  // Disabled состояние
                  item.disabled && 'opacity-40 cursor-not-allowed',
                )}
                role="menuitem"
                tabIndex={-1}
              >
                {/* Иконка */}
                {Icon && (
                  <Icon 
                    className={cn(
                      'w-4 h-4 flex-shrink-0',
                      item.danger ? 'text-[#f38ba8]' : 'text-[#6c7086]',
                      isFocused && !item.disabled && !item.danger && 'text-[#89b4fa]',
                    )}
                  />
                )}
                
                {/* Текст */}
                <span className="flex-1 truncate">
                  {item.label}
                </span>
                
                {/* Keyboard shortcut */}
                {item.shortcut && (
                  <span className="ml-2 text-xs text-[#6c7086]/60">
                    {item.shortcut}
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
  
  // Используем Portal для рендеринга в body - избегаем overflow clipping родителей
  return createPortal(menuContent, document.body);
}

// ... (hook left as is) ...
export function useContextMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  /**
   * Открыть контекстное меню
   */
  const open = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setPosition({ x: e.clientX, y: e.clientY });
    setIsOpen(true);
  }, []);
  
  /**
   * Закрыть контекстное меню
   */
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);
  
  return {
    isOpen,
    position,
    open,
    close,
  };
}

export default ContextMenu;
