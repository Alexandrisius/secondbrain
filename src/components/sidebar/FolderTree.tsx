/**
 * @file FolderTree.tsx
 * @description Древовидная структура папок и холстов с поддержкой drag-and-drop
 * 
 * Функции:
 * - Рекурсивное отображение папок и холстов
 * - Drag-and-drop для перемещения
 * - Полноценное контекстное меню для папок
 * - Мультиселект через Ctrl+Click
 * - Раскрытие/сворачивание папок
 * - Индикатор количества элементов в папке
 * - Современный дизайн с анимациями
 */

'use client';

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { 
  ChevronDown,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
  Plus,
  FolderPlus,
  MoreHorizontal,
} from 'lucide-react';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useTranslation, format } from '@/lib/i18n';
import { CanvasItem } from './CanvasItem';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';
import { cn } from '@/lib/utils';

// =============================================================================
// ТИПЫ
// =============================================================================

interface FolderTreeProps {
  /** ID родительской папки (null для корня) */
  parentId: string | null;
  /** Уровень вложенности для отступов */
  level: number;
}

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * FolderTree - рекурсивный компонент для отображения дерева папок
 * 
 * Отображает:
 * - Подпапки текущего уровня
 * - Холсты в текущей папке
 * - Поддержка drag-and-drop
 */
export function FolderTree({ parentId, level }: FolderTreeProps) {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // ===========================================================================
  // СОСТОЯНИЕ
  // ===========================================================================
  
  // Получаем данные напрямую для избежания бесконечных ре-рендеров
  const allFolders = useWorkspaceStore((s) => s.folders);
  const allCanvases = useWorkspaceStore((s) => s.canvases);
  const setDragOver = useWorkspaceStore((s) => s.setDragOver);
  const moveCanvas = useWorkspaceStore((s) => s.moveCanvas);
  const moveFolder = useWorkspaceStore((s) => s.moveFolder);
  
  // Мемоизируем фильтрованные списки
  const folders = React.useMemo(() => 
    allFolders
      .filter(f => f.parentId === parentId)
      .sort((a, b) => a.order - b.order),
    [allFolders, parentId]
  );
  
  const canvases = React.useMemo(() =>
    allCanvases
      .filter(c => c.folderId === parentId)
      .sort((a, b) => a.order - b.order),
    [allCanvases, parentId]
  );
  
  // Локальное состояние для drag
  const [isDragOver, setIsDragOver] = useState(false);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ DRAG AND DROP
  // ===========================================================================
  
  /**
   * Обработчик dragOver для корневой зоны
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Показываем индикатор только для корня
    if (parentId === null) {
      setIsDragOver(true);
      setDragOver('root', 'root');
    }
  }, [parentId, setDragOver]);
  
  /**
   * Обработчик dragLeave
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragOver(null, null);
  }, [setDragOver]);
  
  /**
   * Обработчик drop для корневой зоны
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragOver(null, null);
    
    // Получаем данные о перетаскиваемом элементе
    const dataStr = e.dataTransfer.getData('application/json');
    if (!dataStr) return;
    
    try {
      const data = JSON.parse(dataStr);
      
      // Перемещаем в корень
      if (data.type === 'canvas') {
        moveCanvas(data.id, null);
      } else if (data.type === 'folder') {
        moveFolder(data.id, null);
      }
    } catch (error) {
      console.error('Ошибка при drop:', error);
    }
  }, [setDragOver, moveCanvas, moveFolder]);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  // Если нет содержимого
  if (folders.length === 0 && canvases.length === 0) {
    if (parentId === null) {
      // Корневой уровень пустой
      return (
        <div 
          className={cn(
            'px-3 py-6 text-center',
            'transition-all duration-200',
            isDragOver && 'bg-[#89b4fa]/10 border-2 border-dashed border-[#89b4fa]/30 rounded-xl mx-2',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Folder className="w-10 h-10 mx-auto mb-3 text-[#6c7086]/30" />
          <p className="text-xs text-[#6c7086]">{t.sidebar.noCanvases}</p>
          <p className="mt-1 text-[10px] text-[#6c7086]/60">
            {t.sidebar.createHint}
          </p>
        </div>
      );
    }
    return null;
  }
  
  return (
    <div
      className={cn(
        // Индикатор drop zone для корня
        parentId === null && isDragOver && 'bg-[#89b4fa]/5 rounded-lg',
        // Анимация появления списка
        'animate-in fade-in-0 duration-200',
      )}
      onDragOver={parentId === null ? handleDragOver : undefined}
      onDragLeave={parentId === null ? handleDragLeave : undefined}
      onDrop={parentId === null ? handleDrop : undefined}
    >
      {/* Папки */}
      {folders.map((folder, index) => (
        <FolderItem 
          key={folder.id} 
          folder={folder} 
          level={level}
          animationDelay={index * 30}
        />
      ))}
      
      {/* Холсты */}
      {canvases.map((canvas, index) => (
        <CanvasItem 
          key={canvas.id} 
          canvas={canvas} 
          level={level}
          animationDelay={(folders.length + index) * 30}
        />
      ))}
    </div>
  );
}

