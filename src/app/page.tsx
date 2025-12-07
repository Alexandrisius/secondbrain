/**
 * @file page.tsx
 * @description Главная страница NeuroCanvas
 * 
 * Эта страница отображает:
 * - Боковую панель (Sidebar) для управления холстами
 * - Бесконечный холст (Canvas) для работы с AI-нодами
 */

'use client';

import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/sidebar';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';

// =============================================================================
// ДИНАМИЧЕСКИЙ ИМПОРТ
// =============================================================================

/**
 * Динамически импортируем Canvas без SSR
 * 
 * React Flow использует много browser-only API (window, document),
 * поэтому его нельзя рендерить на сервере.
 * 
 * ssr: false отключает серверный рендеринг для этого компонента.
 */
const Canvas = dynamic(
  () => import('@/components/canvas/Canvas').then((mod) => mod.Canvas),
  {
    ssr: false,
    loading: () => <CanvasLoader />,
  }
);

// =============================================================================
// КОМПОНЕНТ ЗАГРУЗКИ
// =============================================================================

/**
 * Placeholder во время загрузки Canvas
 * Показывается пока React Flow инициализируется
 */
function CanvasLoader() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        {/* Анимированный лого */}
        <div className="relative w-16 h-16">
          {/* Внешний круг */}
          <div className="absolute inset-0 rounded-full border-4 border-muted animate-pulse" />
          {/* Внутренний круг */}
          <div className="absolute inset-2 rounded-full border-4 border-primary/30 animate-spin" 
               style={{ animationDuration: '3s' }} />
          {/* Центральная точка */}
          <div className="absolute inset-6 rounded-full bg-primary animate-pulse" />
        </div>
        
        {/* Текст */}
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground">
            NeuroCanvas
          </h2>
          <p className="text-sm text-muted-foreground">
            Загрузка холста...
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ПУСТОЕ СОСТОЯНИЕ
// =============================================================================

/**
 * Компонент для отображения когда нет активного холста
 */
function EmptyState() {
  const { createCanvas, isLoading } = useWorkspaceStore();
  
  const handleCreate = async () => {
    try {
      await createCanvas('Новый холст', null);
    } catch (error) {
      console.error('Ошибка создания холста:', error);
    }
  };
  
  return (
    <div className="w-full h-full flex items-center justify-center bg-[#1e1e2e]">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Иконка */}
        <div className="w-20 h-20 rounded-2xl bg-[#313244] flex items-center justify-center">
          <svg 
            className="w-10 h-10 text-[#6c7086]" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" 
            />
          </svg>
        </div>
        
        {/* Текст */}
        <div>
          <h2 className="text-xl font-semibold text-[#cdd6f4] mb-2">
            Нет открытого холста
          </h2>
          <p className="text-sm text-[#6c7086] max-w-xs">
            Выберите холст из списка слева или создайте новый
          </p>
        </div>
        
        {/* Кнопка создания */}
        <button
          onClick={handleCreate}
          disabled={isLoading}
          className="
            flex items-center gap-2
            px-6 py-3 rounded-lg
            bg-[#89b4fa] text-[#1e1e2e]
            font-medium
            hover:bg-[#b4befe]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-150
          "
        >
          <svg 
            className="w-5 h-5" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M12 4v16m8-8H4" 
            />
          </svg>
          Создать холст
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// ГЛАВНАЯ СТРАНИЦА
// =============================================================================

/**
 * HomePage - главная страница приложения
 * 
 * Рендерит:
 * - Sidebar слева для навигации между холстами
 * - Canvas справа для работы с текущим холстом
 */
export default function HomePage() {
  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);
  const isLoading = useWorkspaceStore((s) => s.isLoading);
  
  return (
    <main className="w-full h-screen flex overflow-hidden bg-[#1e1e2e]">
      {/* Боковая панель */}
      <Sidebar />
      
      {/* Основная область с холстом */}
      <div className="flex-1 relative">
        {/* Canvas или пустое состояние */}
        {isLoading ? (
          <CanvasLoader />
        ) : activeCanvasId ? (
          <Canvas key={activeCanvasId} />
        ) : (
          <EmptyState />
        )}
        
        {/* Watermark в углу */}
        <div className="fixed bottom-4 right-4 z-10 pointer-events-none">
          <div className="flex flex-col items-end gap-1 text-xs text-[#6c7086]/50">
            <span>Scroll: zoom</span>
            <span>Drag empty: pan</span>
            <span>Drag from node: create new</span>
          </div>
        </div>
      </div>
    </main>
  );
}
