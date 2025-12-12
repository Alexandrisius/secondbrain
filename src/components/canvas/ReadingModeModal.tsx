/**
 * @file ReadingModeModal.tsx
 * @description Полноэкранный модальный компонент для режима чтения карточек
 * 
 * Отображает карточку в полноэкранном режиме с:
 * - Backdrop с blur-эффектом
 * - Центрированным контентом карточки
 * - Кнопкой закрытия
 * - Навигационными кнопками (будут добавлены в Блоке 3)
 * 
 * ВАЖНО: Рендерится через React Portal вне DOM-дерева Canvas
 * для корректного позиционирования и z-index.
 */

'use client';

import React, { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Edit2, Save, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import TextareaAutosize from 'react-textarea-autosize';

import { useReadingModeStore } from '@/store/useReadingModeStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { NeuroNode } from '@/types/canvas';

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Длительность анимаций в миллисекундах
 */
const ANIMATION_DURATION = 350;

/**
 * Настройки easing для анимаций (cubic-bezier)
 * Соответствует Material Design стандарту
 */
const EASE_OUT: [number, number, number, number] = [0.4, 0.0, 0.2, 1];

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * ReadingModeModal - полноэкранный режим просмотра карточки
 * 
 * Особенности:
 * - Рендерится в Portal для корректного z-index
 * - Плавные анимации входа/выхода через Framer Motion
 * - Блокировка scroll на body при открытии
 * - Escape для закрытия
 * - Адаптивная ширина контента (60-70%, max 900px)
 */
export function ReadingModeModal() {
  // ===========================================================================
  // HOOKS
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // Reading Mode Store
  const isOpen = useReadingModeStore((s) => s.isOpen);
  const currentNodeId = useReadingModeStore((s) => s.currentNodeId);
  const direction = useReadingModeStore((s) => s.direction);
  const isAnimating = useReadingModeStore((s) => s.isAnimating);
  const selectorSidebar = useReadingModeStore((s) => s.selectorSidebar);
  const closeReadingMode = useReadingModeStore((s) => s.closeReadingMode);
  const navigateToNode = useReadingModeStore((s) => s.navigateToNode);
  const goBack = useReadingModeStore((s) => s.goBack);
  const setIsAnimating = useReadingModeStore((s) => s.setIsAnimating);
  const setSelectorSidebar = useReadingModeStore((s) => s.setSelectorSidebar);
  const history = useReadingModeStore((s) => s.history);
  
  // Canvas Store - получаем данные карточки и связи
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  
  // ===========================================================================
  // LOCAL STATE FOR EDITING
  // ===========================================================================

  const [isEditing, setIsEditing] = useState(false);
  const [localTitle, setLocalTitle] = useState('');
  const [localContent, setLocalContent] = useState('');

  // ===========================================================================
  // ВЫЧИСЛЯЕМЫЕ ЗНАЧЕНИЯ
  // ===========================================================================
  
  /**
   * Текущая карточка для отображения
   */
  const currentNode = useMemo<NeuroNode | null>(() => {
    if (!currentNodeId) return null;
    return nodes.find((n) => n.id === currentNodeId) || null;
  }, [currentNodeId, nodes]);
  
  /**
   * Тип карточки (AI или Note)
   */
  const isNoteNode = currentNode?.type === 'note';
  
  /**
   * Родительские карточки (через входящие edges)
   * Карточки, от которых идут связи К текущей карточке
   */
  const parentNodes = useMemo<NeuroNode[]>(() => {
    if (!currentNodeId) return [];
    
    // Находим все входящие связи (где текущая карточка - target)
    const incomingEdgeSourceIds = edges
      .filter((e) => e.target === currentNodeId)
      .map((e) => e.source);
    
    // Получаем карточки-родители
    return nodes.filter((n) => incomingEdgeSourceIds.includes(n.id));
  }, [currentNodeId, nodes, edges]);
  
  /**
   * Дочерние карточки (через исходящие edges)
   * Карточки, к которым идут связи ОТ текущей карточки
   */
  const childNodes = useMemo<NeuroNode[]>(() => {
    if (!currentNodeId) return [];
    
    // Находим все исходящие связи (где текущая карточка - source)
    const outgoingEdgeTargetIds = edges
      .filter((e) => e.source === currentNodeId)
      .map((e) => e.target);
    
    // Получаем карточки-потомки
    return nodes.filter((n) => outgoingEdgeTargetIds.includes(n.id));
  }, [currentNodeId, nodes, edges]);
  
  /**
   * Флаги наличия связей
   */
  const hasParents = parentNodes.length > 0;
  const hasChildren = childNodes.length > 0;
  const canGoBack = history.length > 0;
  
  /**
   * Progress - подсчёт позиции в текущей ветке через DFS
   * Возвращает { current: number, total: number }
   */
  const branchProgress = useMemo(() => {
    if (!currentNodeId) return { current: 0, total: 0 };
    
    // Находим корень ветки (идём вверх по первому родителю)
    let rootId = currentNodeId;
    const visitedUp = new Set<string>();
    
    while (!visitedUp.has(rootId)) {
      visitedUp.add(rootId);
      const incomingEdge = edges.find((e) => e.target === rootId);
      if (!incomingEdge) break;
      rootId = incomingEdge.source;
    }
    
    // DFS от корня чтобы подсчитать все карточки в ветке
    const allNodesInBranch: string[] = [];
    const stack = [rootId];
    const visitedDfs = new Set<string>();
    
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      if (visitedDfs.has(nodeId)) continue;
      visitedDfs.add(nodeId);
      
      allNodesInBranch.push(nodeId);
      
      // Добавляем потомков
      const childEdges = edges.filter((e) => e.source === nodeId);
      for (const edge of childEdges) {
        if (!visitedDfs.has(edge.target)) {
          stack.push(edge.target);
        }
      }
    }
    
    const currentIndex = allNodesInBranch.indexOf(currentNodeId);
    
    return {
      current: currentIndex + 1,
      total: allNodesInBranch.length
    };
  }, [currentNodeId, edges]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================
  
  /**
   * Начало редактирования (для NoteNode)
   */
  const handleStartEditing = useCallback(() => {
    if (!currentNode) return;
    setLocalTitle(currentNode.data.prompt || '');
    setLocalContent(currentNode.data.response || '');
    setIsEditing(true);
  }, [currentNode]);

  /**
   * Отмена редактирования
   */
  const handleCancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  /**
   * Сохранение изменений
   */
  const handleSaveEditing = useCallback(() => {
    if (!currentNodeId) return;
    updateNodeData(currentNodeId, {
        prompt: localTitle,
        response: localContent
    });
    setIsEditing(false);
  }, [currentNodeId, localTitle, localContent, updateNodeData]);

  /**
   * Переход к родительской карточке (←)
   * При множественных родителях - открываем sidebar для выбора
   */
  const handleNavigateToParent = useCallback(() => {
    if (isAnimating || parentNodes.length === 0) return;
    
    // Если один родитель - переходим сразу
    if (parentNodes.length === 1) {
      navigateToNode(parentNodes[0].id, 'left');
    } else {
      // Множественные родители - открываем sidebar
      setSelectorSidebar(selectorSidebar === 'parents' ? null : 'parents');
    }
  }, [isAnimating, parentNodes, navigateToNode, setSelectorSidebar, selectorSidebar]);
  
  /**
   * Переход к дочерней карточке (→)
   * При множественных потомках - открываем sidebar для выбора
   */
  const handleNavigateToChild = useCallback(() => {
    if (isAnimating || childNodes.length === 0) return;
    
    // Если один потомок - переходим сразу
    if (childNodes.length === 1) {
      navigateToNode(childNodes[0].id, 'right');
    } else {
      // Множественные потомки - открываем sidebar
      setSelectorSidebar(selectorSidebar === 'children' ? null : 'children');
    }
  }, [isAnimating, childNodes, navigateToNode, setSelectorSidebar, selectorSidebar]);
  
  /**
   * Выбор карточки из sidebar
   */
  const handleSelectFromSidebar = useCallback((nodeId: string) => {
    const direction = selectorSidebar === 'parents' ? 'left' : 'right';
    setSelectorSidebar(null); // Закрываем sidebar
    navigateToNode(nodeId, direction);
  }, [selectorSidebar, setSelectorSidebar, navigateToNode]);
  
  /**
   * Закрытие sidebar
   */
  const handleCloseSidebar = useCallback(() => {
    setSelectorSidebar(null);
  }, [setSelectorSidebar]);
  
  /**
   * Возврат по истории (Backspace)
   */
  const handleGoBack = useCallback(() => {
    if (isAnimating) return;
    goBack();
  }, [isAnimating, goBack]);
  
  /**
   * Обработчик нажатия клавиш
   * - Escape: закрыть
   * - ArrowLeft: к родителю
   * - ArrowRight: к потомку
   * - Backspace: назад по истории
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Игнорируем если фокус в текстовом поле
    const activeElement = document.activeElement;
    if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
      return;
    }
    
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closeReadingMode();
        break;
        
      case 'ArrowLeft':
        event.preventDefault();
        handleNavigateToParent();
        break;
        
      case 'ArrowRight':
        event.preventDefault();
        handleNavigateToChild();
        break;
        
      case 'Backspace':
        event.preventDefault();
        handleGoBack();
        break;
    }
  }, [closeReadingMode, handleNavigateToParent, handleNavigateToChild, handleGoBack]);
  
  /**
   * Обработчик клика по backdrop для закрытия
   */
  const handleBackdropClick = useCallback((event: React.MouseEvent) => {
    // Закрываем только при клике на сам backdrop, не на контент
    if (event.target === event.currentTarget) {
      closeReadingMode();
    }
  }, [closeReadingMode]);
  
  /**
   * Callback при завершении анимации перехода
   */
  const handleAnimationComplete = useCallback(() => {
    setIsAnimating(false);
  }, [setIsAnimating]);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================

  /**
   * Сброс режима редактирования при смене карточки
   */
  useEffect(() => {
    setIsEditing(false);
  }, [currentNodeId]);
  
  /**
   * Снятие выделения с карточек при открытии режима чтения
   * Освобождает Arrow keys от React Flow навигации
   */
  useEffect(() => {
    if (isOpen) {
      clearSelection();
    }
  }, [isOpen, clearSelection]);
  
  /**
   * Глобальный обработчик клавиатуры
   */
  useEffect(() => {
    if (!isOpen) return;
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  // Не рендерим ничего на сервере
  if (typeof window === 'undefined') return null;
  
  // Получаем portal container
  const portalContainer = document.body;
  
  return createPortal(
    <AnimatePresence mode="wait">
      {isOpen && currentNode && (
        <motion.div
          key="reading-mode-backdrop"
          className={cn(
            // Полноэкранный overlay
            'fixed inset-0 z-[9999]',
            // Flex для центрирования контента
            'flex items-center justify-center',
            // Padding для отступов от краёв
            'p-4 sm:p-8'
          )}
          // Анимация backdrop
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: ANIMATION_DURATION / 1000, ease: EASE_OUT }}
          onClick={handleBackdropClick}
        >
          {/* ================================================================
              BACKDROP с blur-эффектом
              ================================================================ */}
          <motion.div
            className={cn(
              'absolute inset-0',
              // Backdrop blur и затемнение
              'backdrop-blur-[12px] bg-black/60'
            )}
            // Дополнительная анимация затемнения при переходах
            animate={{
              backgroundColor: direction === 'right' 
                ? 'rgba(0, 0, 0, 0.65)' // Чуть темнее при погружении
                : direction === 'left'
                  ? 'rgba(0, 0, 0, 0.55)' // Чуть светлее при всплытии
                  : 'rgba(0, 0, 0, 0.60)'
            }}
            transition={{ duration: ANIMATION_DURATION / 1000 }}
          />
          
          {/* ================================================================
              КНОПКА ЗАКРЫТИЯ (X) - правый верхний угол
              ================================================================ */}
          <motion.button
            onClick={closeReadingMode}
            className={cn(
              'absolute top-4 right-4 z-10',
              // Размер и форма
              'w-12 h-12 rounded-full',
              // Цвета и эффекты
              'bg-white/10 hover:bg-white/20',
              'text-white/80 hover:text-white',
              // Flex для центрирования иконки
              'flex items-center justify-center',
              // Transition
              'transition-colors duration-200',
              // Фокус
              'focus:outline-none focus:ring-2 focus:ring-white/30'
            )}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ delay: 0.1, duration: 0.2 }}
            title={t.common?.close || 'Закрыть'}
          >
            <X className="w-6 h-6" />
          </motion.button>
          
          {/* ================================================================
              НАВИГАЦИОННАЯ КНОПКА ВЛЕВО (к родителю)
              ================================================================ */}
          <motion.button
            onClick={handleNavigateToParent}
            disabled={!hasParents || isAnimating}
            className={cn(
              'absolute left-4 top-1/2 -translate-y-1/2 z-10',
              // Размер и форма - 56x56 как в ТЗ
              'w-14 h-14 rounded-full',
              // Flex для центрирования
              'flex items-center justify-center',
              // Transition
              'transition-all duration-200',
              // Фокус
              'focus:outline-none focus:ring-2 focus:ring-white/30',
              // Состояния
              hasParents
                ? 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white hover:scale-110 active:scale-95 cursor-pointer'
                : 'bg-white/5 text-white/20 cursor-not-allowed'
            )}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ delay: 0.15, duration: 0.25 }}
            title={hasParents 
              ? `${t.readingMode?.toParent || 'К родителю'} (←)${parentNodes.length > 1 ? ` • ${parentNodes.length}` : ''}`
              : t.readingMode?.noParents || 'Нет родителей'
            }
          >
            <ChevronLeft className="w-7 h-7" />
            {/* Badge с количеством родителей */}
            {parentNodes.length > 1 && (
              <span className={cn(
                'absolute -top-1 -right-1',
                'min-w-5 h-5 px-1.5 rounded-full',
                'bg-purple-500 text-white text-xs font-bold',
                'flex items-center justify-center'
              )}>
                {parentNodes.length}
              </span>
            )}
          </motion.button>
          
          {/* ================================================================
              НАВИГАЦИОННАЯ КНОПКА ВПРАВО (к потомку)
              ================================================================ */}
          <motion.button
            onClick={handleNavigateToChild}
            disabled={!hasChildren || isAnimating}
            className={cn(
              'absolute right-4 top-1/2 -translate-y-1/2 z-10',
              // Размер и форма - 56x56 как в ТЗ
              'w-14 h-14 rounded-full',
              // Flex для центрирования
              'flex items-center justify-center',
              // Transition
              'transition-all duration-200',
              // Фокус
              'focus:outline-none focus:ring-2 focus:ring-white/30',
              // Состояния
              hasChildren
                ? 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white hover:scale-110 active:scale-95 cursor-pointer'
                : 'bg-white/5 text-white/20 cursor-not-allowed'
            )}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ delay: 0.15, duration: 0.25 }}
            title={hasChildren 
              ? `${t.readingMode?.toChild || 'К потомку'} (→)${childNodes.length > 1 ? ` • ${childNodes.length}` : ''}`
              : t.readingMode?.noChildren || 'Нет потомков'
            }
          >
            <ChevronRight className="w-7 h-7" />
            {/* Badge с количеством потомков */}
            {childNodes.length > 1 && (
              <span className={cn(
                'absolute -top-1 -left-1',
                'min-w-5 h-5 px-1.5 rounded-full',
                'bg-purple-500 text-white text-xs font-bold',
                'flex items-center justify-center'
              )}>
                {childNodes.length}
              </span>
            )}
          </motion.button>
          
          {/* ================================================================
              КНОПКА НАЗАД (если есть история)
              ================================================================ */}
          {canGoBack && (
            <motion.button
              onClick={handleGoBack}
              disabled={isAnimating}
              className={cn(
                'absolute top-4 left-4 z-10',
                // Размер и форма
                'h-10 px-4 rounded-full',
                // Цвета и эффекты
                'bg-white/10 hover:bg-white/20',
                'text-white/80 hover:text-white',
                // Flex для центрирования
                'flex items-center gap-2',
                // Transition
                'transition-all duration-200 hover:scale-105 active:scale-95',
                // Фокус
                'focus:outline-none focus:ring-2 focus:ring-white/30'
              )}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ delay: 0.1, duration: 0.2 }}
              title={`${t.readingMode?.goBack || 'Назад'} (Backspace)`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="text-sm font-medium">{t.readingMode?.goBack || 'Назад'}</span>
            </motion.button>
          )}
          
          {/* ================================================================
              КОНТЕНТ КАРТОЧКИ
              ================================================================ */}
          <motion.div
            key={currentNodeId} // Важно для анимации при смене карточки
            className={cn(
              'relative z-10',
              // Ширина контента
              'w-full max-w-[900px]',
              // Максимальная высота с scroll
              'max-h-[85vh]',
              // Карточка
              'bg-card rounded-2xl shadow-2xl',
              // Overflow для scroll
              'overflow-hidden',
              // Тип карточки - разный цвет акцента
              isNoteNode 
                ? 'ring-2 ring-amber-500/30' 
                : 'ring-2 ring-primary/30'
            )}
            // Анимация контента
            initial={{ 
              opacity: 0, 
              scale: 0.95,
              x: direction === 'right' ? 100 : direction === 'left' ? -100 : 0
            }}
            animate={{ 
              opacity: 1, 
              scale: 1,
              x: 0
            }}
            exit={{ 
              opacity: 0, 
              scale: 0.95,
              x: direction === 'right' ? -100 : direction === 'left' ? 100 : 0
            }}
            transition={{ 
              duration: ANIMATION_DURATION / 1000, 
              ease: EASE_OUT 
            }}
            onAnimationComplete={handleAnimationComplete}
          >
            {/* Scrollable контейнер */}
            <div className="overflow-y-auto max-h-[85vh] p-6 sm:p-8">
              {/* ============================================================
                  PROGRESS INDICATOR
                  ============================================================ */}
              {branchProgress.total > 1 && (
                <div className="flex items-center justify-end mb-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all duration-300"
                          style={{ width: `${(branchProgress.current / branchProgress.total) * 100}%` }}
                        />
                      </div>
                      <span className="tabular-nums">
                        {branchProgress.current}/{branchProgress.total}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* ============================================================
                  HEADER - Тип карточки + Заголовок
                  ============================================================ */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                    {/* Бейдж типа карточки */}
                    <div className={cn(
                      'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium',
                      isNoteNode
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-primary/10 text-primary'
                    )}>
                      {isNoteNode ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" 
                            />
                          </svg>
                          <span>{t.readingMode?.noteCard || 'Заметка'}</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                              d="M13 10V3L4 14h7v7l9-11h-7z" 
                            />
                          </svg>
                          <span>AI карточка</span>
                        </>
                      )}
                    </div>

                    {/* ACTIONS FOR NOTE NODE */}
                    {isNoteNode && (
                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
                                    <button 
                                        onClick={handleCancelEditing}
                                        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                        title={t.common.cancel || 'Отмена'}
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={handleSaveEditing}
                                        className="p-1.5 rounded-full bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                                        title={t.common.save || 'Сохранить'}
                                    >
                                        <Save className="w-4 h-4" />
                                    </button>
                                </>
                            ) : (
                                <button 
                                    onClick={handleStartEditing}
                                    className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                    title={t.common.edit || 'Редактировать'}
                                >
                                    <Edit2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    )}
                </div>
                
                {/* Заголовок (prompt) */}
                {isEditing ? (
                    <TextareaAutosize 
                        value={localTitle} 
                        onChange={e => setLocalTitle(e.target.value)}
                        className="w-full text-xl sm:text-2xl font-bold bg-transparent border-b border-border focus:outline-none resize-none p-0 mb-2"
                        placeholder={t.noteNode?.titlePlaceholder || 'Заголовок'}
                    />
                ) : (
                    currentNode.data.prompt && (
                      <h1 className={cn(
                        'text-xl sm:text-2xl font-bold text-foreground',
                        // Увеличенный line-height для удобства чтения
                        'leading-relaxed'
                      )}>
                        {currentNode.data.prompt}
                      </h1>
                    )
                )}
              </div>
              
              {/* ============================================================
                  ЦИТАТА (если есть)
                  ============================================================ */}
              {/* Оранжевый цвет как у связи цитаты */}
              {currentNode.data.quote && (
                <div className={cn(
                  'mb-6 p-4 rounded-lg',
                  'bg-orange-50/50 dark:bg-orange-950/20 border-l-4 border-orange-500'
                )}>
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                        d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" 
                      />
                    </svg>
                    <span>{t.node?.quoteFromParent || 'Цитата'}</span>
                  </div>
                  <blockquote className="text-sm italic text-foreground/80 pl-2 border-l-2 border-muted-foreground/30">
                    &ldquo;{currentNode.data.quote}&rdquo;
                  </blockquote>
                </div>
              )}
              
              {/* ============================================================
                  ОСНОВНОЙ КОНТЕНТ (response)
                  ============================================================ */}
              {(currentNode.data.response || isEditing) && (
                <div className={cn(
                  // Prose стили для Markdown
                  'prose prose-sm sm:prose-base dark:prose-invert max-w-none',
                  // Увеличенный размер шрифта и межстрочный интервал для чтения
                  !isEditing && 'prose-p:text-base prose-p:leading-[1.8]',
                  !isEditing && 'prose-headings:mt-6 prose-headings:mb-3',
                  !isEditing && 'prose-ul:my-4 prose-ol:my-4',
                  !isEditing && 'prose-li:my-1',
                  // Код
                  !isEditing && 'prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded',
                  !isEditing && 'prose-pre:bg-muted prose-pre:p-4'
                )}>
                  {isEditing ? (
                      <TextareaAutosize 
                          value={localContent}
                          onChange={e => setLocalContent(e.target.value)}
                          minRows={10}
                          className="w-full bg-transparent border-none focus:outline-none resize-none text-base leading-relaxed p-0"
                          placeholder={t.noteNode?.contentPlaceholder || 'Write your note...'}
                      />
                   ) : (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {currentNode.data.response}
                      </ReactMarkdown>
                   )}
                </div>
              )}
              
              {/* Placeholder если нет контента */}
              {!currentNode.data.response && !currentNode.data.prompt && !isEditing && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>{t.noteNode?.emptyNote || 'Пустая карточка'}</p>
                </div>
              )}
            </div>
          </motion.div>
          
          {/* ================================================================
              SIDEBAR ДЛЯ ВЫБОРА КАРТОЧКИ (множественные связи)
              ================================================================ */}
          <AnimatePresence>
            {selectorSidebar && (
              <motion.div
                key="selector-sidebar"
                className={cn(
                  'absolute top-0 bottom-0 z-20',
                  // Ширина sidebar
                  'w-80 max-w-[85vw]',
                  // Позиция: слева для родителей, справа для потомков
                  selectorSidebar === 'parents' ? 'left-0' : 'right-0',
                  // Фон и стили
                  'bg-card/95 backdrop-blur-sm',
                  'border-r border-border',
                  selectorSidebar === 'children' && 'border-r-0 border-l',
                  // Shadow
                  'shadow-2xl'
                )}
                initial={{ 
                  x: selectorSidebar === 'parents' ? -320 : 320,
                  opacity: 0 
                }}
                animate={{ 
                  x: 0,
                  opacity: 1 
                }}
                exit={{ 
                  x: selectorSidebar === 'parents' ? -320 : 320,
                  opacity: 0 
                }}
                transition={{ duration: 0.3, ease: EASE_OUT }}
              >
                {/* Header sidebar */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">
                    {selectorSidebar === 'parents' 
                      ? t.readingMode?.selectParent || 'Выберите родителя'
                      : t.readingMode?.selectChild || 'Выберите потомка'
                    }
                  </h3>
                  <button
                    onClick={handleCloseSidebar}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                
                {/* Список карточек */}
                <div className="overflow-y-auto h-[calc(100%-57px)] p-2">
                  {(selectorSidebar === 'parents' ? parentNodes : childNodes).map((node) => (
                    <button
                      key={node.id}
                      onClick={() => handleSelectFromSidebar(node.id)}
                      className={cn(
                        'w-full text-left p-3 rounded-lg mb-2',
                        'bg-muted/50 hover:bg-muted',
                        'border border-transparent hover:border-border',
                        'transition-all duration-200',
                        'group'
                      )}
                    >
                      {/* Тип карточки */}
                      <div className={cn(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium mb-2',
                        node.type === 'note'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'bg-primary/10 text-primary'
                      )}>
                        {node.type === 'note' ? (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" 
                              />
                            </svg>
                            <span>{t.readingMode?.noteCard || 'Заметка'}</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                                d="M13 10V3L4 14h7v7l9-11h-7z" 
                              />
                            </svg>
                            <span>AI</span>
                          </>
                        )}
                      </div>
                      
                      {/* Заголовок (prompt) */}
                      <h4 className="text-sm font-medium text-foreground line-clamp-2 mb-1 group-hover:text-primary transition-colors">
                        {node.data.prompt || t.readingMode?.untitled || 'Без названия'}
                      </h4>
                      
                      {/* Snippet контента */}
                      {node.data.response && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {node.data.response.slice(0, 150)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>,
    portalContainer
  );
}

export default ReadingModeModal;
