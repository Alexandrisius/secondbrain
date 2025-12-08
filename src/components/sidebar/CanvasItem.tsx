/**
 * @file CanvasItem.tsx
 * @description Компонент элемента холста в списке с контекстным меню
 * 
 * Функции:
 * - Отображение названия холста и количества нод
 * - Открытие холста по клику
 * - Drag-and-drop для перемещения
 * - Современное контекстное меню (переименовать, копировать, удалить)
 * - Мультиселект через Ctrl+Click
 * - Анимации появления и взаимодействия
 */

'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { 
  FileText,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useTranslation, format } from '@/lib/i18n';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';
import type { CanvasMeta } from '@/types/workspace';
import { cn } from '@/lib/utils';

// =============================================================================
// ТИПЫ
// =============================================================================

interface CanvasItemProps {
  /** Метаданные холста */
  canvas: CanvasMeta;
  /** Уровень вложенности для отступов */
  level: number;
  /** Задержка анимации (мс) */
  animationDelay?: number;
}

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * CanvasItem - компонент элемента холста в сайдбаре
 * Использует универсальный ContextMenu с glassmorphism эффектом
 */
export function CanvasItem({ canvas, level, animationDelay = 0 }: CanvasItemProps) {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // ===========================================================================
  // СОСТОЯНИЕ
  // ===========================================================================
  
  const {
    activeCanvasId,
    selectedIds,
    editingId,
    openCanvas,
    selectItem,
    startEditing,
    stopEditing,
    renameCanvas,
    deleteCanvas,
    duplicateCanvas,
  } = useWorkspaceStore();
  
  const isActive = activeCanvasId === canvas.id;
  const isSelected = selectedIds.includes(canvas.id);
  const isEditing = editingId === canvas.id;
  
  // Локальное состояние
  const [editValue, setEditValue] = useState(canvas.name);
  
  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Контекстное меню
  const contextMenu = useContextMenu();
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  /**
   * Фокус на input при редактировании
   */
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================
  
  /**
   * Клик по холсту - открытие
   */
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (e.ctrlKey || e.metaKey) {
      // Мультиселект
      selectItem(canvas.id, true);
    } else {
      // Открытие холста
      selectItem(canvas.id, false);
      openCanvas(canvas.id);
    }
  }, [canvas.id, selectItem, openCanvas]);
  
  /**
   * Двойной клик - начало редактирования
   */
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    startEditing(canvas.id);
    setEditValue(canvas.name);
  }, [canvas.id, canvas.name, startEditing]);
  
  /**
   * Завершение редактирования
   */
  const handleEditComplete = useCallback(() => {
    if (editValue.trim() && editValue.trim() !== canvas.name) {
      renameCanvas(canvas.id, editValue.trim());
    } else {
      setEditValue(canvas.name);
    }
    stopEditing();
  }, [canvas.id, canvas.name, editValue, renameCanvas, stopEditing]);
  
  /**
   * Обработка клавиш при редактировании
   */
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      handleEditComplete();
    } else if (e.key === 'Escape') {
      setEditValue(canvas.name);
      stopEditing();
    }
  }, [canvas.name, handleEditComplete, stopEditing]);
  
  // ===========================================================================
  // КОНТЕКСТНОЕ МЕНЮ
  // ===========================================================================
  
  /**
   * Элементы контекстного меню для холста
   */
  const contextMenuItems: ContextMenuItem[] = React.useMemo(() => [
    {
      id: 'open',
      label: t.sidebar.openInNewTab,
      icon: ExternalLink,
    },
    {
      id: 'rename',
      label: t.common.rename,
      icon: Pencil,
      dividerBefore: true,
      shortcut: 'F2',
    },
    {
      id: 'duplicate',
      label: t.common.copy,
      icon: Copy,
      shortcut: 'Ctrl+D',
    },
    {
      id: 'delete',
      label: t.common.delete,
      icon: Trash2,
      danger: true,
      dividerBefore: true,
      shortcut: 'Del',
    },
  ], [t]);
  
  /**
   * Показать контекстное меню
   */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Выбираем холст если не выбран
    if (!isSelected) {
      selectItem(canvas.id, false);
    }
    
    contextMenu.open(e);
  }, [canvas.id, isSelected, selectItem, contextMenu]);
  
  /**
   * Обработка выбора в контекстном меню
   */
  const handleContextMenuSelect = useCallback(async (action: string) => {
    switch (action) {
      case 'open':
        openCanvas(canvas.id);
        break;
        
      case 'rename':
        startEditing(canvas.id);
        setEditValue(canvas.name);
        break;
        
      case 'duplicate':
        try {
          await duplicateCanvas(canvas.id);
        } catch (error) {
          console.error('Ошибка копирования:', error);
        }
        break;
        
      case 'delete':
        if (window.confirm(format(t.sidebar.deleteCanvasConfirm, { name: canvas.name }))) {
          try {
            await deleteCanvas(canvas.id);
          } catch (error) {
            console.error('Ошибка удаления:', error);
          }
        }
        break;
    }
  }, [canvas.id, canvas.name, openCanvas, startEditing, duplicateCanvas, deleteCanvas, t]);
  
  // ===========================================================================
  // DRAG AND DROP
  // ===========================================================================
  
  /**
   * Начало перетаскивания
   */
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      id: canvas.id,
      type: 'canvas',
      parentId: canvas.folderId,
    }));
    e.dataTransfer.effectAllowed = 'move';
  }, [canvas.id, canvas.folderId]);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  return (
    <>
      <div
        className={cn(
          'group flex items-center gap-2',
          'min-h-[32px] py-1.5 px-2 mx-1.5 rounded-lg',
          'cursor-pointer select-none',
          'transition-all duration-150',
          // Активный холст - gradient accent
          isActive && [
            'bg-gradient-to-r from-[#89b4fa]/25 to-[#89b4fa]/10',
            'border-l-2 border-[#89b4fa]',
            'shadow-sm shadow-[#89b4fa]/10',
          ],
          // Выбранный (но не активный)
          !isActive && isSelected && 'bg-[#45475a]/80 shadow-sm',
          // Обычное состояние
          !isActive && !isSelected && 'hover:bg-[#313244]/60',
          // Анимация появления
          'animate-in fade-in-0 slide-in-from-left-2 duration-200',
        )}
        style={{ 
          paddingLeft: `${8 + level * 16 + 20}px`,
          animationDelay: `${animationDelay}ms`,
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable={!isEditing}
        onDragStart={handleDragStart}
      >
        {/* Иконка холста */}
        <FileText 
          className={cn(
            'w-4 h-4 flex-shrink-0 transition-colors duration-150',
            isActive ? 'text-[#89b4fa] drop-shadow-sm' : 'text-[#6c7086]',
          )} 
        />
        
        {/* Название */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditComplete}
            onKeyDown={handleEditKeyDown}
            className={cn(
              'flex-1 px-2 py-1 text-xs',
              'bg-[#181825] border border-[#89b4fa]',
              'text-[#cdd6f4] rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-[#89b4fa]/30',
            )}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span 
            className={cn(
              'flex-1 text-xs transition-colors duration-150',
              // Показываем до 2 строк с многоточием
              'line-clamp-2 break-words',
              isActive ? 'text-[#cdd6f4] font-semibold' : 'text-[#a6adc8]',
            )}
            title={canvas.name}
          >
            {canvas.name}
          </span>
        )}
        
        {/* Количество нод (опционально) */}
        {!isEditing && canvas.nodesCount !== undefined && canvas.nodesCount > 1 && (
          <span className={cn(
            'px-1.5 py-0.5 rounded-full',
            'text-[10px] font-medium',
            'bg-[#313244] text-[#6c7086]',
            'opacity-60 group-hover:opacity-100',
            'transition-opacity duration-150',
          )}>
            {canvas.nodesCount}
          </span>
        )}
        
        {/* Кнопка меню */}
        {!isEditing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleContextMenu(e);
            }}
            className={cn(
              'p-1 rounded-md',
              'opacity-0 group-hover:opacity-100',
              'text-[#6c7086] hover:text-[#cdd6f4]',
              'hover:bg-[#45475a]',
              'transition-all duration-150',
            )}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      
      {/* Контекстное меню - preferLeft чтобы не вылезало за границы сайдбара */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={contextMenuItems}
        onSelect={handleContextMenuSelect}
        onClose={contextMenu.close}
        preferLeft={true}
      />
    </>
  );
}

export default CanvasItem;
