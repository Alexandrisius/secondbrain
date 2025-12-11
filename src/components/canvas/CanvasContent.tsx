/**
 * @file CanvasContent.tsx
 * @description Внутренний компонент Canvas с React Flow
 * 
 * ВАЖНО: Этот компонент ДОЛЖЕН быть внутри ReactFlowProvider!
 * Разделение на CanvasWrapper и CanvasContent необходимо потому что
 * useReactFlow hook работает только внутри Provider.
 */

'use client';

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionLineType,
  useReactFlow,
  useStoreApi,
  SelectionMode,
  type OnConnectEnd,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import { Save, RefreshCw, X, Loader2, Undo2, Redo2 } from 'lucide-react';
import {
  useCanvasStore,
  markInitialDataLoaded,
  performUndo,
  performRedo,
  canUndo,
  canRedo,
  getUndoCount,
  getRedoCount,
} from '@/store/useCanvasStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { NeuroNode } from './NeuroNode';
import NoteNode from './NoteNode';
import { SettingsModal, SettingsButton } from './SettingsModal';
import { DonateModal, DonateButtonTrigger } from './DonateModal';
import { SearchBar } from './SearchBar';
import { ReadingModeModal } from './ReadingModeModal';
import { useReadingModeStore } from '@/store/useReadingModeStore';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode as NeuroNodeType } from '@/types/canvas';

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Регистрация кастомных типов нод
 * React Flow использует этот объект для рендеринга разных типов нод
 * 
 * Примечание: Используем типизацию с NodeTypes<NeuroNodeType> для корректной
 * передачи кастомных данных в NeuroNode компонент
 */
const nodeTypes = {
  neuro: NeuroNode,
  note: NoteNode,
} satisfies NodeTypes;

/**
 * Настройки fit view при инициализации
 */
const fitViewOptions = {
  padding: 0.2,
  maxZoom: 1.5,
};

/**
 * Дефолтные настройки для новых связей
 * Используем bezier для плавных кривых линий
 */
const defaultEdgeOptions = {
  type: 'default', // default = bezier в React Flow
  animated: false,
  style: {
    strokeWidth: 2,
  },
};

/**
 * УВЕЛИЧЕННЫЙ радиус для создания соединений
 * Позволяет соединять ноды не целясь точно в handle,
 * а просто наводя на область карточки
 */
const CONNECTION_RADIUS = 100;

/**
 * Смещение по Y для новой ноды при Drag-to-Create.
 * 
 * Нужно для того, чтобы курсор указывал точно на ЦЕНТР входного Handle,
 * а не на верхний левый угол карточки.
 * 
 * Handle позиционируется по центру question-section:
 * - question-section имеет padding: 16px (p-4)
 * - Внутри textarea с минимальной высотой ~46px
 * - Handle имеет top-1/2, т.е. центрируется по вертикали
 * 
 * Расчёт: padding-top (16px) + половина высоты контента (~23px) ≈ 39px
 */
const NEW_NODE_Y_OFFSET = 39;

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * CanvasContent - внутренний компонент с React Flow и всей логикой холста
 * 
 * Ключевые функции:
 * - Отображение нод и связей
 * - Drag-to-Create: создание новой ноды при отпускании связи на пустое место
 * - Double-Click-to-Create: создание ноды двойным кликом ТОЛЬКО на пустом холсте
 * - Управление взаимодействием (pan, zoom, select)
 * - Удаление выделенных нод и связей через Delete/Backspace
 */
