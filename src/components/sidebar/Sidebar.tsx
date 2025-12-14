/**
 * @file Sidebar.tsx
 * @description Главный компонент боковой панели для управления холстами
 * 
 * Функции:
 * - Сворачивание/разворачивание панели
 * - Изменение ширины панели (resize)
 * - Поиск по холстам и папкам
 * - Кнопки создания холста и папки
 * - Секция "Недавние"
 * - Древовидная структура папок и холстов
 * - Современный дизайн с glassmorphism и анимациями
 */

'use client';

import React, { useEffect, useCallback, useState, useRef } from 'react';
import { 
  ChevronLeft, 
  Plus, 
  FolderPlus,
  Loader2,
  Sparkles,
  GripVertical,
} from 'lucide-react';
import { useWorkspaceStore, markWorkspaceLoaded } from '@/store/useWorkspaceStore';
import { useTranslation } from '@/lib/i18n';
import { RecentSection } from './RecentSection';
import { FolderTree } from './FolderTree';
import { SearchInput } from './SearchInput';
import { cn } from '@/lib/utils';

// =============================================================================
// КОНСТАНТЫ ВЕРСИИ
// =============================================================================

/**
 * Версия приложения по умолчанию (fallback для веб-версии)
 * Обновляется вместе с package.json
 */
const DEFAULT_VERSION = '1.0.1';

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Ширина развёрнутого сайдбара по умолчанию
 */
const DEFAULT_SIDEBAR_WIDTH = 280;

/**
 * Минимальная ширина сайдбара
 */
const MIN_SIDEBAR_WIDTH = 200;

/**
 * Максимальная ширина сайдбара
 */
const MAX_SIDEBAR_WIDTH = 500;

/**
 * Ширина свёрнутого сайдбара
 */
const SIDEBAR_COLLAPSED_WIDTH = 52;

/**
 * Ключ для localStorage
 */
const SIDEBAR_WIDTH_KEY = 'neurocanvas-sidebar-width';

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Загрузить сохранённую ширину из localStorage
 */
function loadSavedWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH;
  
  const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (saved) {
    const width = parseInt(saved, 10);
    if (!isNaN(width) && width >= MIN_SIDEBAR_WIDTH && width <= MAX_SIDEBAR_WIDTH) {
      return width;
    }
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

/**
 * Сохранить ширину в localStorage
 */
function saveWidth(width: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
}

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * Sidebar - главный компонент боковой панели
 * 
 * Отображает:
 * - Заголовок с кнопкой сворачивания
 * - Поиск по холстам
 * - Кнопки создания холста/папки
 * - Секция "Недавние" (топ-5)
 * - Дерево папок и холстов
 * - Resize handle для изменения ширины
 */
export function Sidebar() {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // ===========================================================================
  // СОСТОЯНИЕ
  // ===========================================================================
  
  const {
    isLoading,
    isSaving,
    error,
    isSidebarCollapsed,
    toggleSidebar,
    loadWorkspace,
    createCanvas,
    createFolder,
    clearError,
  } = useWorkspaceStore();
  
  // Ширина сайдбара
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  
  // Состояние resize
  const [isResizing, setIsResizing] = useState(false);
  
  // Ref для сайдбара
  const sidebarRef = useRef<HTMLElement>(null);
  
  // Версия приложения (получается динамически из Electron или fallback)
  const [appVersion, setAppVersion] = useState(DEFAULT_VERSION);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  /**
   * Загружаем сохранённую ширину при монтировании
   */
  useEffect(() => {
    setSidebarWidth(loadSavedWidth());
  }, []);
  
  /**
   * Получаем версию приложения из Electron API
   * В веб-версии используется DEFAULT_VERSION как fallback
   */
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        // Проверяем, запущено ли в Electron
        if (typeof window !== 'undefined' && window.electronAPI) {
          const version = await window.electronAPI.getAppVersion();
          if (version) {
            setAppVersion(version);
          }
        }
      } catch (error) {
        console.error('[Sidebar] Ошибка получения версии:', error);
        // Оставляем DEFAULT_VERSION
      }
    };
    
    fetchVersion();
  }, []);
  
  /**
   * Загружаем workspace при монтировании
   * Если есть старый canvas.json - сначала мигрируем
   */
  useEffect(() => {
    const initializeWorkspace = async () => {
      try {
        // Проверяем нужна ли миграция
        const migrationCheck = await fetch('/api/migrate');
        const { needsMigration } = await migrationCheck.json();
        
        if (needsMigration) {
          console.log('[Sidebar] Обнаружен старый формат, запускаем миграцию...');
          const migrationResult = await fetch('/api/migrate', { method: 'POST' });
          const result = await migrationResult.json();
          console.log('[Sidebar] Миграция завершена:', result);
        }
        
        // Загружаем workspace
        await loadWorkspace();
        markWorkspaceLoaded();
      } catch (error) {
        console.error('[Sidebar] Ошибка инициализации:', error);
        // Всё равно пытаемся загрузить workspace
        await loadWorkspace();
        markWorkspaceLoaded();
      }
    };
    
    initializeWorkspace();
  }, [loadWorkspace]);
  
  /**
   * Обработка resize через mouse events
   */
  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      
      // Вычисляем новую ширину
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, e.clientX)
      );
      
      setSidebarWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      // Сохраняем ширину
      saveWidth(sidebarWidth);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    
    // Устанавливаем курсор на всём документе
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, sidebarWidth]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================
  
  /**
   * Создать новый холст
   */
  const handleCreateCanvas = useCallback(async () => {
    try {
      // Используем локализованное название для нового холста
      await createCanvas(t.sidebar.newCanvas, null);
    } catch (error) {
      console.error('Ошибка создания холста:', error);
    }
  }, [createCanvas, t.sidebar.newCanvas]);
  
  /**
   * Создать новую папку
   */
  const handleCreateFolder = useCallback(() => {
    createFolder(t.sidebar.newFolder, null);
  }, [createFolder, t.sidebar.newFolder]);
  
  /**
   * Начать resize
   */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);
  
  /**
   * Двойной клик по resize handle - сброс к дефолтной ширине
   */
  const handleResizeDoubleClick = useCallback(() => {
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    saveWidth(DEFAULT_SIDEBAR_WIDTH);
  }, []);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  // Актуальная ширина (с учётом свёрнутого состояния)
  const actualWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;
  
  return (
    <aside
      ref={sidebarRef}
      className={cn(
        // Базовые стили
        'h-full flex flex-col relative',
        'bg-[#1e1e2e]/95 backdrop-blur-md',
        'border-r border-[#313244]/80',
        // Тень для глубины
        'shadow-2xl shadow-black/20',
        // Анимация только когда не resizing
        !isResizing && 'transition-all duration-300 ease-out',
      )}
      style={{
        width: actualWidth,
        minWidth: actualWidth,
      }}
    >
      {/* ===================================================================== */}
      {/* ЗАГОЛОВОК */}
      {/* ===================================================================== */}
      
      <header 
        className={cn(
          'flex items-center justify-between',
          'h-14 px-3',
          'border-b border-[#313244]/60',
          'bg-gradient-to-b from-[#181825] to-[#1e1e2e]',
        )}
      >
        {/* Заголовок (скрывается при сворачивании) */}
        {!isSidebarCollapsed && (
          <div className="flex items-center gap-2">
            {/* Логотип/иконка */}
            <div className={cn(
              'w-7 h-7 rounded-lg',
              'bg-gradient-to-br from-[#89b4fa] to-[#b4befe]',
              'flex items-center justify-center',
              'shadow-lg shadow-[#89b4fa]/20',
            )}>
              <Sparkles className="w-4 h-4 text-[#1e1e2e]" />
            </div>
            
            <span className="text-sm font-bold text-[#cdd6f4] tracking-tight">
              {t.sidebar.canvases}
            </span>
            
            {/* Индикатор сохранения */}
            {isSaving && (
              <Loader2 className="w-3.5 h-3.5 text-[#89b4fa] animate-spin" />
            )}
          </div>
        )}
        
        {/* Кнопка сворачивания */}
        <button
          onClick={toggleSidebar}
          className={cn(
            'p-2 rounded-lg',
            'text-[#6c7086] hover:text-[#cdd6f4]',
            'hover:bg-[#313244]/60',
            'transition-all duration-150',
            'group',
            isSidebarCollapsed && 'mx-auto',
          )}
          title={isSidebarCollapsed ? t.sidebar.expandPanel : t.sidebar.collapsePanel}
        >
          <div className={cn(
            'transition-transform duration-200',
            isSidebarCollapsed && 'rotate-180',
          )}>
            <ChevronLeft className="w-4 h-4" />
          </div>
        </button>
      </header>
      
      {/* ===================================================================== */}
      {/* ПОИСК */}
      {/* ===================================================================== */}
      
      {!isSidebarCollapsed && (
        <div className="px-3 py-3 border-b border-[#313244]/40">
          <SearchInput />
        </div>
      )}
      
      {/* ===================================================================== */}
      {/* КНОПКИ СОЗДАНИЯ */}
      {/* ===================================================================== */}
      
      {!isSidebarCollapsed && (
        <div className="flex gap-2 px-3 py-3 border-b border-[#313244]/40">
          {/* Новый холст */}
          <button
            onClick={handleCreateCanvas}
            disabled={isLoading || isSaving}
            className={cn(
              'flex-1 flex items-center justify-center gap-2',
              'h-9 px-4 rounded-lg',
              'text-xs font-semibold',
              'bg-gradient-to-r from-[#89b4fa] to-[#b4befe]',
              'text-[#1e1e2e]',
              'hover:shadow-lg hover:shadow-[#89b4fa]/25',
              'hover:scale-[1.02]',
              'active:scale-[0.98]',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
              'transition-all duration-150',
            )}
          >
            <Plus className="w-4 h-4" />
            <span>{t.sidebar.newCanvas}</span>
          </button>
          
          {/* Новая папка */}
          <button
            onClick={handleCreateFolder}
            disabled={isLoading || isSaving}
            className={cn(
              'flex items-center justify-center',
              'h-9 w-9 rounded-lg',
              'text-[#6c7086] hover:text-[#cdd6f4]',
              'bg-[#313244]/60 hover:bg-[#45475a]',
              'hover:scale-105',
              'active:scale-95',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100',
              'transition-all duration-150',
            )}
            title={t.sidebar.newFolder}
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {/* ===================================================================== */}
      {/* ОШИБКА */}
      {/* ===================================================================== */}
      
      {error && !isSidebarCollapsed && (
        <div 
          className={cn(
            'mx-3 mt-3 p-3 rounded-xl',
            'bg-[#f38ba8]/10 border border-[#f38ba8]/20',
            'text-xs text-[#f38ba8]',
            'animate-in fade-in-0 slide-in-from-top-2 duration-200',
          )}
        >
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={clearError}
              className="ml-2 p-1 hover:bg-[#f38ba8]/20 rounded transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      
      {/* ===================================================================== */}
      {/* СОДЕРЖИМОЕ */}
      {/* ===================================================================== */}
      
      <div className={cn(
        'flex-1 overflow-y-auto overflow-x-hidden',
        // Кастомный скроллбар
        'scrollbar-thin scrollbar-track-transparent',
        'scrollbar-thumb-[#313244] hover:scrollbar-thumb-[#45475a]',
      )}>
        {isLoading ? (
          // Индикатор загрузки
          <div className="flex flex-col items-center justify-center h-32 gap-3">
            <div className="relative">
              <Loader2 className="w-8 h-8 text-[#89b4fa] animate-spin" />
              <div className="absolute inset-0 bg-gradient-to-br from-[#89b4fa]/20 to-transparent rounded-full animate-pulse" />
            </div>
            <span className="text-xs text-[#6c7086]">{t.common.loading}</span>
          </div>
        ) : isSidebarCollapsed ? (
          // Свёрнутое состояние - показываем только иконки
          <div className="py-3 flex flex-col items-center gap-1">
            {/* Можно добавить иконки недавних холстов */}
          </div>
        ) : (
          // Развёрнутое состояние
          <div className="py-3">
            {/* Секция "Недавние" */}
            <RecentSection />
            
            {/* Дерево папок и холстов */}
            <div className="mt-1">
              <div className="px-4 py-2 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#6c7086]">
                  {t.sidebar.allCanvases}
                </span>
                <div className="flex-1 h-px bg-gradient-to-r from-[#313244] to-transparent" />
              </div>
              <FolderTree parentId={null} level={0} />
            </div>
          </div>
        )}
      </div>
      
      {/* ===================================================================== */}
      {/* ФУТЕР */}
      {/* ===================================================================== */}
      
      {!isSidebarCollapsed && (
        <footer className={cn(
          'p-3 border-t border-[#313244]/40',
          'bg-gradient-to-t from-[#181825]/50 to-transparent',
        )}>
          <div className="text-[10px] text-[#6c7086]/60 text-center font-medium tracking-wide">
            {/* Динамическая версия: подставляем appVersion в шаблон */}
            {t.sidebar.version.replace('{version}', appVersion)}
          </div>
        </footer>
      )}
      
      {/* ===================================================================== */}
      {/* RESIZE HANDLE */}
      {/* ===================================================================== */}
      
      {!isSidebarCollapsed && (
        <div
          className={cn(
            // Позиционирование
            'absolute top-0 right-0 bottom-0 w-1',
            // Интерактивная зона шире чем визуальная
            'group cursor-col-resize',
            // Базовые стили
            'transition-all duration-150',
            // Hover состояние
            'hover:w-1.5 hover:bg-[#89b4fa]/30',
            // Active состояние
            isResizing && 'w-1.5 bg-[#89b4fa]/50',
          )}
          onMouseDown={handleResizeStart}
          onDoubleClick={handleResizeDoubleClick}
          title={t.sidebar.resizePanel}
        >
          {/* Визуальный индикатор при hover */}
          <div className={cn(
            'absolute inset-y-0 right-0 w-1',
            'bg-transparent',
            'group-hover:bg-[#89b4fa]/40',
            isResizing && 'bg-[#89b4fa]/60',
            'transition-colors duration-150',
          )} />
          
          {/* Иконка grip при hover (по центру) */}
          <div className={cn(
            'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'opacity-0 group-hover:opacity-100',
            isResizing && 'opacity-100',
            'transition-opacity duration-150',
            'pointer-events-none',
          )}>
            <div className={cn(
              'px-0.5 py-2 rounded-full',
              'bg-[#89b4fa]/20 backdrop-blur-sm',
            )}>
              <GripVertical className="w-3 h-3 text-[#89b4fa]" />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