// =============================================================================
// FOLDER ITEM КОМПОНЕНТ
// =============================================================================

interface FolderItemProps {
  folder: import('@/types/workspace').Folder;
  level: number;
  animationDelay?: number;
}

/**
 * FolderItem - компонент отдельной папки с полноценным контекстным меню
 */
export function FolderItem({ folder, level, animationDelay = 0 }: FolderItemProps) {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // ===========================================================================
  // СОСТОЯНИЕ
  // ===========================================================================
  
  const {
    selectedIds,
    editingId,
    dragOverId,
    toggleFolderExpanded,
    selectItem,
    startEditing,
    stopEditing,
    renameFolder,
    deleteFolder,
    createCanvas,
    createFolder,
    setDragOver,
    moveCanvas,
    moveFolder,
  } = useWorkspaceStore();
  
  // Подсчёт элементов в папке
  const allFolders = useWorkspaceStore((s) => s.folders);
  const allCanvases = useWorkspaceStore((s) => s.canvases);
  
  const itemsCount = React.useMemo(() => {
    const foldersCount = allFolders.filter(f => f.parentId === folder.id).length;
    const canvasesCount = allCanvases.filter(c => c.folderId === folder.id).length;
    return foldersCount + canvasesCount;
  }, [allFolders, allCanvases, folder.id]);
  
  const isSelected = selectedIds.includes(folder.id);
  const isEditing = editingId === folder.id;
  const isDragOver = dragOverId === folder.id;
  
  // Локальное состояние для редактирования
  const [editValue, setEditValue] = useState(folder.name);
  
  // Ref для input
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
   * Клик по папке - выбор + сворачивание/разворачивание
   */
  const handleClickWithToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click для мультиселекта (без toggle)
      selectItem(folder.id, true);
    } else {
      // Обычный клик - выбираем и toggle
      selectItem(folder.id, false);
      toggleFolderExpanded(folder.id);
    }
  }, [folder.id, selectItem, toggleFolderExpanded]);
  
  /**
   * Клик по стрелке раскрытия
   */
  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFolderExpanded(folder.id);
  }, [folder.id, toggleFolderExpanded]);
  
  /**
   * Завершение редактирования
   */
  const handleEditComplete = useCallback(() => {
    if (editValue.trim()) {
      renameFolder(folder.id, editValue.trim());
    } else {
      setEditValue(folder.name);
    }
    stopEditing();
  }, [folder.id, folder.name, editValue, renameFolder, stopEditing]);
  
  /**
   * Обработка клавиш при редактировании
   */
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    
    if (e.key === 'Enter') {
      handleEditComplete();
    } else if (e.key === 'Escape') {
      setEditValue(folder.name);
      stopEditing();
    }
  }, [folder.name, handleEditComplete, stopEditing]);
  
  // ===========================================================================
  // DRAG AND DROP
  // ===========================================================================
  
  /**
   * Начало перетаскивания
   */
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      id: folder.id,
      type: 'folder',
      parentId: folder.parentId,
    }));
    e.dataTransfer.effectAllowed = 'move';
  }, [folder.id, folder.parentId]);
  
  /**
   * Drag over папки
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(folder.id, 'folder');
  }, [folder.id, setDragOver]);
  
  /**
   * Drag leave
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null, null);
  }, [setDragOver]);
  
  /**
   * Drop в папку
   */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null, null);
    
    const dataStr = e.dataTransfer.getData('application/json');
    if (!dataStr) return;
    
    try {
      const data = JSON.parse(dataStr);
      
      // Нельзя переместить папку в себя
      if (data.type === 'folder' && data.id === folder.id) return;
      
      if (data.type === 'canvas') {
        moveCanvas(data.id, folder.id);
      } else if (data.type === 'folder') {
        moveFolder(data.id, folder.id);
      }
      
      // Раскрываем папку при drop
      if (!folder.isExpanded) {
        toggleFolderExpanded(folder.id);
      }
    } catch (error) {
      console.error('Ошибка при drop:', error);
    }
  }, [folder.id, folder.isExpanded, setDragOver, moveCanvas, moveFolder, toggleFolderExpanded]);
  
  // ===========================================================================
  // КОНТЕКСТНОЕ МЕНЮ
  // ===========================================================================
  
  /**
   * Элементы контекстного меню для папки
   */
  const contextMenuItems: ContextMenuItem[] = React.useMemo(() => [
    {
      id: 'createCanvas',
      label: t.sidebar.createCanvasInside,
      icon: Plus,
    },
    {
      id: 'createSubfolder',
      label: t.sidebar.createSubfolder,
      icon: FolderPlus,
    },
    {
      id: 'rename',
      label: t.common.rename,
      icon: Pencil,
      dividerBefore: true,
    },
    {
      id: 'delete',
      label: t.common.delete,
      icon: Trash2,
      danger: true,
      dividerBefore: true,
    },
  ], [t]);
  
  /**
   * Открыть контекстное меню
   */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Выбираем папку
    if (!isSelected) {
      selectItem(folder.id, false);
    }
    
    contextMenu.open(e);
  }, [folder.id, isSelected, selectItem, contextMenu]);
  
  /**
   * Обработка выбора в контекстном меню
   */
  const handleContextMenuSelect = useCallback(async (action: string) => {
    switch (action) {
      case 'createCanvas':
        try {
          // Создаём холст внутри папки
          await createCanvas(t.sidebar.newCanvas, folder.id);
          // Раскрываем папку
          if (!folder.isExpanded) {
            toggleFolderExpanded(folder.id);
          }
        } catch (error) {
          console.error('Ошибка создания холста:', error);
        }
        break;
        
      case 'createSubfolder':
        // Создаём подпапку
        createFolder(t.sidebar.newFolder, folder.id);
        // Раскрываем папку
        if (!folder.isExpanded) {
          toggleFolderExpanded(folder.id);
        }
        break;
        
      case 'rename':
        startEditing(folder.id);
        setEditValue(folder.name);
        break;
        
      case 'delete':
        if (window.confirm(format(t.sidebar.deleteFolderConfirm, { name: folder.name }))) {
          deleteFolder(folder.id, true);
        }
        break;
    }
  }, [
    folder.id, 
    folder.name, 
    folder.isExpanded, 
    createCanvas, 
    createFolder, 
    toggleFolderExpanded, 
    startEditing, 
    deleteFolder, 
    t,
  ]);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  return (
    <div
      style={{ animationDelay: `${animationDelay}ms` }}
      className="animate-in fade-in-0 slide-in-from-left-2 duration-200"
    >
      {/* Элемент папки */}
      <div
        className={cn(
          'group flex items-center gap-1.5',
          // Увеличенная высота для папок
          'min-h-[38px] py-2 px-2 mx-1.5 rounded-lg',
          'cursor-pointer select-none',
          'transition-all duration-150',
          // Состояния
          isSelected && 'bg-[#45475a]/80 shadow-sm',
          !isSelected && 'hover:bg-[#313244]/60',
          isDragOver && 'bg-[#89b4fa]/20 ring-2 ring-[#89b4fa]/40 ring-inset',
        )}
        style={{ paddingLeft: `${8 + level * 16}px` }}
        onClick={handleClickWithToggle}
        onContextMenu={handleContextMenu}
        draggable={!isEditing}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Стрелка раскрытия */}
        <button
          onClick={handleToggleExpand}
          className={cn(
            'p-1 rounded-md',
            'hover:bg-[#45475a]',
            'transition-all duration-150',
          )}
        >
          <div className={cn(
            'transition-transform duration-200',
            folder.isExpanded && 'rotate-0',
            !folder.isExpanded && '-rotate-90',
          )}>
            <ChevronDown className="w-4 h-4 text-[#6c7086]" />
          </div>
        </button>
        
        {/* Иконка папки - увеличенная */}
        <div className="relative">
          {folder.isExpanded ? (
            <FolderOpen className="w-5 h-5 text-[#f9e2af] drop-shadow-sm" />
          ) : (
            <Folder className="w-5 h-5 text-[#f9e2af] drop-shadow-sm" />
          )}
        </div>
        
        {/* Название - увеличенный шрифт для папок */}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleEditComplete}
            onKeyDown={handleEditKeyDown}
            className={cn(
              'flex-1 px-2 py-1 text-sm',
              'bg-[#181825] border border-[#89b4fa]',
              'text-[#cdd6f4] rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-[#89b4fa]/30',
            )}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span 
              className="flex-1 text-sm text-[#cdd6f4] font-semibold line-clamp-2 break-words"
              title={folder.name}
            >
              {folder.name}
            </span>
            
            {/* Счётчик элементов */}
            {itemsCount > 0 && (
              <span className={cn(
                'px-2 py-0.5 rounded-full',
                'text-xs font-medium',
                'bg-[#313244] text-[#a6adc8]',
                'transition-opacity duration-150',
              )}>
                {itemsCount}
              </span>
            )}
            
            {/* Кнопка меню */}
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
          </>
        )}
      </div>
      
      {/* Содержимое папки (рекурсивно) */}
      {folder.isExpanded && (
        <div className={cn(
          'ml-2 border-l border-[#313244]/50',
          'animate-in fade-in-0 slide-in-from-top-1 duration-150',
        )}>
          <FolderTree parentId={folder.id} level={level + 1} />
        </div>
      )}
      
      {/* Контекстное меню */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={contextMenuItems}
        onSelect={handleContextMenuSelect}
        onClose={contextMenu.close}
      />
    </div>
  );
}

export default FolderTree;