export function CanvasContent() {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================

  const { t, language } = useTranslation();

  // ===========================================================================
  // REACT FLOW HOOKS
  // ===========================================================================

  /**
   * useReactFlow даёт доступ к методам управления viewport
   * ВАЖНО: Должен использоваться только внутри ReactFlowProvider!
   * 
   * setCenter - плавно центрирует viewport на указанных координатах
   */
  const { screenToFlowPosition, getViewport, setViewport, setCenter } = useReactFlow();

  /**
   * useStoreApi даёт доступ к внутреннему store React Flow
   * 
   * Используется для сброса внутреннего состояния selection rectangle
   * (nodesSelectionActive) после программного создания ноды.
   * 
   * Без этого после создания ноды через Tab из множественного выделения
   * остаётся активным NodesSelection rect, который блокирует взаимодействие.
   */
  const addNoteNode = useCanvasStore((s) => s.addNoteNode);

  /**
   * useStoreApi даёт доступ к внутреннему store React Flow
   * 
   * Используется для сброса внутреннего состояния selection rectangle
   * (nodesSelectionActive) после программного создания ноды.
   * 
   * Без этого после создания ноды через Tab из множественного выделения
   * остаётся активным NodesSelection rect, который блокирует взаимодействие.
   */
  const store = useStoreApi();

  // ===========================================================================
  // СОСТОЯНИЕ ДЛЯ ПРОГРАММНОГО PAN (ПКМ на нодах)
  // ===========================================================================

  /**
   * Флаг: идёт ли программный pan (зажата ПКМ)
   */
  const [isPanningWithRMB, setIsPanningWithRMB] = useState(false);

  /**
   * Начальная позиция мыши при старте pan
   */
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  // ===========================================================================
  // СОСТОЯНИЕ ДЛЯ ДИНАМИЧЕСКОГО РЕЖИМА ВЫДЕЛЕНИЯ
  // ===========================================================================

  /**
   * Режим выделения:
   * - Full: выделяются только ноды, ПОЛНОСТЬЮ попавшие в рамку (слева направо)
   * - Partial: выделяются ноды, ЧАСТИЧНО пересекающие рамку (справа налево)
   */
  const [selectionMode, setSelectionMode] = useState<SelectionMode>(SelectionMode.Full);

  /**
   * Состояние модального окна настроек
   * true - окно открыто, false - закрыто
   */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  /**
   * Состояние модального окна донатов/поддержки
   * true - окно открыто, false - закрыто
   */
  const [isDonateOpen, setIsDonateOpen] = useState(false);

  /**
   * Состояние поисковой панели (семантический поиск)
   * Открывается по Ctrl+P или кликом на кнопку поиска
   */
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  /**
   * Флаг: идёт ли процесс выделения рамкой
   * Используется для показа/скрытия рамки и CSS классов
   */
  const [isSelecting, setIsSelecting] = useState(false);

  /**
   * Флаг: идёт ли процесс создания связи (тянем от Handle)
   * Используется для блокировки выделения текста на других карточках
   */
  const [isConnecting, setIsConnecting] = useState(false);

  /**
   * Начальная точка выделения (экранные координаты)
   * Используется для определения направления выделения
   */
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);

  // ===========================================================================
  // СОСТОЯНИЕ UNDO/REDO
  // ===========================================================================

  /**
   * Количество доступных шагов для Undo
   * Обновляется при изменениях в истории
   */
  const [undoSteps, setUndoSteps] = useState(0);

  /**
   * Количество доступных шагов для Redo
   * Обновляется при изменениях в истории
   */
  const [redoSteps, setRedoSteps] = useState(0);

  // ===========================================================================
  // ZUSTAND STORE
  // ===========================================================================

  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const addNode = useCanvasStore((s) => s.addNode);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const setPendingFocusNodeId = useCanvasStore((s) => s.setPendingFocusNodeId);

  /**
   * Actions для быстрого создания карточек по горячим клавишам
   * Работают как из textarea (в NeuroNode), так и при выделении карточки (здесь)
   */
  const createLinkedNodeRight = useCanvasStore((s) => s.createLinkedNodeRight);
  const createSiblingNode = useCanvasStore((s) => s.createSiblingNode);

  // ===========================================================================
  // ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Снятие выделения со всех и выделение новой
  // ===========================================================================

  /**
   * Снимает выделение со ВСЕХ карточек и выделяет только указанную
   * 
   * ВАЖНО: Используется при создании новых карточек, чтобы гарантировать,
   * что выделена ТОЛЬКО новая карточка. Это предотвращает случайное
   * удаление нескольких карточек при нажатии Delete.
   * 
   * @param newNodeId - ID новой карточки для выделения
   */
  const deselectAllAndSelect = useCallback(
    (newNodeId: string) => {
      const selectionChanges = [
        // Снимаем выделение со всех выделенных нод
        ...nodes
          .filter((n) => n.selected)
          .map((n) => ({ type: 'select' as const, id: n.id, selected: false })),
        // Выделяем новую ноду
        { type: 'select' as const, id: newNodeId, selected: true },
      ];

      onNodesChange(selectionChanges);
    },
    [nodes, onNodesChange]
  );

  /**
   * Action для создания карточки от нескольких родителей
   * Вызывается по Tab при выделении нескольких карточек рамкой
   */
  const createNodeFromMultipleParents = useCanvasStore((s) => s.createNodeFromMultipleParents);

  /**
   * Action для переключения раскрытия/сворачивания ответной части карточки
   * Вызывается по пробелу при выделенной карточке
   */
  const toggleSelectedNodesAnswerExpanded = useCanvasStore((s) => s.toggleSelectedNodesAnswerExpanded);

  /**
   * Action для открытия режима чтения
   */
  const openReadingMode = useReadingModeStore((s) => s.openReadingMode);

  // ===========================================================================
  // СОСТОЯНИЕ ПАКЕТНОЙ РЕГЕНЕРАЦИИ
  // ===========================================================================

  /**
   * Флаг: идёт ли пакетная регенерация
   */
  const isBatchRegenerating = useCanvasStore((s) => s.isBatchRegenerating);

  /**
   * Прогресс пакетной регенерации
   */
  const batchRegenerationProgress = useCanvasStore((s) => s.batchRegenerationProgress);

  /**
   * Запустить пакетную регенерацию
   */
  const regenerateStaleNodes = useCanvasStore((s) => s.regenerateStaleNodes);

  /**
   * Отменить пакетную регенерацию
   */
  const cancelBatchRegeneration = useCanvasStore((s) => s.cancelBatchRegeneration);

  // ===========================================================================
  // СОСТОЯНИЕ ПЕРСИСТЕНТНОСТИ
  // ===========================================================================

  const isLoading = useCanvasStore((s) => s.isLoading);
  const isSaving = useCanvasStore((s) => s.isSaving);
  const lastSaved = useCanvasStore((s) => s.lastSaved);
  const hasUnsavedChanges = useCanvasStore((s) => s.hasUnsavedChanges);
  const persistError = useCanvasStore((s) => s.persistError);
  const loadFromFile = useCanvasStore((s) => s.loadFromFile);
  const saveToFile = useCanvasStore((s) => s.saveToFile);
  const clearPersistError = useCanvasStore((s) => s.clearPersistError);

  /**
   * ID ноды, на которую нужно центрировать холст
   * Устанавливается при создании новой карточки через Tab или Ctrl+Enter
   */
  const pendingCenterNodeId = useCanvasStore((s) => s.pendingCenterNodeId);

  /**
   * Сброс pendingCenterNodeId после центрирования
   */
  const clearPendingCenter = useCanvasStore((s) => s.clearPendingCenter);

  // ===========================================================================
  // REFS
  // ===========================================================================

  /**
   * Ref на контейнер React Flow для вычисления координат
   */
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  /**
   * Ref для отслеживания первой загрузки
   * Предотвращает повторную загрузку при hot reload
   */
  const hasLoadedRef = useRef(false);

  // ===========================================================================
  // ПОЛУЧЕНИЕ АКТИВНОГО ХОЛСТА ИЗ WORKSPACE
  // ===========================================================================

  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);

  // ===========================================================================
  // ЗАГРУЗКА ДАННЫХ ПРИ МОНТИРОВАНИИ ИЛИ СМЕНЕ ХОЛСТА
  // ===========================================================================

  /**
   * Загружаем данные холста при первом рендере или смене activeCanvasId
   * После успешной загрузки активируем автосохранение
   */
  useEffect(() => {
    // Если нет активного холста - не загружаем
    if (!activeCanvasId) return;

    // Проверяем: если это тот же холст что уже загружен - пропускаем
    const currentCanvasId = useCanvasStore.getState().currentCanvasId;
    if (currentCanvasId === activeCanvasId && hasLoadedRef.current) return;

    const initializeData = async () => {
      console.log(`[CanvasContent] Загрузка холста ${activeCanvasId}...`);
      await loadFromFile(activeCanvasId);
      // После загрузки активируем автосохранение
      markInitialDataLoaded();
      hasLoadedRef.current = true;
      console.log('[CanvasContent] Автосохранение активировано');
    };

    initializeData();
  }, [activeCanvasId, loadFromFile]);

  // ===========================================================================
  // ЦЕНТРИРОВАНИЕ ХОЛСТА НА НОВОЙ НОДЕ
  // ===========================================================================

  /**
   * Центрирование холста при создании новой карточки (Tab или Ctrl+Enter)
   * 
   * Когда pendingCenterNodeId установлен:
   * 1. Находим ноду по ID
   * 2. Центрируем viewport на позиции ноды с плавной анимацией
   * 3. Сбрасываем pendingCenterNodeId
   * 
   * Это обеспечивает плавный переход внимания на новую карточку
   */
  useEffect(() => {
    if (!pendingCenterNodeId) return;

    // Находим ноду для центрирования
    const targetNode = nodes.find((n) => n.id === pendingCenterNodeId);

    if (targetNode) {
      // Небольшая задержка для завершения рендера новой ноды
      const timer = setTimeout(() => {
        // Центрируем на позиции ноды
        // Добавляем смещение на половину ширины карточки для точного центрирования
        const CARD_WIDTH = 400;
        const CARD_HEIGHT_ESTIMATE = 150;

        setCenter(
          targetNode.position.x + CARD_WIDTH / 2,
          targetNode.position.y + CARD_HEIGHT_ESTIMATE / 2,
          {
            duration: 300,  // Плавная анимация 300ms
            zoom: 1,        // Сохраняем текущий масштаб (или сбрасываем на 1)
          }
        );

        // Сбрасываем pendingCenterNodeId
        clearPendingCenter();

        console.log('[CanvasContent] Центрирование на ноде:', pendingCenterNodeId);
      }, 100);

      return () => clearTimeout(timer);
    } else {
      // Нода не найдена - сбрасываем
      clearPendingCenter();
    }
  }, [pendingCenterNodeId, nodes, setCenter, clearPendingCenter]);

  // ===========================================================================
  // ПРОГРАММНЫЙ PAN ПРИ ЗАЖАТОЙ ПКМ (работает даже на нодах)
  // ===========================================================================

  /**
   * Глобальный обработчик для программного pan при зажатой ПКМ
   * 
   * КРИТИЧНО: Этот подход позволяет pan'ить холст даже когда курсор над нодой!
   * React Flow по умолчанию не позволяет pan через ноды, поэтому мы делаем это программно.
   * 
   * Логика:
   * 1. При pointerdown с ПКМ на ноде - запоминаем позицию и включаем режим pan
   * 2. При pointermove - вычисляем delta и обновляем viewport
   * 3. При pointerup - выключаем режим pan
   */
  useEffect(() => {
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;

    /**
     * Обработчик нажатия мыши
     * При ПКМ на ноде - начинаем программный pan
     */
    const handlePointerDown = (e: PointerEvent) => {
      // Только ПКМ (button === 2)
      if (e.button !== 2) return;

      // Проверяем что клик на ноде (не на пустом месте - там React Flow сам pan'ит)
      const target = e.target as Element;
      const isOnNode = target.closest('.react-flow__node');

      if (isOnNode) {
        // Начинаем программный pan
        setIsPanningWithRMB(true);
        panStartRef.current = { x: e.clientX, y: e.clientY };

        // Предотвращаем контекстное меню
        e.preventDefault();
      }
    };

    /**
     * Обработчик движения мыши
     * При активном pan - обновляем viewport
     */
    const handlePointerMove = (e: PointerEvent) => {
      if (!isPanningWithRMB || !panStartRef.current) return;

      // Вычисляем смещение мыши
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;

      // Получаем текущий viewport
      const viewport = getViewport();

      // Обновляем viewport с учётом смещения
      // ВАЖНО: при zoom !== 1 нужно учитывать масштаб
      setViewport({
        x: viewport.x + deltaX,
        y: viewport.y + deltaY,
        zoom: viewport.zoom,
      });

      // Обновляем стартовую позицию для следующего движения
      panStartRef.current = { x: e.clientX, y: e.clientY };
    };

    /**
     * Обработчик отпускания мыши
     * Завершаем программный pan
     */
    const handlePointerUp = (e: PointerEvent) => {
      if (e.button === 2 && isPanningWithRMB) {
        setIsPanningWithRMB(false);
        panStartRef.current = null;
      }
    };

    /**
     * Предотвращаем контекстное меню при ПКМ на ноде
     */
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      const isOnNode = target.closest('.react-flow__node');
      
      // Не блокируем контекстное меню в текстовых полях (для копирования/вставки)
      const isEditableElement = target.tagName === 'TEXTAREA' || 
                                target.tagName === 'INPUT' ||
                                (target as HTMLElement).isContentEditable;

      // Блокируем только для нод, но не для редактируемых элементов
      if (isOnNode && !isEditableElement) {
        e.preventDefault();
      }
    };

    // Добавляем обработчики
    wrapper.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    wrapper.addEventListener('contextmenu', handleContextMenu);

    return () => {
      wrapper.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      wrapper.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [isPanningWithRMB, getViewport, setViewport]);

  // ===========================================================================
  // ГЛОБАЛЬНЫЙ ОБРАБОТЧИК DELETE для нод И связей
  // ===========================================================================

  /**
   * Глобальный обработчик Delete/Backspace для удаления выделенных нод И связей
   * 
   * КРИТИЧНО: Работает ТОЛЬКО когда фокус НЕ на текстовом поле!
   * При редактировании текста Delete/Backspace должны удалять символы,
   * а не ноды. Для удаления ноды при редактировании - сначала Escape (blur),
   * затем Delete.
   * 
   * Проверки:
   * 1. Активный элемент - INPUT или TEXTAREA
   * 2. Активный элемент - contentEditable
   * 3. Активный элемент находится внутри .neuro-node (дополнительная защита)
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Проверяем что нажата Delete или Backspace
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;

      // Проверяем что не редактируем текст - УЛУЧШЕННАЯ ПРОВЕРКА
      const activeElement = document.activeElement as HTMLElement | null;

      // Проверка 1: Стандартные текстовые элементы
      const isStandardTextInput =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA';

      // Проверка 2: ContentEditable элементы
      const isContentEditable = activeElement?.isContentEditable === true;

      // Проверка 3: Элемент внутри ноды (textarea может быть вложенным)
      const isInsideNode = activeElement?.closest('.neuro-node') !== null;

      // Проверка 4: Элемент с классами nodrag (явно помечен как область ввода)
      const hasNoDragClass = activeElement?.classList.contains('nodrag');

      // Если любая из проверок true - не удаляем ноду
      if (isStandardTextInput || isContentEditable || (isInsideNode && hasNoDragClass)) {
        // Не блокируем событие - пусть браузер обработает удаление символа
        return;
      }

      // Находим выделенные ноды
      const selectedNodes = nodes.filter((n) => n.selected);

      // Находим выделенные связи
      const selectedEdges = edges.filter((e) => e.selected);

      // Если есть что удалять - предотвращаем дефолтное поведение
      if (selectedNodes.length > 0 || selectedEdges.length > 0) {
        event.preventDefault();

        // Удаляем все выделенные ноды
        selectedNodes.forEach((node) => {
          removeNode(node.id);
        });

        // Удаляем все выделенные связи через onEdgesChange
        if (selectedEdges.length > 0) {
          const edgeChanges = selectedEdges.map((edge) => ({
            type: 'remove' as const,
            id: edge.id,
          }));
          onEdgesChange(edgeChanges);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges, removeNode, onEdgesChange]);

  // ===========================================================================
  // ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ГОРЯЧИХ КЛАВИШ ДЛЯ ВЫДЕЛЕННЫХ НОД
  // ===========================================================================

  /**
   * Глобальный обработчик горячих клавиш для выделенных карточек
   * 
   * Работает когда карточка ВЫДЕЛЕНА (selected), но фокус НЕ в textarea.
   * Это дополняет обработчики в NeuroNode.tsx, которые работают при фокусе в textarea.
   * 
   * ГОРЯЧИЕ КЛАВИШИ:
   * - Tab (без Shift): создаёт дочернюю карточку справа (если есть ответ)
   * - Ctrl+Enter (или Cmd+Enter): создаёт сестринскую карточку (если есть родитель и ответ)
   * - Space (пробел): сворачивает/разворачивает ответную часть карточки
   * 
   * УСЛОВИЯ РАБОТЫ:
   * - Фокус НЕ на текстовом поле (textarea, input, contentEditable)
   * - Есть выделенная карточка
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // =======================================================================
      // ПРОВЕРКА: Не редактируем текст
      // =======================================================================
      const activeElement = document.activeElement as HTMLElement | null;

      // Проверка 1: Стандартные текстовые элементы
      const isStandardTextInput =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA';

      // Проверка 2: ContentEditable элементы
      const isContentEditable = activeElement?.isContentEditable === true;

      // Проверка 3: Элемент с классом nodrag внутри ноды (явно помечен как область ввода)
      const isInsideNodeWithNoDrag =
        activeElement?.closest('.neuro-node') !== null &&
        activeElement?.classList.contains('nodrag');

      // Если фокус на текстовом поле - не обрабатываем (там свои хендлеры в NeuroNode)
      if (isStandardTextInput || isContentEditable || isInsideNodeWithNoDrag) {
        return;
      }

      // =======================================================================
      // НАХОДИМ ВЫДЕЛЕННЫЕ НОДЫ
      // =======================================================================
      const selectedNodes = nodes.filter((n) => n.selected);

      // Если нет выделенных нод - ничего не делаем
      if (selectedNodes.length === 0) return;

      // =======================================================================
      // TAB - СОЗДАНИЕ ДОЧЕРНЕЙ КАРТОЧКИ
      // При нескольких выделенных - карточка от всех родителей
      // При одной выделенной - стандартная логика
      // =======================================================================
      if (event.key === 'Tab' && !event.shiftKey) {
        // Фильтруем только ноды с ответом и без активной генерации
        const nodesWithResponse = selectedNodes.filter(
          (n) => n.data.response && !n.data.isGenerating
        );

        // Если есть хотя бы одна нода с ответом
        if (nodesWithResponse.length > 0) {
          event.preventDefault();

          // КРИТИЧНО: Сбрасываем внутреннее состояние selection rectangle
          // Без этого NodesSelection rect остаётся активным и блокирует
          // взаимодействие с новой нодой (перемещение, удаление)
          store.setState({ nodesSelectionActive: false });

          if (nodesWithResponse.length >= 2) {
            // МНОЖЕСТВЕННЫЕ РОДИТЕЛИ: создаём карточку от всех выделенных
            const nodeIds = nodesWithResponse.map((n) => n.id);
            createNodeFromMultipleParents(nodeIds);
            console.log('[CanvasContent] Tab: создана карточка от нескольких родителей:', nodeIds);
          } else {
            // ОДИН РОДИТЕЛЬ: стандартная логика
            createLinkedNodeRight(nodesWithResponse[0].id);
            console.log('[CanvasContent] Tab: создана дочерняя карточка от', nodesWithResponse[0].id);
          }
        }
        return;
      }

      // Для остальных хоткеев используем первую выделенную ноду
      const selectedNode = selectedNodes[0];

      // Проверяем что у ноды есть ответ и не идёт генерация
      const hasResponse = Boolean(selectedNode.data.response);
      const isGenerating = selectedNode.data.isGenerating;

      // =======================================================================
      // CTRL+ENTER - СОЗДАНИЕ СЕСТРИНСКОЙ КАРТОЧКИ
      // =======================================================================
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        // КРИТИЧНО: Полностью блокируем событие, чтобы React Flow не снял выделение
        event.preventDefault();
        event.stopPropagation();

        // Условия: есть ответ, есть родитель, не идёт генерация
        const hasParent = Boolean(selectedNode.data.parentId);

        if (hasResponse && !isGenerating && hasParent) {
          createSiblingNode(selectedNode.id);
          console.log('[CanvasContent] Ctrl+Enter: создана сестринская карточка от', selectedNode.id);
        }
        return;
      }

      // =======================================================================
      // F2 - ОТКРЫТИЕ РЕЖИМА ЧТЕНИЯ
      // =======================================================================
      if (event.key === 'F2') {
        const nodeWithResponse = selectedNodes.find(n => n.data.response);
        if (nodeWithResponse) {
          event.preventDefault();
          openReadingMode(nodeWithResponse.id);
          console.log('[CanvasContent] F2: открытие режима чтения');
        }
        return;
      }

      // =======================================================================
      // SPACE - СВОРАЧИВАНИЕ/РАЗВОРАЧИВАНИЕ ОТВЕТНОЙ ЧАСТИ (МАССОВОЕ)
      // =======================================================================
      if (event.key === ' ' || event.code === 'Space') {
        const canToggle = selectedNodes.some(n => n.data.response || n.data.isGenerating);

        if (canToggle) {
          event.preventDefault();
          toggleSelectedNodesAnswerExpanded();
          console.log('[CanvasContent] Space: массовое переключение ответной части');
        }
        return;
      }
    };

    // КРИТИЧНО: Используем capture phase (true), чтобы перехватить событие
    // ДО того, как оно достигнет React Flow и снимет выделение
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [nodes, createLinkedNodeRight, createSiblingNode, createNodeFromMultipleParents, toggleSelectedNodesAnswerExpanded, openReadingMode, store]);

  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================

  /**
   * Автовыделение ноды при начале перетаскивания
   * 
   * UX: Когда пользователь начинает двигать карточку, она автоматически
   * становится выделенной. Это более интуитивное поведение - если я
   * взаимодействую с карточкой, она должна быть выделена.
   * 
   * @param event - событие мыши/тача
   * @param node - нода, которую начали перетаскивать
   */
  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, node: NeuroNodeType) => {
      // Если нода уже выделена - ничего не делаем
      if (node.selected) return;

      // Выделяем ноду через onNodesChange
      onNodesChange([
        { type: 'select', id: node.id, selected: true },
      ]);
    },
    [onNodesChange]
  );

  /**
   * Обработчик НАЧАЛА создания связи
   * 
   * Устанавливает флаг isConnecting = true, который добавляет CSS класс
   * для блокировки выделения текста на других карточках.
   */
  const handleConnectStart = useCallback(() => {
    setIsConnecting(true);
  }, []);

  /**
   * DRAG-TO-CREATE: Создание новой ноды при отпускании связи на пустое место
   * 
   * Логика:
   * 1. Пользователь начинает тянуть связь от ноды
   * 2. Отпускает на пустом месте (не на другой ноде)
   * 3. Мы создаём новую ноду в этой точке и соединяем её с исходной
   * 
   * Также сбрасывает флаг isConnecting для разблокировки выделения текста.
   * 
   * @param event - событие мыши/тача
   * @param connectionState - состояние незавершённого соединения
   */
  const handleConnectEnd: OnConnectEnd = useCallback(
    (event, connectionState) => {
      // Сбрасываем флаг соединения - разблокируем выделение текста
      setIsConnecting(false);
      // Проверяем, что соединение не завершилось на другой ноде
      // isValid === true означает что пользователь отпустил на handle другой ноды
      if (connectionState.isValid) {
        return; // Ничего не делаем, стандартное соединение обработается через onConnect
      }

      // Получаем ID ноды, от которой началось соединение
      const fromNodeId = connectionState.fromNode?.id;
      if (!fromNodeId) return;

      // Определяем координаты клика
      // Поддерживаем и MouseEvent и TouchEvent
      let clientX: number;
      let clientY: number;

      if ('clientX' in event) {
        // MouseEvent
        clientX = event.clientX;
        clientY = event.clientY;
      } else if ('changedTouches' in event && event.changedTouches.length > 0) {
        // TouchEvent
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
      } else {
        return; // Неизвестный тип события
      }

      // Конвертируем экранные координаты в координаты Flow
      // screenToFlowPosition учитывает текущий zoom и pan
      const position = screenToFlowPosition({
        x: clientX,
        y: clientY,
      });

      // КОРРЕКТИРОВКА ПОЗИЦИИ: Смещаем ноду вверх, чтобы центр входного Handle
      // (target, слева) оказался точно под курсором мыши.
      // Без этого смещения курсор указывает на верхний левый угол карточки.
      position.y -= NEW_NODE_Y_OFFSET;

      // Создаём новую ноду и связываем с родителем
      const newNodeId = addNode(position, fromNodeId);

      // Снимаем выделение со ВСЕХ нод и выделяем ТОЛЬКО новую
      // Это поведение согласовано с Tab (createLinkedNodeRight)
      // и предотвращает случайное удаление нескольких карточек
      deselectAllAndSelect(newNodeId);

      // Устанавливаем автофокус на textarea новой ноды
      // Это позволяет сразу начать вводить текст
      setPendingFocusNodeId(newNodeId);
    },
    [screenToFlowPosition, addNode, deselectAllAndSelect, setPendingFocusNodeId]
  );

  // ===========================================================================
  // ДИНАМИЧЕСКИЙ РЕЖИМ ВЫДЕЛЕНИЯ В ЗАВИСИМОСТИ ОТ НАПРАВЛЕНИЯ
  // ===========================================================================

  /**
   * Обработчик начала выделения рамкой
   * 
   * Запоминаем начальную точку для определения направления.
   * Направление определяется по движению мыши:
   * - Слева направо (x увеличивается) → Full mode (полное включение)
   * - Справа налево (x уменьшается) → Partial mode (пересечение)
   */
  useEffect(() => {
    const wrapper = reactFlowWrapper.current;
    if (!wrapper) return;

    /**
     * Обработчик нажатия мыши - запоминаем начальную точку
     * Работает только для ЛКМ на пустом месте холста
     */
    const handleMouseDown = (e: MouseEvent) => {
      // Только ЛКМ
      if (e.button !== 0) return;

      // Проверяем что клик на пустом месте (не на ноде)
      const target = e.target as Element;
      const isOnPane = target.classList.contains('react-flow__pane') ||
        target.classList.contains('react-flow__background') ||
        target.closest('.react-flow__pane');
      const isOnNode = target.closest('.react-flow__node');
      const isOnControls = target.closest('.react-flow__controls') ||
        target.closest('.react-flow__minimap');

      if (isOnPane && !isOnNode && !isOnControls) {
        // Запоминаем начальную точку выделения
        selectionStartRef.current = { x: e.clientX, y: e.clientY };
        setIsSelecting(true);
        // По умолчанию - Full mode (слева направо)
        setSelectionMode(SelectionMode.Full);
      }
    };

    /**
     * Обработчик движения мыши - определяем направление выделения
     */
    const handleMouseMove = (e: MouseEvent) => {
      // Только если идёт выделение
      if (!selectionStartRef.current || !isSelecting) return;

      // Вычисляем смещение от начальной точки
      const deltaX = e.clientX - selectionStartRef.current.x;

      // Определяем режим по направлению:
      // - Положительный deltaX (вправо) → Full mode
      // - Отрицательный deltaX (влево) → Partial mode
      const newMode = deltaX >= 0 ? SelectionMode.Full : SelectionMode.Partial;

      // Обновляем только если режим изменился
      if (newMode !== selectionMode) {
        setSelectionMode(newMode);
      }
    };

    /**
     * Обработчик отпускания мыши - завершаем выделение
     */
    const handleMouseUp = () => {
      if (selectionStartRef.current) {
        selectionStartRef.current = null;
        // Небольшая задержка перед скрытием, чтобы выделение успело примениться
        setTimeout(() => {
          setIsSelecting(false);
        }, 50);
      }
    };

    // Добавляем обработчики
    wrapper.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      wrapper.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSelecting, selectionMode]);

  // ===========================================================================
  // ГЛОБАЛЬНЫЙ ОБРАБОТЧИК CTRL+P (СЕМАНТИЧЕСКИЙ ПОИСК)
  // ===========================================================================

  /**
   * Глобальный обработчик Ctrl+P / Cmd+P для открытия семантического поиска
   * 
   * ВАЖНО: 
   * - Предотвращаем дефолтное поведение браузера (печать)
   * - Используем event.code вместо event.key для поддержки разных раскладок
   *   (Ctrl+P на английской = Ctrl+З на русской = KeyP)
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Проверяем Ctrl+P или Cmd+P (Mac)
      // Используем event.code ('KeyP') вместо event.key ('p'/'з')
      // для корректной работы на любой раскладке
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyP') {
        // Предотвращаем дефолтное поведение (диалог печати)
        event.preventDefault();
        event.stopPropagation();

        // Открываем поиск
        setIsSearchOpen(true);

        console.log('[CanvasContent] Ctrl+P: открытие семантического поиска');
      }
    };

    // Используем capture phase для перехвата до браузера
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // ===========================================================================
  // ГЛОБАЛЬНЫЙ ОБРАБОТЧИК F2 (РЕЖИМ ЧТЕНИЯ)
  // ===========================================================================
  // ГЛОБАЛЬНЫЙ ОБРАБОТЧИК CTRL+Z / CTRL+Y (UNDO/REDO)
  // ===========================================================================

  /**
   * Глобальный обработчик Ctrl+Z / Cmd+Z для Undo
   * и Ctrl+Y / Cmd+Y или Ctrl+Shift+Z / Cmd+Shift+Z для Redo
   * 
   * ВАЖНО:
   * - Работает только когда фокус НЕ в текстовом поле
   * - Используем event.code для независимости от раскладки
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Проверяем что не редактируем текст
      const activeElement = document.activeElement as HTMLElement | null;
      const isTextInput =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.isContentEditable === true;

      // Если фокус в текстовом поле - пропускаем (браузер сам обработает undo/redo)
      if (isTextInput) {
        return;
      }

      // Проверяем модификаторы (Ctrl или Cmd)
      const isMod = event.ctrlKey || event.metaKey;
      if (!isMod) return;

      // =======================================================================
      // UNDO: Ctrl+Z / Cmd+Z
      // =======================================================================
      if (event.code === 'KeyZ' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();

        if (canUndo()) {
          performUndo();
          // Обновляем состояние после операции
          setUndoSteps(getUndoCount());
          setRedoSteps(getRedoCount());
          console.log('[CanvasContent] Ctrl+Z: Undo выполнен');
        }
        return;
      }

      // =======================================================================
      // REDO: Ctrl+Y / Cmd+Y или Ctrl+Shift+Z / Cmd+Shift+Z
      // =======================================================================
      if (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();

        if (canRedo()) {
          performRedo();
          // Обновляем состояние после операции
          setUndoSteps(getUndoCount());
          setRedoSteps(getRedoCount());
          console.log('[CanvasContent] Ctrl+Y/Ctrl+Shift+Z: Redo выполнен');
        }
        return;
      }
    };

    // Используем capture phase для перехвата до других обработчиков
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // ===========================================================================
  // ОБНОВЛЕНИЕ СОСТОЯНИЯ UNDO/REDO ПРИ ИЗМЕНЕНИЯХ
  // ===========================================================================

  /**
   * Подписка на изменения в store для обновления счётчиков undo/redo
   * Используем интервал для периодической проверки (простой и надёжный способ)
   */
  useEffect(() => {
    // Начальное обновление
    setUndoSteps(getUndoCount());
    setRedoSteps(getRedoCount());

    // Периодическое обновление каждые 500ms
    const interval = setInterval(() => {
      setUndoSteps(getUndoCount());
      setRedoSteps(getRedoCount());
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // ===========================================================================
  // ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ДВОЙНОГО КЛИКА
  // ===========================================================================

  /**
   * Глобальный обработчик двойного клика для создания новой ноды
   * Используем нативный обработчик на document, проверяем что клик на pane/background
   */
  useEffect(() => {
    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Проверяем что клик был на пустом месте холста
      // (на элементе с классом react-flow__pane или react-flow__background)
      const isPane = target.classList.contains('react-flow__pane') ||
        target.classList.contains('react-flow__background') ||
        target.closest('.react-flow__pane');

      // Проверяем что это НЕ клик на ноде или элементах управления
      const isNode = target.closest('.react-flow__node');
      const isControls = target.closest('.react-flow__controls') ||
        target.closest('.react-flow__minimap');

      if (isPane && !isNode && !isControls) {
        // Конвертируем экранные координаты в координаты Flow
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        // Создаём новую независимую ноду (без родителя)
        const newNodeId = addNode(position);

        // Снимаем выделение со ВСЕХ нод и выделяем ТОЛЬКО новую
        // Предотвращает случайное удаление нескольких карточек при Delete
        deselectAllAndSelect(newNodeId);

        // Автоматически фокусируемся на новой ноде
        setPendingFocusNodeId(newNodeId);
      }
    };

    // Добавляем обработчик на wrapper элемент
    const wrapper = reactFlowWrapper.current;
    if (wrapper) {
      wrapper.addEventListener('dblclick', handleDoubleClick);
      return () => wrapper.removeEventListener('dblclick', handleDoubleClick);
    }
  }, [screenToFlowPosition, addNode, deselectAllAndSelect, setPendingFocusNodeId]);

  // ===========================================================================
  // ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: Форматирование времени
  // ===========================================================================

  // ===========================================================================
  // ВЫЧИСЛЕНИЕ КОЛИЧЕСТВА УСТАРЕВШИХ КАРТОЧЕК
  // ===========================================================================

  /**
   * Количество устаревших (stale) карточек
   * Пересчитывается при изменении nodes
   */
  const staleNodesCount = useMemo(() => {
    return nodes.filter((n) => n.data.isStale && n.data.response).length;
  }, [nodes]);

  /**
   * Форматирует timestamp в читаемое время
   * @param timestamp - временная метка в мс
   * @returns Строка вида "HH:MM:SS" или пустая строка
   */
  const formatTime = (timestamp: number | null): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    // Используем локаль в зависимости от выбранного языка
    const locale = language === 'ru' ? 'ru-RU' : 'en-US';
    return date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  /**
   * ID карточки для фокусировки после загрузки холста (при переходе через поиск)
   * Хранится в STORE (не в локальном state), чтобы пережить перемонтирование компонента
   */
  const searchTargetNodeId = useCanvasStore((s) => s.searchTargetNodeId);
  const setSearchTargetNodeId = useCanvasStore((s) => s.setSearchTargetNodeId);

  /**
   * Эффект для фокусировки на карточке после загрузки холста
   * Срабатывает когда загружен холст и есть ожидающая карточка (из поиска)
   * 
   * ВАЖНО: Сбрасываем searchTargetNodeId ТОЛЬКО когда карточка найдена!
   * Иначе при первом срабатывании со старыми nodes он сбросится,
   * и когда загрузятся новые nodes - уже будет null.
   */
  useEffect(() => {
    if (searchTargetNodeId && !isLoading && nodes.length > 0) {
      const targetNode = nodes.find((n) => n.id === searchTargetNodeId);

      // Карточка найдена - обрабатываем и сбрасываем
      if (targetNode) {
        const CARD_WIDTH = 400;
        const CARD_HEIGHT_ESTIMATE = 150;
        const targetX = targetNode.position.x + CARD_WIDTH / 2;
        const targetY = targetNode.position.y + CARD_HEIGHT_ESTIMATE / 2;
        const nodeIdToSelect = searchTargetNodeId;

        // Выделяем карточку сразу
        onNodesChange([
          // Снимаем выделение со всех
          ...nodes.filter((n) => n.selected).map((n) => ({
            type: 'select' as const,
            id: n.id,
            selected: false,
          })),
          // Выделяем целевую
          { type: 'select' as const, id: nodeIdToSelect, selected: true },
        ]);

        // Центрируем с задержкой, чтобы React Flow успел смонтироваться
        setTimeout(() => {
          setCenter(targetX, targetY, { duration: 300, zoom: 1 });
        }, 150);

        // Сбрасываем ТОЛЬКО после успешной обработки
        setSearchTargetNodeId(null);
      }
      // Если карточка НЕ найдена - НЕ сбрасываем, ждём загрузки правильных nodes
    }
  }, [searchTargetNodeId, isLoading, nodes, setCenter, onNodesChange, setSearchTargetNodeId]);

  /**
   * Обработчик выбора результата семантического поиска
   * Центрирует холст на выбранной карточке и подсвечивает её
   * 
   * @param nodeId - ID выбранной карточки
   * @param canvasId - ID холста (для переключения холстов если нужно)
   */
  const handleSearchResultSelect = useCallback(
    (nodeId: string, canvasId: string) => {
      // Если карточка на другом холсте - переключаемся
      if (canvasId !== activeCanvasId) {
        console.log('[CanvasContent] Переключение на холст:', canvasId, 'для карточки:', nodeId);

        // Устанавливаем ID карточки для фокусировки после загрузки
        // ВАЖНО: Используем store напрямую, а не через callback,
        // т.к. при смене холста компонент перемонтируется
        useCanvasStore.getState().setSearchTargetNodeId(nodeId);

        // Переключаем активный холст через openCanvas
        // После смены холста сработает useEffect с loadFromFile,
        // а затем useEffect с searchTargetNodeId центрирует на карточке
        const { openCanvas } = useWorkspaceStore.getState();
        openCanvas(canvasId);

        return;
      }

      // Карточка на текущем холсте - просто центрируемся
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (targetNode) {
        const CARD_WIDTH = 400;
        const CARD_HEIGHT_ESTIMATE = 150;

        // Центрируем с плавной анимацией
        setCenter(
          targetNode.position.x + CARD_WIDTH / 2,
          targetNode.position.y + CARD_HEIGHT_ESTIMATE / 2,
          { duration: 300, zoom: 1 }
        );

        // Снимаем выделение со всех и выделяем найденную карточку
        onNodesChange([
          // Сначала снимаем выделение со всех
          ...nodes.filter((n) => n.selected).map((n) => ({
            type: 'select' as const,
            id: n.id,
            selected: false,
          })),
          // Затем выделяем целевую
          { type: 'select' as const, id: nodeId, selected: true },
        ]);

        console.log('[CanvasContent] Центрирование на карточке:', nodeId);
      }
    },
    [activeCanvasId, nodes, setCenter, onNodesChange]
  );

  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================

  // Показываем лоадер во время загрузки данных
  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          {/* Анимированный индикатор */}
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-muted animate-pulse" />
            <div className="absolute inset-2 rounded-full border-4 border-primary/30 animate-spin"
              style={{ animationDuration: '2s' }} />
            <div className="absolute inset-6 rounded-full bg-primary animate-pulse" />
          </div>

          {/* Текст загрузки */}
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              {t.canvas.loadingNotes}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t.canvas.restoringData}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // CSS классы для динамического состояния выделения и соединения
  const selectionClasses = [
    isSelecting ? 'selection-active' : '',
    selectionMode === SelectionMode.Partial ? 'selection-mode-partial' : 'selection-mode-full',
    // Класс для блокировки выделения текста при создании связи
    isConnecting ? 'connecting-active' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={reactFlowWrapper}
      className={`w-full h-full relative ${selectionClasses}`}
    >
      <ReactFlow<NeuroNodeType>
        // === ДАННЫЕ ===
        nodes={nodes}
        edges={edges}

        // === ТИПЫ НОД ===
        nodeTypes={nodeTypes}

        // === CALLBACKS ДЛЯ ИЗМЕНЕНИЙ ===
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}

        // === АВТОВЫДЕЛЕНИЕ ПРИ ПЕРЕТАСКИВАНИИ ===
        onNodeDragStart={handleNodeDragStart}

        // === DRAG-TO-CREATE И БЛОКИРОВКА ВЫДЕЛЕНИЯ ===
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}

        // === DOUBLE-CLICK обрабатывается через нативный обработчик в useEffect ===

        // === СТИЛИ СВЯЗЕЙ - BEZIER для кривых ===
        connectionLineType={ConnectionLineType.Bezier}
        defaultEdgeOptions={defaultEdgeOptions}

        // === УВЕЛИЧЕННЫЙ РАДИУС СОЕДИНЕНИЯ ===
        // Позволяет соединять, не целясь точно в handle
        connectionRadius={CONNECTION_RADIUS}

        // === VIEWPORT ===
        fitView
        fitViewOptions={fitViewOptions}
        minZoom={0.1}
        maxZoom={2}

        // === ВНЕШНИЙ ВИД ===
        className="neuro-canvas"

        // === ПОВЕДЕНИЕ ===
        // Delete обрабатывается глобально через useEffect
        deleteKeyCode={null}
        multiSelectionKeyCode={['Control', 'Meta']}

        // КОЛЁСИКО = ZOOM (не scroll!)
        panOnScroll={false}
        zoomOnScroll={true}
        zoomOnDoubleClick={false} // ОТКЛЮЧАЕМ зум по двойному клику

        // Pan только средней кнопкой мыши или с зажатым пробелом
        panOnDrag={[1, 2]} // СКМ и ПКМ для pan

        // === РЕЖИМ ВЫДЕЛЕНИЯ ===
        // Динамически меняется в зависимости от направления рисования рамки:
        // - Full: слева направо → только полностью попавшие в рамку
        // - Partial: справа налево → любое пересечение с рамкой
        selectionMode={selectionMode}
        selectionOnDrag
        selectNodesOnDrag={false}

        // Разрешаем выделение связей кликом
        edgesFocusable

        // === АТРИБУТЫ ДОСТУПНОСТИ ===
        nodesDraggable
        nodesConnectable
        elementsSelectable
      >
        {/* ----- ФОНОВАЯ СЕТКА С ТОЧКАМИ ----- */}
        {/* Увеличены точки для лучшей видимости */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={2}
          color="hsl(var(--muted-foreground) / 0.3)"
        />

        {/* ----- ЭЛЕМЕНТЫ УПРАВЛЕНИЯ ----- */}
        <Controls
          className="neuro-controls"
          showZoom
          showFitView
          showInteractive={false}
        />

        {/* ----- МИНИ-КАРТА ----- */}
        <MiniMap
          className="neuro-minimap"
          nodeStrokeWidth={3}
          zoomable
          pannable
          nodeBorderRadius={8}
        />
      </ReactFlow>

      {/* ----- КНОПКА ПОИСКА, ДОНАТОВ И НАСТРОЕК (правый верхний угол) ----- */}
      <div className="absolute top-4 right-4 z-50 pointer-events-auto flex items-center gap-2">
        {/* Кнопка семантического поиска */}
        <button
          onClick={() => setIsSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-background/80 backdrop-blur-sm border border-border shadow-sm hover:bg-accent transition-colors"
          title={`${t.search.title} (Ctrl+P)`}
        >
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-xs text-muted-foreground hidden sm:inline">Ctrl+P</span>
        </button>

        {/* Кнопка поддержки/донатов */}
        <DonateButtonTrigger onClick={() => setIsDonateOpen(true)} />

        {/* Кнопка настроек */}
        <SettingsButton onClick={() => setIsSettingsOpen(true)} />
      </div>

      {/* =======================================================================
          ПАНЕЛЬ СОЗДАНИЯ КАРТОЧЕК (Слева посередине)
          ======================================================================= */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-3">
        <button
          onClick={() => {
            const viewport = getViewport();
            // Создаём в центре viewport
            const center = {
              x: -viewport.x / viewport.zoom + (window.innerWidth / 2 / viewport.zoom),
              y: -viewport.y / viewport.zoom + (window.innerHeight / 2 / viewport.zoom)
            };
            // Небольшое смещение чтобы избежать наложения
            const position = { x: center.x - 200, y: center.y - 100 };
            const newNodeId = addNode(position);
            // Снимаем выделение со ВСЕХ нод и выделяем ТОЛЬКО новую
            // Предотвращает случайное удаление нескольких карточек при Delete
            deselectAllAndSelect(newNodeId);
          }}
          className="group relative flex items-center justify-center w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl hover:scale-110 transition-all duration-300 hover:border-blue-500/50 hover:shadow-blue-500/20"
          title={t.toolButtons?.createAiCardTooltip || 'Create an AI card for LLM conversation'}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="sr-only">{t.toolButtons?.createAiCard || 'AI Card'}</span>
          <svg className="w-6 h-6 text-zinc-700 dark:text-zinc-200 group-hover:text-blue-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        <button
          onClick={() => {
            const viewport = getViewport();
            const center = {
              x: -viewport.x / viewport.zoom + (window.innerWidth / 2 / viewport.zoom),
              y: -viewport.y / viewport.zoom + (window.innerHeight / 2 / viewport.zoom)
            };
            const position = { x: center.x - 200, y: center.y + 100 };
            const newNodeId = addNoteNode(position);
            // Снимаем выделение со ВСЕХ нод и выделяем ТОЛЬКО новую
            // Предотвращает случайное удаление нескольких карточек при Delete
            deselectAllAndSelect(newNodeId);
          }}
          className="group relative flex items-center justify-center w-12 h-12 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl hover:scale-110 transition-all duration-300 hover:border-amber-500/50 hover:shadow-amber-500/20"
          title={t.toolButtons?.createNoteCardTooltip || 'Create a personal note'}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="sr-only">{t.toolButtons?.createNoteCard || 'Note'}</span>
          <svg className="w-6 h-6 text-zinc-700 dark:text-zinc-200 group-hover:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>

      {/* ----- МОДАЛЬНОЕ ОКНО НАСТРОЕК ----- */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* ----- МОДАЛЬНОЕ ОКНО ПОДДЕРЖКИ/ДОНАТОВ ----- */}
      <DonateModal
        isOpen={isDonateOpen}
        onClose={() => setIsDonateOpen(false)}
      />

      {/* ----- ПОИСКОВАЯ ПАНЕЛЬ (СЕМАНТИЧЕСКИЙ ПОИСК) ----- */}
      <SearchBar
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectResult={handleSearchResultSelect}
      />

      {/* ----- РЕЖИМ ПОЛНОЭКРАННОГО ЧТЕНИЯ КАРТОЧЕК ----- */}
      <ReadingModeModal />

      {/* ----- ИНДИКАТОР СОХРАНЕНИЯ, UNDO/REDO И КНОПКА РУЧНОГО СОХРАНЕНИЯ ----- */}
      <div className="absolute top-4 left-4 z-50 pointer-events-auto flex items-center gap-2">
        {/* Кнопки Undo/Redo */}
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border shadow-sm">
          {/* Кнопка Undo */}
          <button
            onClick={() => {
              if (canUndo()) {
                performUndo();
                setUndoSteps(getUndoCount());
                setRedoSteps(getRedoCount());
              }
            }}
            disabled={undoSteps === 0}
            className={`
              p-1.5 rounded-md transition-all duration-200 flex items-center gap-1
              ${undoSteps > 0
                ? 'text-foreground hover:bg-accent cursor-pointer'
                : 'text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={`${t.canvas.undo || 'Undo'} (Ctrl+Z)${undoSteps > 0 ? ` · ${undoSteps}` : ''}`}
          >
            <Undo2 className="w-4 h-4" />
            {undoSteps > 0 && (
              <span className="text-xs font-medium min-w-[1ch]">{undoSteps}</span>
            )}
          </button>

          {/* Разделитель */}
          <div className="w-px h-4 bg-border" />

          {/* Кнопка Redo */}
          <button
            onClick={() => {
              if (canRedo()) {
                performRedo();
                setUndoSteps(getUndoCount());
                setRedoSteps(getRedoCount());
              }
            }}
            disabled={redoSteps === 0}
            className={`
              p-1.5 rounded-md transition-all duration-200 flex items-center gap-1
              ${redoSteps > 0
                ? 'text-foreground hover:bg-accent cursor-pointer'
                : 'text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={`${t.canvas.redo || 'Redo'} (Ctrl+Y)${redoSteps > 0 ? ` · ${redoSteps}` : ''}`}
          >
            <Redo2 className="w-4 h-4" />
            {redoSteps > 0 && (
              <span className="text-xs font-medium min-w-[1ch]">{redoSteps}</span>
            )}
          </button>
        </div>

        {/* Кнопка пакетной регенерации (показывается только если есть stale ноды или идёт регенерация) */}
        {(staleNodesCount > 0 || isBatchRegenerating) && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border shadow-sm">
            {isBatchRegenerating ? (
              // Режим регенерации: прогресс + кнопка отмены
              <>
                <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                  {batchRegenerationProgress
                    ? `${batchRegenerationProgress.completed}/${batchRegenerationProgress.total}`
                    : t.common.loading
                  }
                </span>
                <button
                  onClick={cancelBatchRegeneration}
                  className="ml-1 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title={t.batchRegenerate.cancel}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              // Режим ожидания: кнопка запуска
              <button
                onClick={regenerateStaleNodes}
                className="flex items-center gap-1.5 text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                title={t.batchRegenerate.tooltip}
              >
                <RefreshCw className="w-4 h-4" />
                <span className="text-xs font-medium">
                  {t.batchRegenerate.buttonWithCount.replace('{count}', String(staleNodesCount))}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Индикатор сохранения */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border shadow-sm">
          {/* Иконка статуса */}
          {isSaving ? (
            // Анимация сохранения
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          ) : hasUnsavedChanges ? (
            // Есть несохранённые изменения
            <div className="w-2 h-2 rounded-full bg-amber-400" />
          ) : (
            // Всё сохранено
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
          )}

          {/* Текст статуса */}
          <span className="text-xs text-muted-foreground">
            {isSaving ? (
              t.canvas.saving
            ) : hasUnsavedChanges ? (
              t.canvas.unsaved
            ) : lastSaved ? (
              `${t.canvas.saved} ${formatTime(lastSaved)}`
            ) : (
              t.canvas.ready
            )}
          </span>

          {/* Кнопка ручного сохранения (дискетка) */}
          <button
            onClick={() => saveToFile()}
            disabled={isSaving || !hasUnsavedChanges}
            className={`
              p-1 rounded-md transition-all duration-200
              ${hasUnsavedChanges && !isSaving
                ? 'text-primary hover:bg-primary/10 cursor-pointer'
                : 'text-muted-foreground/40 cursor-not-allowed'
              }
            `}
            title={t.canvas.saveManually}
          >
            <Save className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ----- УВЕДОМЛЕНИЕ ОБ ОШИБКЕ ----- */}
      {persistError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/20 shadow-lg">
            {/* Иконка ошибки */}
            <svg
              className="w-4 h-4 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>

            {/* Текст ошибки */}
            <span className="text-sm text-destructive">
              {persistError}
            </span>

            {/* Кнопка закрытия */}
            <button
              onClick={clearPersistError}
              className="ml-2 text-destructive/70 hover:text-destructive transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
