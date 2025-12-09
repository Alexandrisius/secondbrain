/**
 * @file NeuroNode.tsx
 * @description Кастомный компонент ноды для React Flow с "морфинг" анимацией
 * 
 * НОВЫЙ ДИЗАЙН КАРТОЧКИ:
 * - Верхняя часть (question-section): вопрос + кнопки + входные/выходные ноды по центру
 * - Нижняя часть (answer-section): выезжающий слайдер с ответом (фикс. 400px, scroll)
 * 
 * ВАЖНО: Streaming текст хранится в локальном useState для производительности!
 * Только финальный результат коммитится в глобальный Zustand store.
 */

'use client';

import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import TextareaAutosize from 'react-textarea-autosize';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Zap,
  RefreshCw,
  Copy,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Quote,
  PlusCircle,
  X,
  Square,
  GripVertical,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCanvasStore } from '@/store/useCanvasStore';
import {
  useSettingsStore,
  selectApiKey,
  selectApiBaseUrl,
  selectEmbeddingsBaseUrl,
  selectModel,
  selectUseSummarization,
  selectCorporateMode,
} from '@/store/useSettingsStore';
import { ContextViewerModal } from '@/components/canvas/ContextViewerModal';
import { useTranslation, format } from '@/lib/i18n';
import type { NeuroNode as NeuroNodeType } from '@/types/canvas';
import { cn } from '@/lib/utils';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Props компонента NeuroNode
 * 
 * Используем NodeProps с полным типом Node (NeuroNodeType), а не только data.
 * Это обеспечивает правильную типизацию для React Flow.
 */
type NeuroNodeProps = NodeProps<NeuroNodeType>;

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/** Минимальная ширина карточки (px) */
const MIN_CARD_WIDTH = 300;
/** Максимальная ширина карточки (px) */
const MAX_CARD_WIDTH = 800;
/** Ширина карточки по умолчанию (px) */
const DEFAULT_CARD_WIDTH = 400;
/** Фиксированная высота ответной части */
const ANSWER_SECTION_HEIGHT = 400;

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * NeuroNode - основной компонент ноды на холсте
 * 
 * Особенности:
 * - НОВЫЙ ДИЗАЙН: вопрос сверху, ответ выезжает снизу как слайдер
 * - Handle позиционируются по центру вопросной части
 * - Плавный морфинг между режимами
 * - Streaming генерация с локальным состоянием
 * - Enter для отправки, Shift+Enter для новой строки
 * - Escape для снятия фокуса (затем можно удалить через Delete)
 * - Stale badge при изменении родителя
 * - КОНТЕКСТ РОДИТЕЛЯ передаётся в AI запрос
 * - Drag-resize ширины карточки
 */
const NeuroNodeComponent = ({ id, data, selected }: NeuroNodeProps) => {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================

  const { t } = useTranslation();

  // ===========================================================================
  // ZUSTAND ACTIONS & DATA
  // ===========================================================================

  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const markChildrenStale = useCanvasStore((s) => s.markChildrenStale);

  /**
   * Action для проверки и снятия stale у потомков
   * Используется при blur для проверки восстановления контекста
   */
  const checkAndClearStale = useCanvasStore((s) => s.checkAndClearStale);

  /**
   * Action для сохранения хэша контекста после генерации
   * Используется для автоматического снятия stale при возврате контекста
   */
  const saveContextHash = useCanvasStore((s) => s.saveContextHash);

  /**
   * Action для уведомления о завершении генерации в пакетном режиме
   * Вызывается после успешной генерации, если идёт пакетная регенерация
   */
  const onBatchNodeComplete = useCanvasStore((s) => s.onBatchNodeComplete);

  /**
   * Action для быстрого создания связанной карточки справа
   * Вызывается по нажатию Tab из textarea
   */
  const createLinkedNodeRight = useCanvasStore((s) => s.createLinkedNodeRight);

  /**
   * Action для создания "сестринской" карточки (от того же родителя)
   * Вызывается по нажатию Ctrl+Enter из textarea
   */
  const createSiblingNode = useCanvasStore((s) => s.createSiblingNode);

  /**
   * Action для создания карточки на основе цитаты
   */
  const createQuoteNode = useCanvasStore((s) => s.createQuoteNode);

  /**
   * Action для сброса инвалидации цитаты
   */
  const clearQuoteInvalidation = useCanvasStore((s) => s.clearQuoteInvalidation);

  /**
   * Action для обновления цитаты
   */
  const updateQuote = useCanvasStore((s) => s.updateQuote);

  /**
   * Action для инициации режима выбора цитаты в родительской карточке
   * Вызывается из дочерней карточки с инвалидированной цитатой
   */
  const initiateQuoteSelectionInParent = useCanvasStore((s) => s.initiateQuoteSelectionInParent);

  /**
   * Action для сброса режима цитирования
   */
  const clearQuoteModeActive = useCanvasStore((s) => s.clearQuoteModeActive);

  /**
   * ID ноды, ожидающей фокус - используется для автофокуса новых карточек
   */
  const pendingFocusNodeId = useCanvasStore((s) => s.pendingFocusNodeId);

  /**
   * Сброс pendingFocusNodeId после успешного фокуса
   */
  const clearPendingFocus = useCanvasStore((s) => s.clearPendingFocus);

  /**
   * Получаем nodes и edges напрямую для правильного отслеживания изменений
   * Это позволяет React замечать изменения в данных нод (response, summary и т.д.)
   */
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  /**
   * API ключ из глобальных настроек
   * 
   * Используется для авторизации запросов к внешнему LLM API.
   */
  const apiKey = useSettingsStore(selectApiKey);

  /**
   * Базовый URL API из глобальных настроек
   * 
   * Определяет к какому провайдеру будут отправляться запросы.
   */
  const apiBaseUrl = useSettingsStore(selectApiBaseUrl);

  /**
   * Базовый URL API для эмбеддингов из глобальных настроек
   * 
   * Используется для семантического поиска.
   */
  const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);

  /**
   * Модель из глобальных настроек
   * 
   * Название модели для генерации ответов (например "openai/gpt-4o").
   */
  const model = useSettingsStore(selectModel);

  /**
   * Настройка суммаризации из глобальных настроек
   * 
   * Когда true - для дальних предков используется summary или сокращённый response
   * Когда false - для всех предков используется полный response (для моделей с большим контекстом)
   */
  const useSummarization = useSettingsStore(selectUseSummarization);

  /**
   * Корпоративный режим из глобальных настроек
   * 
   * Когда true - отключается проверка SSL сертификатов для работы
   * в корпоративных сетях с SSL-инспекцией (DLP, прокси).
   */
  const corporateMode = useSettingsStore(selectCorporateMode);

  /**
   * Модель эмбеддингов из глобальных настроек
   * 
   * Используется для семантического поиска.
   * Разные провайдеры поддерживают разные модели эмбеддингов.
   */
  const embeddingsModel = useSettingsStore((s) => s.embeddingsModel);

  /**
   * Вычисляем ПРЯМЫХ родителей через useMemo
   * 
   * НОВОЕ: Поддержка нескольких родителей через parentIds!
   * Если есть parentIds - это карточка с несколькими родителями (созданная через Tab от выделения)
   * Если только parentId - это обычная карточка с одним родителем
   */
  const directParents = useMemo(() => {
    const parents: NeuroNodeType[] = [];

    // Приоритет 1: parentIds (массив родителей)
    if (data.parentIds && data.parentIds.length > 0) {
      data.parentIds.forEach((parentId) => {
        const parentNode = nodes.find((n) => n.id === parentId);
        if (parentNode) {
          parents.push(parentNode);
        }
      });
      return parents;
    }

    // Приоритет 2: Ищем входящие связи (может быть несколько)
    const incomingEdges = edges.filter((e) => e.target === id);
    if (incomingEdges.length > 0) {
      incomingEdges.forEach((edge) => {
        const parentNode = nodes.find((n) => n.id === edge.source);
        if (parentNode && !parents.some((p) => p.id === parentNode.id)) {
          parents.push(parentNode);
        }
      });
      if (parents.length > 0) return parents;
    }

    // Приоритет 3: parentId (обратная совместимость)
    if (data.parentId) {
      const parentNode = nodes.find((n) => n.id === data.parentId);
      if (parentNode) {
        parents.push(parentNode);
      }
    }

    return parents;
  }, [id, data.parentIds, data.parentId, nodes, edges]);

  /**
   * Вычисляем ПОЛНУЮ цепочку предков через useMemo
   * 
   * ВАЖНО: Рекурсивно собираем ВСЕХ родителей каждого предка!
   * Если у дедушки есть несколько родителей - все они попадают в контекст.
   * Это позволяет передавать контекст от объединённых карточек потомкам.
   * 
   * Используем BFS (breadth-first search) для обхода дерева предков:
   * - Сначала все прямые родители (уровень 0)
   * - Затем все родители родителей (уровень 1)
   * - И так далее до корневых карточек
   */
  const ancestorChain = useMemo(() => {
    const ancestors: NeuroNodeType[] = [];

    // Если нет прямых родителей - пустая цепочка
    if (directParents.length === 0) return ancestors;

    // Добавляем всех прямых родителей как первый "уровень"
    ancestors.push(...directParents);

    // Очередь для BFS - начинаем с прямых родителей
    const queue: string[] = directParents.map((p) => p.id);

    // Множество уже обработанных ID для избежания дубликатов и циклов
    const processedIds = new Set<string>(queue);

    // Защита от бесконечных циклов
    const maxIterations = 500;
    let iterations = 0;

    /**
     * Вспомогательная функция: получить всех родителей ноды
     * Проверяет parentIds, входящие edges и parentId
     */
    const getParentsOfNode = (nodeId: string): NeuroNodeType[] => {
      const parents: NeuroNodeType[] = [];
      const node = nodes.find((n) => n.id === nodeId);

      if (!node) return parents;

      // Приоритет 1: parentIds (массив родителей)
      if (node.data.parentIds && node.data.parentIds.length > 0) {
        node.data.parentIds.forEach((pid) => {
          const parentNode = nodes.find((n) => n.id === pid);
          if (parentNode && !parents.some((p) => p.id === parentNode.id)) {
            parents.push(parentNode);
          }
        });
        return parents;
      }

      // Приоритет 2: Входящие связи (edges)
      const incomingEdges = edges.filter((e) => e.target === nodeId);
      if (incomingEdges.length > 0) {
        incomingEdges.forEach((edge) => {
          const parentNode = nodes.find((n) => n.id === edge.source);
          if (parentNode && !parents.some((p) => p.id === parentNode.id)) {
            parents.push(parentNode);
          }
        });
        if (parents.length > 0) return parents;
      }

      // Приоритет 3: parentId (обратная совместимость)
      if (node.data.parentId) {
        const parentNode = nodes.find((n) => n.id === node.data.parentId);
        if (parentNode) {
          parents.push(parentNode);
        }
      }

      return parents;
    };

    // BFS: обходим всё дерево предков
    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;

      // Берём следующую ноду из очереди
      const currentNodeId = queue.shift()!;

      // Получаем всех родителей текущей ноды
      const parentsOfCurrent = getParentsOfNode(currentNodeId);

      // Добавляем каждого родителя в предков и в очередь (если ещё не обработан)
      parentsOfCurrent.forEach((parent) => {
        if (!processedIds.has(parent.id)) {
          processedIds.add(parent.id);
          ancestors.push(parent);
          queue.push(parent.id);
        }
      });
    }

    return ancestors;
  }, [directParents, nodes, edges]);

  /**
   * Родительская нода (первый элемент списка прямых родителей)
   * Для backward compatibility
   */
  const parentNode = directParents[0] || null;

  // ===========================================================================
  // ЛОКАЛЬНОЕ СОСТОЯНИЕ (для производительности)
  // ===========================================================================

  /**
   * Локальное состояние для промпта во время редактирования
   * Синхронизируется с store только при blur или submit
   */
  const [localPrompt, setLocalPrompt] = useState(data.prompt);

  /**
   * Режим редактирования текста вопроса
   * true - показываем textarea с фокусом
   * false - показываем div с текстом (можно драгать)
   */
  const [isEditing, setIsEditing] = useState(false);

  /**
   * Streaming текст от AI - КРИТИЧНО хранить локально!
   * Иначе каждый chunk будет ре-рендерить весь Canvas
   */
  const [streamingText, setStreamingText] = useState('');

  /**
   * Локальный флаг генерации (для UI отзывчивости)
   */
  const [isGenerating, setIsGenerating] = useState(false);

  /**
   * Флаг успешного копирования (для feedback)
   */
  const [copied, setCopied] = useState(false);

  /**
   * Сообщение об ошибке
   */
  const [error, setError] = useState<string | null>(null);

  /**
   * НОВОЕ: Состояние раскрытости ответной части (слайдер)
   * Инициализируется из data.isAnswerExpanded для синхронизации с store
   * По умолчанию скрыта, автоматически раскрывается при первой генерации
   */
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(data.isAnswerExpanded ?? false);

  /**
   * Флаг: была ли уже первая генерация (для автораскрытия)
   */
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(Boolean(data.response));

  /**
   * Флаг наличия вертикального скролла в ответной части
   * 
   * Используется для умного поведения колёсика мыши:
   * - Если скролла нет → колёсико зуммирует холст
   * - Если скролл есть → колёсико прокручивает контент
   */
  const [hasVerticalScroll, setHasVerticalScroll] = useState(false);

  // ===========================================================================
  // СОСТОЯНИЕ RESIZE (ИЗМЕНЕНИЕ ШИРИНЫ КАРТОЧКИ)
  // ===========================================================================

  /**
   * Флаг активного resize (пользователь тянет ручку)
   */
  const [isResizing, setIsResizing] = useState(false);

  /**
   * Текущая ширина карточки во время resize
   * Используется для мгновенного UI feedback
   */
  const [resizeWidth, setResizeWidth] = useState(data.width ?? DEFAULT_CARD_WIDTH);

  // ===========================================================================
  // СОСТОЯНИЕ ЦИТИРОВАНИЯ
  // ===========================================================================

  /**
   * Режим цитирования активен
   * Когда true - пользователь может выделять текст для создания цитатной карточки
   */
  const [isQuoteMode, setIsQuoteMode] = useState(false);

  /**
   * Выделенный текст для цитаты
   */
  const [selectedQuoteText, setSelectedQuoteText] = useState('');

  // ===========================================================================
  // СОСТОЯНИЕ МОДАЛЬНОГО ОКНА КОНТЕКСТА
  // ===========================================================================

  /**
   * Флаг открытости модального окна просмотра контекста
   * Открывается при клике на badge "Использован контекст от X родительских нод"
   */
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);

  // ===========================================================================
  // REFS
  // ===========================================================================

  /**
   * Ref для textarea - используется для auto-focus и blur
   */
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Ref для question-section - для позиционирования Handle
   */
  const questionSectionRef = useRef<HTMLDivElement>(null);

  /**
   * Ref для scrollable контейнера ответной части
   * Используется для перехвата события колёсика мыши
   */
  const answerScrollRef = useRef<HTMLDivElement>(null);

  /**
   * Ref для контейнера контента ответа
   * Используется для отслеживания выделения текста при цитировании
   */
  const answerContentRef = useRef<HTMLDivElement>(null);

  /**
   * AbortController для отмены streaming запроса
   */
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Ref для хранения начальной позиции мыши при resize
   * Используется в обработчиках mousemove/mouseup
   */
  const resizeStartXRef = useRef<number>(0);

  /**
   * Ref для хранения начальной ширины карточки при resize
   */
  const resizeStartWidthRef = useRef<number>(DEFAULT_CARD_WIDTH);

  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================

  /**
   * Синхронизация локального промпта при внешнем изменении data.prompt
   */
  useEffect(() => {
    setLocalPrompt(data.prompt);
  }, [data.prompt]);

  /**
   * Auto-focus на input при создании новой ноды
   */
  useEffect(() => {
    if (!data.response && textareaRef.current) {
      // Включаем режим редактирования для новых нод
      setIsEditing(true);

      // Небольшая задержка для завершения анимации появления
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [data.response]);

  /**
   * АВТОФОКУС ПРИ СОЗДАНИИ ЧЕРЕЗ TAB
   * 
   * Когда pendingFocusNodeId совпадает с id этой ноды,
   * фокусируем textarea и сбрасываем pendingFocusNodeId.
   * Это обеспечивает моментальный переход курсора в новую карточку.
   */
  useEffect(() => {
    if (pendingFocusNodeId === id) {
      // Сначала включаем режим редактирования
      setIsEditing(true);

      // Небольшая задержка для завершения рендера новой ноды
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        // Сбрасываем pendingFocusNodeId после успешного фокуса
        clearPendingFocus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pendingFocusNodeId, id, clearPendingFocus]);

  /**
   * Автораскрытие ответной части при первой генерации
   */
  useEffect(() => {
    if (data.response && !hasGeneratedOnce) {
      setIsAnswerExpanded(true);
      setHasGeneratedOnce(true);
    }
  }, [data.response, hasGeneratedOnce]);

  /**
   * Синхронизация локального isAnswerExpanded с data.isAnswerExpanded из store
   * Это позволяет переключать состояние через глобальные горячие клавиши (Space)
   */
  useEffect(() => {
    // Синхронизируем только если значение в store отличается от локального
    if (data.isAnswerExpanded !== undefined && data.isAnswerExpanded !== isAnswerExpanded) {
      setIsAnswerExpanded(data.isAnswerExpanded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.isAnswerExpanded]);

  /**
   * Синхронизация локального isQuoteMode с data.isQuoteModeActive из store
   * 
   * Это позволяет активировать режим цитирования извне:
   * - Когда дочерняя карточка с инвалидированной цитатой нажимает "Выделить новую цитату"
   * - Store устанавливает isQuoteModeActive = true для родительской карточки
   * - Этот эффект синхронизирует локальное состояние
   */
  useEffect(() => {
    if (data.isQuoteModeActive !== undefined && data.isQuoteModeActive !== isQuoteMode) {
      setIsQuoteMode(data.isQuoteModeActive);
      // Если режим цитирования активируется - сбрасываем выделенный текст
      if (data.isQuoteModeActive) {
        setSelectedQuoteText('');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.isQuoteModeActive]);


  /**
   * Синхронизация resizeWidth с data.width при внешнем изменении
   * (например, при загрузке сохранённого холста)
   */
  useEffect(() => {
    if (data.width !== undefined && data.width !== resizeWidth && !isResizing) {
      setResizeWidth(data.width);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.width]);

  /**
   * Отслеживание наличия вертикального скролла в ответной части
   * 
   * Использует ResizeObserver для реактивного обновления при изменении контента.
   * Это позволяет умно переключать поведение колёсика мыши:
   * - Нет скролла → зум холста
   * - Есть скролл → прокрутка контента
   */
  useEffect(() => {
    const scrollContainer = answerScrollRef.current;

    // Если контейнер не существует или ответ не раскрыт - скролла нет
    if (!scrollContainer || !isAnswerExpanded) {
      setHasVerticalScroll(false);
      return;
    }

    /**
     * Функция проверки наличия скролла
     * Сравнивает высоту контента (scrollHeight) с высотой контейнера (clientHeight)
     */
    const checkScroll = () => {
      const hasScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight;
      setHasVerticalScroll(hasScroll);
    };

    // Проверяем сразу при монтировании/изменении
    checkScroll();

    // ResizeObserver для отслеживания изменений размера контента
    // (например, при streaming генерации текст добавляется постепенно)
    const resizeObserver = new ResizeObserver(() => {
      checkScroll();
    });

    // Наблюдаем за контейнером
    resizeObserver.observe(scrollContainer);

    // Также наблюдаем за содержимым контейнера (первый child)
    // чтобы отследить изменения высоты контента
    if (scrollContainer.firstElementChild) {
      resizeObserver.observe(scrollContainer.firstElementChild);
    }

    // Cleanup при размонтировании
    return () => {
      resizeObserver.disconnect();
    };
  }, [isAnswerExpanded, data.response, streamingText]); // Пересчитываем при изменении контента или раскрытии

  /**
   * Глобальные обработчики mousemove/mouseup для resize
   * 
   * ВАЖНО: Обработчики добавляются на document чтобы:
   * 1. Отслеживать движение мыши за пределами карточки
   * 2. Гарантированно завершить resize при отпускании кнопки
   */
  useEffect(() => {
    // Если resize не активен - обработчики не нужны
    if (!isResizing) return;

    /**
     * Обработчик движения мыши во время resize
     * Вычисляет новую ширину и обновляет локальное состояние
     */
    const handleMouseMove = (e: MouseEvent) => {
      // Предотвращаем выделение текста во время resize
      e.preventDefault();

      // Вычисляем дельту относительно начальной позиции
      const deltaX = e.clientX - resizeStartXRef.current;

      // Вычисляем новую ширину с ограничениями
      const rawWidth = resizeStartWidthRef.current + deltaX;

      // Округляем до ближайших 10px для "магнитного" эффекта
      const snappedWidth = Math.round(rawWidth / 10) * 10;

      // Применяем ограничения min/max
      const newWidth = Math.min(
        MAX_CARD_WIDTH,
        Math.max(MIN_CARD_WIDTH, snappedWidth)
      );

      // Обновляем локальное состояние (мгновенный UI feedback)
      setResizeWidth(newWidth);
    };

    /**
     * Обработчик отпускания кнопки мыши
     * Завершает resize и сохраняет ширину в store
     */
    const handleMouseUp = () => {
      // Сохраняем финальную ширину в store
      updateNodeData(id, { width: resizeWidth });

      // Завершаем resize
      setIsResizing(false);
    };

    // Добавляем глобальные обработчики
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Cleanup при размонтировании или завершении resize
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeWidth, id, updateNodeData]);

  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================

  /**
   * Обработчик нажатия клавиш в textarea
   * 
   * КРИТИЧНО: Блокируем propagation для ВСЕХ клавиш кроме Escape!
   * Это предотвращает перехват событий React Flow (Delete, Backspace, стрелки и т.д.)
   * 
   * Поддерживаемые действия:
   * - Enter - отправка (если не Shift и не Ctrl)
   * - Shift+Enter - новая строка
   * - Tab - создание новой связанной карточки справа (если есть ответ)
   * - Ctrl+Enter - создание "сестринской" карточки (альтернативная ветка)
   * - Escape - снятие фокуса (для последующего удаления через Delete)
   * - Ctrl+A - выделить всё (нативное)
   * - Ctrl+C/V/X - копирование/вставка/вырезание (нативное)
   * - Ctrl+Z/Y - undo/redo (нативное)
   * - Delete/Backspace - удаление символов (нативное)
   * - Стрелки - навигация по тексту (нативное)
   * - Home/End - в начало/конец строки (нативное)
   * - Ctrl+Home/End - в начало/конец текста (нативное)
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape - единственная клавиша, которая должна propagate для blur
      // и последующего удаления ноды через Delete
      if (e.key === 'Escape') {
        e.preventDefault();
        textareaRef.current?.blur();
        return;
      }

      // КРИТИЧНО: Блокируем propagation для ВСЕХ остальных клавиш!
      // Это предотвращает перехват React Flow (Delete удаляет ноду, стрелки двигают и т.д.)
      e.stopPropagation();

      // =======================================================================
      // TAB - БЫСТРОЕ СОЗДАНИЕ НОВОЙ СВЯЗАННОЙ КАРТОЧКИ (ДОЧЕРНЕЙ)
      // =======================================================================
      // 
      // Workflow: пишешь вопрос → Enter → получаешь ответ → Tab → новая карточка
      // Это создаёт "чат-подобный" UX для быстрой работы с AI
      //
      // Условия:
      // - Tab без Shift (Shift+Tab - стандартный переход назад)
      // - Есть сгенерированный ответ (карточка "завершена")
      // - Не идёт генерация в данный момент
      //
      if (e.key === 'Tab' && !e.shiftKey) {
        // Проверяем что есть ответ и не идёт генерация
        if (data.response && !isGenerating) {
          e.preventDefault();

          // Создаём новую карточку справа от текущей
          // Она автоматически получит:
          // - Связь (edge) от этой карточки
          // - parentId для контекста
          // - Фокус на textarea (через pendingFocusNodeId)
          // - Центрирование холста (через pendingCenterNodeId)
          createLinkedNodeRight(id);
          return;
        }
        // Если нет ответа - игнорируем Tab (можно было бы вставлять \t, но для UX лучше игнорировать)
        e.preventDefault();
        return;
      }

      // =======================================================================
      // CTRL+ENTER - СОЗДАНИЕ "СЕСТРИНСКОЙ" КАРТОЧКИ (АЛЬТЕРНАТИВНАЯ ВЕТКА)
      // =======================================================================
      //
      // Workflow: есть карточка с ответом → Ctrl+Enter → новая карточка от того же родителя
      // Позволяет создавать альтернативные ветки размышления
      //
      // Условия:
      // - Ctrl+Enter (или Cmd+Enter на Mac)
      // - Есть сгенерированный ответ
      // - Есть родительская карточка (иначе нет от кого создавать сестру)
      // - Не идёт генерация
      //
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        // Проверяем что есть ответ и не идёт генерация
        if (data.response && !isGenerating && data.parentId) {
          e.preventDefault();

          // Сворачиваем ответную часть текущей карточки
          // чтобы сестринская карточка не наезжала
          setIsAnswerExpanded(false);

          // Создаём сестринскую карточку (от того же родителя)
          // Она автоматически получит:
          // - Связь (edge) от родителя этой карточки
          // - parentId для контекста (тот же родитель)
          // - Фокус на textarea
          // - Центрирование холста
          createSiblingNode(id);
          return;
        }
        // Если нет родителя - игнорируем (нельзя создать сестру)
        if (!data.parentId) {
          console.log('[NeuroNode] Ctrl+Enter: нет родителя, сестринская карточка невозможна');
        }
        e.preventDefault();
        return;
      }

      // Enter без Shift и без Ctrl - отправляем промпт на генерацию
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleGenerate();
        return;
      }

      // Все остальные клавиши обрабатываются нативно браузером:
      // - Ctrl+A: выделить всё
      // - Ctrl+C/V/X: копирование/вставка/вырезание
      // - Ctrl+Z: undo
      // - Ctrl+Y или Ctrl+Shift+Z: redo
      // - Delete/Backspace: удаление символов
      // - Стрелки: навигация
      // - Home/End: в начало/конец строки
      // - Ctrl+Home/End: в начало/конец текста
      // - Shift+стрелки: выделение текста
      // - Ctrl+Shift+стрелки: выделение слов
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localPrompt, data.response, data.parentId, isGenerating, id, createLinkedNodeRight, createSiblingNode]
  );

  /**
   * Обработчик изменения промпта
   * При изменении в Result mode - помечаем детей как stale
   */
  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setLocalPrompt(newValue);

      // Если есть ответ и меняем промпт - дети устаревают
      if (data.response) {
        markChildrenStale(id);
      }
    },
    [data.response, id, markChildrenStale]
  );

  /**
   * Сохранение промпта в store при потере фокуса
   * 
   * ВАЖНО: При blur ВСЕГДА проверяем stale детей!
   * Даже если промпт в store не изменился, дети могли быть помечены
   * как stale в handlePromptChange (при каждом нажатии клавиши).
   * 
   * Если промпт вернулся к исходному значению - дети должны снять stale.
   */
  const handlePromptBlur = useCallback(() => {
    setIsEditing(false); // Выходим из режима редактирования

    if (localPrompt !== data.prompt) {
      // Промпт изменился - сохраняем в store
      // updateNodeData автоматически вызовет checkAndClearStale
      updateNodeData(id, { prompt: localPrompt });
    } else {
      // Промпт НЕ изменился в store, но дети могли быть помечены stale
      // в handlePromptChange. Проверяем нужно ли снять stale.
      // 
      // Это происходит когда пользователь:
      // 1. Начал печатать (дети стали stale)
      // 2. Стёр изменения (вернул исходный текст)
      // 3. Blur - промпт совпадает с store, но дети stale
      // 
      // checkAndClearStale проверит хэш контекста и снимет stale
      // если контекст вернулся к эталонному
      if (data.response) {
        // Проверяем только если у ноды есть ответ (и соответственно могут быть дети)
        checkAndClearStale(id);
      }
    }
  }, [id, localPrompt, data.prompt, data.response, updateNodeData, checkAndClearStale]);

  /**
   * Генерация краткого резюме (summary) ответа
   * 
   * Вызывается ПОСЛЕ успешной генерации основного ответа.
   * Summary используется для передачи контекста внукам и более дальним потомкам.
   * 
   * ВАЖНО: Генерируется в фоне, не блокирует UI.
   * 
   * @param responseText - текст ответа для суммаризации
   */
  const generateSummary = useCallback(async (responseText: string) => {
    // Пропускаем слишком короткие ответы - summary не нужен
    if (!responseText || responseText.length < 100) {
      // Для коротких ответов используем сам ответ как summary
      updateNodeData(id, { summary: responseText });
      return;
    }

    // Устанавливаем флаг генерации summary
    updateNodeData(id, { isSummarizing: true });

    try {
      // Запрос к API суммаризации (без streaming)
      // Передаём API ключ и модель из настроек
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: responseText,
          apiKey: apiKey,
          apiBaseUrl: apiBaseUrl,
          model: model,
          // Корпоративный режим: отключает проверку SSL для корпоративных сетей
          corporateMode: corporateMode,
        }),
      });

      if (!response.ok) {
        console.error('Summary generation failed:', response.status);
        // При ошибке - используем начало ответа как fallback summary
        const fallbackSummary = responseText.slice(0, 200) + '...';
        updateNodeData(id, {
          summary: fallbackSummary,
          isSummarizing: false
        });
        return;
      }

      const data = await response.json();

      // Сохраняем summary в store
      updateNodeData(id, {
        summary: data.summary || responseText.slice(0, 200) + '...',
        isSummarizing: false
      });

    } catch (err) {
      console.error('Summary generation error:', err);
      // При ошибке - используем начало ответа как fallback summary
      const fallbackSummary = responseText.slice(0, 200) + '...';
      updateNodeData(id, {
        summary: fallbackSummary,
        isSummarizing: false
      });
    }
  }, [id, updateNodeData, apiKey, apiBaseUrl, model]);

  /**
   * Построение ИЕРАРХИЧЕСКОГО контекста из цепочки предков
   * 
   * КРИТИЧЕСКИ ВАЖНО: Эта функция должна формировать контекст ИДЕНТИЧНО
   * тому, что отображается в ContextViewerModal. Пользователь должен видеть
   * именно тот контекст, который передаётся в LLM для генерации ответа.
   * 
   * НОВОЕ: ПОДДЕРЖКА НЕСКОЛЬКИХ РОДИТЕЛЕЙ!
   * Если у карточки несколько прямых родителей (через parentIds),
   * контекст от каждого добавляется отдельным блоком.
   * 
   * ЛОГИКА КОНТЕКСТА (синхронизирована с ContextViewerModal):
   * - Если есть ЦИТАТА (quote) и источник совпадает с родителем - используем ЦИТАТУ
   * - Прямые родители без цитаты: получают ПОЛНЫЙ response
   * - Дедушки, прадедушки и далее: получают SUMMARY (краткую суть) или сокращённый response
   * 
   * Это позволяет:
   * 1. Цитатным карточкам фокусироваться на конкретном фрагменте
   * 2. Карточкам с несколькими родителями объединять контекст
   * 3. Прямым потомкам иметь полный контекст для детальных вопросов
   * 4. Более  /**
   * Построение контекста из родительских нод
   * Используется при генерации ответа
   * 
   * @returns строка контекста или undefined если нет родителей
   */
  const buildParentContext = useCallback((): string | undefined => {
    // Если нет прямых родителей - контекста нет
    if (directParents.length === 0) return undefined;

    // Получаем список исключенных нод
    const excludedIds = data.excludedContextNodeIds || [];

    const contextParts: string[] = [];

    // =======================================================================
    // ЧАСТЬ 1: КОНТЕКСТ ОТ ПРЯМЫХ РОДИТЕЛЕЙ
    // НОВОЕ: Поддержка НЕСКОЛЬКИХ родителей!
    // Если родителей несколько - каждый получает свой блок
    // 
    // ВАЖНО: Логика обработки цитаты должна быть идентична ContextViewerModal
    // (см. ContextViewerModal.tsx строки 173-197)
    // =======================================================================

    if (directParents.length === 1) {
      // ОДИН РОДИТЕЛЬ - стандартная логика
      const parent = directParents[0];

      // Проверяем исключение
      if (!excludedIds.includes(parent.id)) {
        if (parent && (parent.data.prompt || parent.data.response)) {
          const parentParts: string[] = [];
          parentParts.push('=== КОНТЕКСТ ИЗ РОДИТЕЛЬСКОЙ КАРТОЧКИ ===');

          if (parent.data.prompt) {
            parentParts.push(`Вопрос: ${parent.data.prompt}`);
          }

          // ЦИТИРОВАНИЕ: Передаем И цитату, И контекст
          if (data.quote && data.quoteSourceNodeId === parent.id) {
            // 1. Цитата (дословно)
            parentParts.push(`[Цитата]: "${data.quote}"`);

            // 2. Контекст (summary или полный ответ)
            // Пользователь хочет видеть и то и то
            if (useSummarization && parent.data.summary) {
              parentParts.push(`[Контекст]: ${parent.data.summary}`);
            } else if (parent.data.response) {
              parentParts.push(`[Контекст]: ${parent.data.response}`);
            }
          } else if (parent.data.response) {
            // Обычная карточка - полный ответ родителя
            parentParts.push(`Ответ: ${parent.data.response}`);
          }

          contextParts.push(parentParts.join('\n'));
        }
      }
    } else {
      // НЕСКОЛЬКО РОДИТЕЛЕЙ - добавляем контекст от каждого
      // ВАЖНО: Для каждого родителя проверяем цитату индивидуально
      // (логика идентична ContextViewerModal строка 173-197)
      directParents.forEach((parent, index) => {
        if (!parent) return;

        // Пропускаем исключенные
        if (excludedIds.includes(parent.id)) return;

        const parentParts: string[] = [];
        parentParts.push(`=== КОНТЕКСТ ИЗ РОДИТЕЛЬСКОЙ КАРТОЧКИ №${index + 1} ===`);

        if (parent.data.prompt) {
          parentParts.push(`Вопрос: ${parent.data.prompt}`);
        }

        // ЦИТИРОВАНИЕ:
        if (data.quote && data.quoteSourceNodeId === parent.id) {
          parentParts.push(`[Цитата]: "${data.quote}"`);
          if (useSummarization && parent.data.summary) {
            parentParts.push(`[Контекст]: ${parent.data.summary}`);
          } else if (parent.data.response) {
            parentParts.push(`[Контекст]: ${parent.data.response}`);
          }
        } else if (parent.data.response) {
          parentParts.push(`Ответ: ${parent.data.response}`);
        }

        contextParts.push(parentParts.join('\n'));
      });
    }

    // =======================================================================
    // ЧАСТЬ 2: ДЕДУШКИ И ДАЛЕЕ (КОНТЕКСТ ПРЕДКОВ)
    // =======================================================================
    // Используем summary для дальних предков, чтобы не перегружать контекст

    // Фильтруем предков:
    // 1. Исключаем прямых родителей (уже добавлены выше)
    // 2. Исключаем ноды из списка excludedIds
    const grandparents = ancestorChain.filter(
      (node) => !directParents.some((p) => p.id === node.id) && !excludedIds.includes(node.id)
    );

    /**
     * Вспомогательная функция: найти цитату на предка среди его потомков в цепочке
     * Если родитель или более близкий предок цитирует данного предка,
     * возвращаем эту цитату (она должна передаваться дальше по цепочке)
     */
    const findQuoteForAncestorSimpler = (ancestorId: string): string | null => {
      // Direct parents
      for (const parent of directParents) {
        if (parent.data.quoteSourceNodeId === ancestorId && parent.data.quote) return parent.data.quote;
      }
      // Ancestors - filter excluded ones? The quoter itself might be excluded?
      // If a NODE is excluded from context, its QUOTE should also probably be excluded, 
      // BUT current implementation only excludes the content/summary of that node.
      // If node A quotes B, and we exclude B, we don't see B's content.
      // If we exclude A, we don't see A's content AND A's quote of B?
      // Yes, if A is excluded, it's skipped entirely.

      // So here we only check non-excluded ancestors for quotes
      for (const ancestor of ancestorChain) {
        if (excludedIds.includes(ancestor.id)) continue;
        if (ancestor.id === ancestorId) continue;
        if (ancestor.data.quoteSourceNodeId === ancestorId && ancestor.data.quote) return ancestor.data.quote;
      }
      return null;
    };


    grandparents.forEach((ancestor, index) => {
      if (!ancestor) return;

      const ancestorParts: string[] = [];
      ancestorParts.push(`=== КОНТЕКСТ ПРЕДКА (Уровень -${index + 2}) ===`); // Условно

      if (ancestor.data.prompt) {
        ancestorParts.push(`Вопрос: ${ancestor.data.prompt}`);
      }

      // Check for quotes from descendants
      const quoteFromDescendant = findQuoteForAncestorSimpler(ancestor.id);

      if (quoteFromDescendant) {
        ancestorParts.push(`[Цитата (из потомка)]: "${quoteFromDescendant}"`);

        if (useSummarization && ancestor.data.summary) {
          ancestorParts.push(`[Контекст]: ${ancestor.data.summary}`);
        } else if (ancestor.data.response) {
          // Fallback truncate
          const text = !useSummarization ? ancestor.data.response : (ancestor.data.response.slice(0, 500) + '...');
          ancestorParts.push(`[Контекст]: ${text}`);
        }
      } else if (!useSummarization && ancestor.data.response) {
        // Full context mode
        ancestorParts.push(`Ответ: ${ancestor.data.response}`);
      } else if (ancestor.data.summary) {
        ancestorParts.push(`Суть ответа: ${ancestor.data.summary}`);
      } else if (ancestor.data.response) {
        // Fallback summary
        ancestorParts.push(`Суть ответа: ${ancestor.data.response.slice(0, 300)}...`);
      }

      contextParts.push(ancestorParts.join('\n'));
    });

    return contextParts.join('\n\n');
  }, [directParents, ancestorChain, data.quote, data.quoteSourceNodeId, useSummarization, data.excludedContextNodeIds]);

  /**
   * Запуск генерации AI ответа
   * Использует streaming для отзывчивого UI
   * ТЕПЕРЬ ПЕРЕДАЁТ КОНТЕКСТ РОДИТЕЛЬСКОЙ НОДЫ!
   */
  const handleGenerate = useCallback(async () => {
    // Проверяем что есть текст
    if (!localPrompt.trim()) return;

    // Отменяем предыдущий запрос если есть
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Создаём новый AbortController
    abortControllerRef.current = new AbortController();

    // Сбрасываем состояние
    setError(null);
    setStreamingText('');
    setIsGenerating(true);

    // Автоматически раскрываем ответную часть при генерации
    setIsAnswerExpanded(true);

    // Сохраняем промпт в store
    updateNodeData(id, {
      prompt: localPrompt,
      isGenerating: true,
      mode: 'result', // Переключаемся в Result mode
    });

    try {
      // Проверяем наличие API ключа
      if (!apiKey) {
        throw new Error(t.node.apiKeyMissing);
      }

      // Получаем контекст от родительской ноды
      const parentContext = buildParentContext();

      // Запрос к API с контекстом
      // Передаём API ключ и модель из настроек
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: localPrompt }
          ],
          // КРИТИЧНО: передаём контекст родителя!
          context: parentContext,
          // Передаём API ключ, базовый URL и модель для авторизации
          apiKey: apiKey,
          apiBaseUrl: apiBaseUrl,
          model: model,
          // Корпоративный режим: отключает проверку SSL для корпоративных сетей
          corporateMode: corporateMode,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Проверяем что есть body для streaming
      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Читаем stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Декодируем chunk
        const chunk = decoder.decode(value, { stream: true });

        // Парсим SSE формат (data: {...}\n\n)
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);

            // Проверяем на [DONE] маркер
            if (jsonStr === '[DONE]') continue;

            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content || '';

              if (content) {
                fullText += content;
                // Обновляем локальное состояние (НЕ store!)
                setStreamingText(fullText);
              }
            } catch {
              // Игнорируем ошибки парсинга отдельных chunks
            }
          }
        }
      }

      // Коммитим финальный результат в store
      updateNodeData(id, {
        response: fullText,
        isGenerating: false,
        isStale: false,
      });

      // =======================================================================
      // СОХРАНЕНИЕ ХЭША КОНТЕКСТА
      // Сохраняем "эталонный" хэш контекста с которым был сгенерирован ответ.
      // Это позволит автоматически снять stale если контекст вернётся к этому состоянию.
      // =======================================================================
      saveContextHash(id);

      // =======================================================================
      // УВЕДОМЛЕНИЕ О ЗАВЕРШЕНИИ В ПАКЕТНОМ РЕЖИМЕ
      // Если идёт пакетная регенерация - уведомляем store о завершении
      // Это позволяет перейти к следующему уровню когда все ноды текущего завершены
      // =======================================================================
      onBatchNodeComplete(id);

      // =======================================================================
      // ГЕНЕРАЦИЯ ЭМБЕДДИНГА ДЛЯ СЕМАНТИЧЕСКОГО ПОИСКА
      // После успешной генерации ответа вычисляем эмбеддинг карточки
      // и сохраняем в IndexedDB для последующего поиска.
      // Выполняется в фоне, не блокирует UI.
      // =======================================================================
      if (apiKey && embeddingsBaseUrl && embeddingsModel) {
        // Динамический импорт для ленивой загрузки модуля поиска
        import('@/lib/search/semantic').then(({ generateAndSaveEmbedding }) => {
          // Получаем ID текущего холста из workspace store
          import('@/store/useWorkspaceStore').then(({ useWorkspaceStore }) => {
            const canvasId = useWorkspaceStore.getState().activeCanvasId;
            if (canvasId) {
              // Передаём модель эмбеддингов для корректной векторизации
              generateAndSaveEmbedding(
                id,
                canvasId,
                localPrompt,
                fullText,
                apiKey,
                embeddingsBaseUrl,
                corporateMode,
                embeddingsModel
              )
                .then((success) => {
                  if (success) {
                    console.log('[NeuroNode] Эмбеддинг сохранён для карточки:', id, 'модель:', embeddingsModel);
                  }
                })
                .catch((err) => {
                  console.error('[NeuroNode] Ошибка генерации эмбеддинга:', err);
                });
            }
          });
        });
      }

      // Отмечаем что генерация была
      setHasGeneratedOnce(true);

      // =======================================================================
      // ГЕНЕРАЦИЯ SUMMARY (в фоне, не блокирует UI)
      // Summary используется для передачи контекста внукам и далее
      // 
      // ВАЖНО: Если суммаризация отключена в настройках - не генерируем summary,
      // так как всегда будет использоваться полный response
      // =======================================================================
      if (useSummarization) {
        generateSummary(fullText);
      }

    } catch (err) {
      // Игнорируем ошибки отмены
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }

      // Показываем ошибку
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);

      updateNodeData(id, {
        isGenerating: false,
      });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [id, localPrompt, updateNodeData, buildParentContext, generateSummary, useSummarization, apiKey, model, saveContextHash, onBatchNodeComplete, t.node.apiKeyMissing]);

  /**
   * Регенерация ответа
   * Сбрасывает response и summary, затем запускает генерацию заново
   */
  const handleRegenerate = useCallback(() => {
    // Сбрасываем ответ и summary, затем запускаем генерацию заново
    setStreamingText('');
    updateNodeData(id, {
      response: null,
      summary: null // Сбрасываем summary - будет сгенерирован заново
    });
    handleGenerate();
  }, [id, updateNodeData, handleGenerate]);

  /**
   * Ref для отслеживания уже обработанных pendingRegenerate
   * Предотвращает повторный запуск при ре-рендере
   */
  const pendingRegenerateHandledRef = useRef(false);

  /**
   * Авто-регенерация при установке флага pendingRegenerate
   * 
   * Используется:
   * - После обновления цитаты в карточке
   * - При пакетной регенерации устаревших карточек
   * 
   * Store устанавливает pendingRegenerate = true, этот эффект:
   * 1. Проверяет что ещё не обработали (через ref)
   * 2. Сразу вызывает handleRegenerate (без setTimeout!)
   * 3. Store сам сбросит флаг через updateNodeData в handleRegenerate
   * 
   * ВАЖНО: Этот useEffect ПОСЛЕ handleRegenerate (иначе ReferenceError)!
   */
  useEffect(() => {
    if (data.pendingRegenerate && localPrompt.trim() && !pendingRegenerateHandledRef.current) {
      console.log('[NeuroNode] Запуск авто-регенерации для:', id);

      // Помечаем как обработанное ДО вызова, чтобы избежать дублей
      pendingRegenerateHandledRef.current = true;

      // Сбрасываем флаг в store
      updateNodeData(id, { pendingRegenerate: false });

      // Вызываем регенерацию СИНХРОННО (без setTimeout)
      // setTimeout вызывал проблемы: cleanup отменял таймер при ре-рендере
      console.log('[NeuroNode] Вызов handleRegenerate для:', id);
      handleRegenerate();
    }

    // Сбрасываем ref когда pendingRegenerate становится false
    if (!data.pendingRegenerate) {
      pendingRegenerateHandledRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pendingRegenerate, id, localPrompt, updateNodeData, handleRegenerate]);

  /**
   * Остановка генерации ответа
   * 
   * Немедленно прерывает текущий fetch запрос через AbortController.
   * Это полностью прекращает связь с API и останавливает streaming.
   * 
   * ВАЖНО: Сохраняет уже сгенерированный текст в карточку!
   * Пользователь не теряет частично сгенерированный ответ.
   * 
   * Действия:
   * 1. Вызываем abort() на AbortController - отменяет fetch запрос
   * 2. Сохраняем текущий streamingText как response (если не пустой)
   * 3. Сбрасываем локальное состояние isGenerating
   * 4. Обновляем флаги в store
   * 5. Очищаем ссылку на AbortController
   */
  const handleAbortGeneration = useCallback(() => {
    // Отменяем текущий fetch запрос через AbortController
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Сбрасываем локальное состояние генерации
    setIsGenerating(false);

    // Сохраняем уже сгенерированный текст (если есть)
    // Это позволяет не терять частично сгенерированный ответ
    if (streamingText.trim()) {
      updateNodeData(id, {
        response: streamingText,
        isGenerating: false,
        isStale: false, // Сбрасываем stale - ответ актуален
      });

      // Отмечаем что генерация была (для UI)
      setHasGeneratedOnce(true);

      console.log('[NeuroNode] Генерация остановлена, сохранён частичный ответ:', streamingText.length, 'символов');
    } else {
      // Текста нет - просто обновляем флаг
      updateNodeData(id, { isGenerating: false });
      console.log('[NeuroNode] Генерация остановлена (текст не сгенерирован)');
    }
  }, [id, updateNodeData, streamingText]);

  /**
   * Копирование ответа в буфер обмена
   */
  const handleCopy = useCallback(async () => {
    const textToCopy = data.response || streamingText;
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [data.response, streamingText]);

  /**
   * Удаление ноды
   */
  const handleDelete = useCallback(() => {
    // Отменяем текущую генерацию если есть
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    removeNode(id);
  }, [id, removeNode]);

  /**
   * Переключение раскрытости ответной части
   * Обновляет как локальное состояние, так и store для синхронизации
   */
  const handleToggleAnswer = useCallback(() => {
    const newValue = !isAnswerExpanded;
    setIsAnswerExpanded(newValue);
    // Синхронизируем со store для персистентности и глобальных хоткеев
    updateNodeData(id, { isAnswerExpanded: newValue });
  }, [isAnswerExpanded, id, updateNodeData]);

  /**
   * Обработчик колёсика мыши для ответной части
   * 
   * УМНОЕ ПОВЕДЕНИЕ:
   * - Если контент НЕ требует скролла → пропускаем событие → холст зуммируется
   * - Если контент требует скролла → блокируем событие → контент прокручивается
   * - Edge-case: если достигли края скролла и продолжаем крутить в ту же сторону
   *   → пропускаем событие → холст зуммируется
   * 
   * Это создаёт интуитивный UX:
   * - Короткие ответы не мешают зумить холст
   * - Длинные ответы можно прокручивать
   * - При достижении края переключаемся на зум
   */
  const handleAnswerWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const scrollContainer = answerScrollRef.current;

    // Если контейнера нет - пропускаем событие (на всякий случай)
    if (!scrollContainer) return;

    // =======================================================================
    // СЛУЧАЙ 1: Нет вертикального скролла
    // Контент помещается полностью → колёсико должно зуммировать холст
    // НЕ блокируем событие, позволяя React Flow обработать его
    // =======================================================================
    if (!hasVerticalScroll) {
      // Не вызываем stopPropagation() - событие уйдёт в React Flow
      return;
    }

    // =======================================================================
    // СЛУЧАЙ 2: Есть скролл - проверяем edge-cases
    // Если достигли края и продолжаем крутить в ту же сторону → зум холста
    // =======================================================================

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const isAtTop = scrollTop <= 0;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1; // -1 для погрешности

    // Направление прокрутки: deltaY > 0 = вниз, deltaY < 0 = вверх
    const scrollingDown = e.deltaY > 0;
    const scrollingUp = e.deltaY < 0;

    // Edge-case: достигли верха и крутим вверх → зум
    if (isAtTop && scrollingUp) {
      // Не блокируем - пусть React Flow зуммирует
      return;
    }

    // Edge-case: достигли низа и крутим вниз → зум
    if (isAtBottom && scrollingDown) {
      // Не блокируем - пусть React Flow зуммирует
      return;
    }

    // =======================================================================
    // СЛУЧАЙ 3: Скролл есть и не на краю → прокручиваем контент
    // Блокируем событие чтобы React Flow не получил его
    // =======================================================================
    e.stopPropagation();
  }, [hasVerticalScroll]);

  // ===========================================================================
  // ОБРАБОТЧИКИ ЦИТИРОВАНИЯ
  // ===========================================================================

  /**
   * Включение режима цитирования
   * Позволяет пользователю выделить текст для создания цитатной карточки
   */
  const handleEnterQuoteMode = useCallback(() => {
    setIsQuoteMode(true);
    setSelectedQuoteText('');
  }, []);

  /**
   * Выход из режима цитирования
   * Сбрасывает все состояния цитирования (локальные и в store)
   */
  const handleExitQuoteMode = useCallback(() => {
    setIsQuoteMode(false);
    setSelectedQuoteText('');
    // Снимаем выделение текста
    window.getSelection()?.removeAllRanges();
    // Сбрасываем флаг в store (если был установлен извне)
    if (data.isQuoteModeActive) {
      clearQuoteModeActive(id);
    }
  }, [id, data.isQuoteModeActive, clearQuoteModeActive]);

  /**
   * Обработчик события mouseup для отслеживания выделения текста
   * 
   * Вызывается когда пользователь отпускает кнопку мыши после выделения.
   * Проверяет, есть ли выделенный текст внутри контейнера ответа.
   */
  const handleTextSelection = useCallback(() => {
    // Работаем только в режиме цитирования
    if (!isQuoteMode) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      // Нет выделения
      setSelectedQuoteText('');
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setSelectedQuoteText('');
      return;
    }

    // Проверяем что выделение внутри контейнера ответа
    const range = selection.getRangeAt(0);
    const container = answerContentRef.current;

    if (!container || !container.contains(range.commonAncestorContainer)) {
      // Выделение вне контейнера ответа - игнорируем
      return;
    }

    setSelectedQuoteText(selectedText);
  }, [isQuoteMode]);

  /**
   * Создание карточки на основе выделенной цитаты
   * 
   * Логика:
   * - Если quoteModeInitiatedByNodeId установлен (режим инициирован дочерней карточкой)
   *   → обновляем цитату в этой дочерней карточке через updateQuote
   * - Иначе (режим инициирован локально)
   *   → создаём новую цитатную карточку через createQuoteNode
   */
  const handleCreateQuoteCard = useCallback(() => {
    if (!selectedQuoteText || !data.response) return;

    // Проверяем: режим был инициирован дочерней карточкой?
    if (data.quoteModeInitiatedByNodeId) {
      // Обновляем цитату в дочерней карточке
      updateQuote(
        data.quoteModeInitiatedByNodeId, // ID дочерней карточки
        selectedQuoteText,                // Новый текст цитаты
        id,                               // ID этой ноды (источник цитаты)
        data.response                     // Текущий response для отслеживания изменений
      );

      console.log(
        '[NeuroNode] Обновлена цитата в дочерней карточке:',
        data.quoteModeInitiatedByNodeId,
        'новая цитата:',
        selectedQuoteText.slice(0, 50) + '...'
      );
    } else {
      // Создаём новую цитатную карточку
      createQuoteNode(id, selectedQuoteText);
    }

    // Выходим из режима цитирования
    handleExitQuoteMode();
  }, [
    selectedQuoteText,
    data.response,
    data.quoteModeInitiatedByNodeId,
    id,
    updateQuote,
    createQuoteNode,
    handleExitQuoteMode
  ]);

  /**
   * Сброс инвалидации цитаты и очистка полей
   * Позволяет пользователю выделить новую цитату
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleClearQuoteInvalidation = useCallback(() => {
    clearQuoteInvalidation(id);
  }, [id, clearQuoteInvalidation]);

  /**
   * Инициация выбора новой цитаты в родительской карточке
   * 
   * Вызывается когда пользователь нажимает "Выделить новую цитату"
   * в карточке с инвалидированной цитатой.
   * 
   * Действия:
   * 1. Активирует родительскую карточку
   * 2. Разворачивает её ответную часть
   * 3. Включает режим цитирования в родительской карточке
   */
  const handleInitiateQuoteSelectionInParent = useCallback(() => {
    initiateQuoteSelectionInParent(id);
  }, [id, initiateQuoteSelectionInParent]);

  /**
   * Обновление цитаты в текущей карточке
   * Используется когда у карточки уже была цитата, но она инвалидирована
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleUpdateQuote = useCallback(() => {
    if (!selectedQuoteText || !parentNode?.data.response) return;

    // Обновляем цитату
    updateQuote(id, selectedQuoteText, parentNode.id, parentNode.data.response);

    // Выходим из режима цитирования
    handleExitQuoteMode();
  }, [selectedQuoteText, parentNode, id, updateQuote, handleExitQuoteMode]);

  /**
   * Открытие модального окна контекста
   */
  const handleOpenContextModal = useCallback(() => {
    setIsContextModalOpen(true);
  }, []);

  /**
   * Обработчик переключения исключения ноды из контекста
   */
  const handleToggleContextItem = useCallback((targetNodeId: string) => {
    // Получаем текущий список исключенных
    const currentExcluded = data.excludedContextNodeIds || [];

    let newExcluded: string[];

    if (currentExcluded.includes(targetNodeId)) {
      // Существует -> удаляем (включаем обратно)
      newExcluded = currentExcluded.filter(id => id !== targetNodeId);
    } else {
      // Не существует -> добавляем (исключаем)
      newExcluded = [...currentExcluded, targetNodeId];
    }

    // Обновляем данные ноды
    updateNodeData(id, { excludedContextNodeIds: newExcluded });
  }, [data.excludedContextNodeIds, id, updateNodeData]);

  // ===========================================================================
  // ОБРАБОТЧИКИ RESIZE (ИЗМЕНЕНИЕ ШИРИНЫ КАРТОЧКИ)
  // ===========================================================================

  /**
   * Начало resize при mousedown на ручке
   * 
   * Сохраняет начальные значения и активирует режим resize.
   * КРИТИЧНО: stopPropagation предотвращает перетаскивание карточки.
   */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    // Предотвращаем перетаскивание карточки и другие действия
    e.preventDefault();
    e.stopPropagation();

    // Сохраняем начальные значения в refs
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = resizeWidth;

    // Активируем режим resize
    setIsResizing(true);
  }, [resizeWidth]);

  // ===========================================================================
  // ВЫЧИСЛЯЕМЫЕ ЗНАЧЕНИЯ
  // ===========================================================================

  /**
   * Текст для отображения (streaming или финальный)
   */
  const displayText = isGenerating ? streamingText : data.response;

  /**
   * Есть ли контент для отображения
   */
  const hasContent = Boolean(displayText);

  /**
   * Есть ли контекст от предков
   * Проверяем наличие response у любого прямого родителя ИЛИ summary у более дальних предков
   */
  const hasParentContext = Boolean(
    directParents.some((p) => p.data.response) ||
    ancestorChain.some((node) => node.data.summary)
  );

  /**
   * Показывать ли ответную часть (есть контент или идёт генерация или была ошибка)
   */
  const showAnswerSection = hasContent || isGenerating || error;

  /**
   * Мемоизированный Markdown компонент для производительности
   */
  const memoizedMarkdown = useMemo(() => (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {displayText || ''}
    </ReactMarkdown>
  ), [displayText]);

  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================

  return (
    <div
      className={cn(
        'neuro-node-wrapper relative',
        // Во время resize отключаем transition для мгновенного отклика
        isResizing && 'neuro-node-wrapper--resizing'
      )}
      style={{
        width: resizeWidth,
      }}
    >
      {/* ===================================================================
          ОСНОВНАЯ КАРТОЧКА
          =================================================================== */}
      <div
        className={cn(
          // Базовые стили карточки
          'neuro-node',
          'bg-card rounded-xl border border-border',
          'shadow-lg backdrop-blur-sm',

          // Анимация морфинга
          'transition-all duration-300 ease-out',

          // Состояние выделения
          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',

          // STALE состояние - ЯРКИЙ ОРАНЖЕВЫЙ!
          data.isStale && !data.isQuoteInvalidated && 'neuro-node--stale',

          // ЦИТАТА ИНВАЛИДИРОВАНА - КРАСНАЯ ПОДСВЕТКА!
          data.isQuoteInvalidated && 'neuro-node--quote-invalid'
        )}
      >
        {/* =================================================================
            QUESTION SECTION (верхняя часть)
            Содержит: вопрос, badges, кнопки
            Handle позиционируются по центру этой секции
            ================================================================= */}
        <div
          ref={questionSectionRef}
          className="neuro-question-section relative p-4"
        >
          {/* --- HANDLE: ВХОД (левая сторона) - по центру question section --- */}
          <Handle
            type="target"
            position={Position.Left}
            className={cn(
              'neuro-handle',
              // Увеличенный размер для лёгкого попадания
              '!w-6 !h-6',
              '!bg-primary !border-2 !border-background',
              // Позиционирование по центру question section
              '!absolute !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2',
            )}
          />

          {/* --- HANDLE: ВЫХОД (правая сторона) - по центру question section --- */}
          <Handle
            type="source"
            position={Position.Right}
            className={cn(
              'neuro-handle',
              // Увеличенный размер для лёгкого попадания
              '!w-6 !h-6',
              '!bg-primary !border-2 !border-background',
              // Позиционирование по центру question section
              '!absolute !right-0 !top-1/2 !translate-x-1/2 !-translate-y-1/2',
            )}
          />

          {/* Контекст родителя badge - КЛИКАБЕЛЬНЫЙ */}
          {hasParentContext && !data.isStale && (
            <button
              onClick={() => setIsContextModalOpen(true)}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'flex items-center gap-1 text-xs mb-2',
                // Цвет зависит от фильтрации
                data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0
                  ? 'text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30'
                  : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30',
                // Стили кнопки
                'rounded-md px-2 py-1 -ml-2',
                'transition-colors duration-150',
                'cursor-pointer',
                // Предотвращаем перетаскивание карточки при клике
                'nodrag'
              )}
              title={t.node.viewFullContext}
            >
              <span className={cn(
                "w-2 h-2 rounded-full",
                data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0
                  ? "bg-orange-500"
                  : "bg-blue-500"
              )} />
              <span className={cn(
                "underline underline-offset-2",
                data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0
                  ? "decoration-orange-400/50"
                  : "decoration-blue-400/50"
              )}>
                {directParents.length > 1
                  ? format(t.node.multipleParentContextUsed, { count: directParents.length })
                  : t.node.parentContextUsed
                }
                {data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0 && " *"}
              </span>
            </button>
          )}

          {/* Stale badge - ЯРКИЙ с кнопкой регенерации */}
          {data.isStale && !data.isQuoteInvalidated && (
            <div
              className={cn(
                'flex items-center justify-between gap-2 mb-2 p-2 rounded-lg',
                'bg-orange-50 dark:bg-orange-950/30',
                'border border-orange-200 dark:border-orange-800'
              )}
            >
              <div className="flex items-center gap-1.5 text-xs text-orange-700 dark:text-orange-300 font-medium">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  {directParents.length > 0
                    ? t.node.staleConnections
                    : t.node.staleContext
                  }
                </span>
              </div>
              {/* Кнопка быстрой регенерации */}
              {localPrompt.trim() && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerate}
                  onPointerDown={(e) => e.stopPropagation()}
                  disabled={isGenerating}
                  className={cn(
                    'h-6 px-2 text-xs',
                    'text-orange-700 dark:text-orange-300',
                    'hover:bg-orange-100 dark:hover:bg-orange-900/50',
                    'nodrag'
                  )}
                  title={t.node.regenerateResponse}
                >
                  {isGenerating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3 mr-1" />
                      {t.common.update}
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* =================================================================
              СЕКЦИЯ ЦИТАТЫ (если карточка создана на основе цитаты)
              Показывает выделенный фрагмент текста из родительской ноды
              БЕЗ nodrag - позволяет перемещать карточку за эту область
              user-select: none в CSS запрещает выделение текста
              ================================================================= */}
          {data.quote && (
            <div
              className={cn(
                'quote-section mb-3 p-3 rounded-lg',
                'bg-muted/50 border-l-4',
                // Обычное состояние - синяя граница
                !data.isQuoteInvalidated && 'border-primary',
                // Инвалидированное состояние - красная граница и фон
                data.isQuoteInvalidated && 'border-red-500 bg-red-50/10 dark:bg-red-950/20'
              )}
            >
              {/* Заголовок секции с кнопкой изменения */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Quote className="w-3.5 h-3.5" />
                  <span>{t.node.quoteFromParent}</span>
                </div>

              </div>

              {/* Текст цитаты */}
              <blockquote className={cn(
                'text-sm italic text-foreground/80',
                'pl-2 border-l-2 border-muted-foreground/30'
              )}>
                &ldquo;{data.quote}&rdquo;
              </blockquote>

              {/* Предупреждение об инвалидации */}
              {data.isQuoteInvalidated && (
                <div className="mt-3 p-2 rounded bg-red-100/50 dark:bg-red-900/30">
                  <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium mb-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{t.node.quoteInvalidated}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleInitiateQuoteSelectionInParent}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="text-xs h-7 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950 nodrag"
                  >
                    <RefreshCw className="w-3 h-3 mr-1.5" />
                    {t.node.selectNewQuote}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Поле ввода вопроса с кнопкой генерации справа */}
          {/* flex items-end - кнопка прижата к нижнему краю поля ввода */}
          <div className="flex items-end gap-2">
            {isEditing ? (
              <TextareaAutosize
                ref={textareaRef}
                value={localPrompt}
                onChange={handlePromptChange}
                onBlur={handlePromptBlur}
                onKeyDown={handleKeyDown}
                placeholder={hasParentContext ? t.node.promptPlaceholderWithContext : t.node.promptPlaceholder}
                minRows={1}
                autoFocus
                // Без maxRows - поле растёт без ограничений
                className={cn(
                  // flex-1 занимает всё доступное пространство, кроме кнопки
                  // min-w-0 - КРИТИЧНО для переноса текста в flex-контейнере!
                  'flex-1 min-w-0 resize-none overflow-hidden',
                  'text-sm font-medium',
                  // Округлённые углы и равномерный padding (кнопка теперь снаружи)
                  'rounded-lg p-3',
                  // Фон и граница
                  'bg-muted/30 border border-transparent',
                  // Фокус - подсветка
                  'focus:bg-muted/50 focus:border-primary/30',
                  'focus:outline-none focus:ring-0',
                  // Placeholder
                  'placeholder:text-muted-foreground/50',
                  // Анимация
                  'transition-all duration-200',
                  // КРИТИЧНО: Классы React Flow для предотвращения
                  // перехвата событий при работе с текстом!
                  // nodrag - предотвращает drag ноды при выделении текста мышью
                  // nopan - предотвращает pan холста при drag внутри textarea
                  // БЕЗ nowheel - колёсико мыши масштабирует холст (скролла в textarea нет)
                  'nodrag nopan',
                  // Кастомный класс для улучшенных стилей курсора и выделения
                  'neuro-textarea'
                )}
              />
            ) : (
              /* Режим просмотра - div вместо textarea для возможности перетаскивания */
              <div
                onDoubleClick={() => setIsEditing(true)}
                className={cn(
                  // flex-1 занимает всё доступное пространство, кроме кнопки
                  // min-w-0 - КРИТИЧНО для переноса текста в flex-контейнере!
                  // Без этого flex-item не сужается меньше content size и текст не переносится
                  // min-h-[46px] - одинаковая минимальная высота как у textarea с 1 строкой
                  'flex-1 min-w-0 min-h-[46px]',
                  'text-sm font-medium',
                  // Равномерный padding (кнопка теперь снаружи)
                  'rounded-lg p-3',
                  'bg-muted/30 border border-transparent',
                  'text-foreground',
                  // Курсор рука для перетаскивания
                  'cursor-grab active:cursor-grabbing',
                  // Перенос слов
                  'whitespace-pre-wrap break-words',
                  // overflow-hidden предотвращает выход текста за границы
                  'overflow-hidden',
                  // ВАЖНО: НЕТ класса nodrag - это позволяет таскать ноду за этот элемент!
                )}
              >
                {localPrompt || (
                  <span className="text-muted-foreground/50">
                    {hasParentContext ? t.node.promptPlaceholderWithContext : t.node.promptPlaceholder}
                  </span>
                )}
              </div>
            )}

            {/* Кнопка генерации / остановки - справа от поля ввода, прижата к низу */}
            {/* КРИТИЧНО: nodrag + stopPropagation предотвращают перехват клика React Flow */}
            {/* 
              Логика кнопки:
              - При isGenerating = true: красная кнопка с квадратиком (stop) для остановки
              - При isGenerating = false: синяя кнопка с молнией для генерации/регенерации
              
              mb-2 - отступ снизу для центрирования с однострочным полем ввода
            */}
            <button
              onClick={isGenerating ? handleAbortGeneration : (hasContent ? handleRegenerate : handleGenerate)}
              onPointerDown={(e) => e.stopPropagation()}
              // Кнопка НЕ disabled во время генерации - иначе нельзя будет остановить!
              // Disabled только когда нет текста И не идёт генерация
              disabled={!localPrompt.trim() && !isGenerating}
              className={cn(
                // flex-shrink-0 - кнопка не сжимается
                // mb-2 - отступ снизу для центрирования с однострочным полем ввода (8px)
                'flex-shrink-0 mb-2',
                'w-8 h-8 rounded-md',
                'flex items-center justify-center',
                'transition-all duration-150',
                'shadow-sm hover:shadow-md',
                // nodrag предотвращает начало drag-операции при клике
                'nodrag',
                // Разные стили для режима генерации и обычного режима
                isGenerating ? [
                  // РЕЖИМ ГЕНЕРАЦИИ: красная кнопка остановки
                  'bg-red-500 text-white',
                  'hover:bg-red-600',
                ] : [
                  // ОБЫЧНЫЙ РЕЖИМ: синяя кнопка генерации
                  'bg-primary text-primary-foreground',
                  'hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                ]
              )}
              title={isGenerating ? t.node.stopGeneration : (hasContent ? t.node.regenerateResponse : t.node.generateResponse)}
            >
              {isGenerating ? (
                // Квадратик (stop) во время генерации - для остановки
                <Square className="w-4 h-4 fill-current" />
              ) : (
                // Иконка молнии для генерации и регенерации
                <Zap className="w-4 h-4" />
              )}
            </button>
          </div>

        </div>

        {/* =================================================================
            ANSWER SECTION (нижняя часть) - выезжающий слайдер
            Фиксированная высота 400px с вертикальным скроллом
            ================================================================= */}
        {showAnswerSection && (
          <div className="relative">
            {/* Панель управления ответом - кнопки копирования, цитирования, toggle, удаления */}
            {/* БЕЗ nodrag на контейнере - позволяет перемещать карточку за эту область */}
            {/* neuro-answer-toolbar запрещает выделение текста (см. globals.css) */}
            {/* nodrag остаётся ТОЛЬКО на кнопках внутри */}
            <div
              className="neuro-answer-toolbar flex items-center justify-between px-2 py-1 border-t border-border bg-muted/30"
            >
              {/* Левая часть: кнопки копирования и цитирования */}
              {/* КРИТИЧНО: Все кнопки имеют nodrag + onPointerDown stopPropagation */}
              <div className="flex items-center gap-1">
                {/* Кнопка копирования */}
                {hasContent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="h-8 w-8 p-0 nodrag"
                    title={t.node.copyResponse}
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                )}

                {/* Кнопка цитирования */}
                {hasContent && !isGenerating && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant={isQuoteMode ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={isQuoteMode ? handleExitQuoteMode : handleEnterQuoteMode}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={cn(
                        'h-8 w-8 p-0 nodrag',
                        isQuoteMode && 'bg-primary/20 text-primary'
                      )}
                      title={isQuoteMode ? t.node.cancelQuote : t.node.selectQuote}
                    >
                      {isQuoteMode ? (
                        <X className="w-4 h-4" />
                      ) : (
                        <Quote className="w-4 h-4" />
                      )}
                    </Button>

                    {/* Кнопка создания/обновления карточки (только когда есть выделение) */}
                    {isQuoteMode && selectedQuoteText && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCreateQuoteCard}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="h-8 px-2 text-primary hover:text-primary hover:bg-primary/10 gap-1.5 animate-in fade-in slide-in-from-left-2 duration-200 nodrag"
                        title={data.quoteModeInitiatedByNodeId
                          ? t.node.updateQuote
                          : t.node.createQuoteCard
                        }
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span className="text-xs font-medium">
                          {data.quoteModeInitiatedByNodeId ? t.common.update : t.common.create}
                        </span>
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Центральная часть: кнопка раскрытия/скрытия ответа */}
              {/* КРИТИЧНО: nodrag + stopPropagation предотвращают перехват клика React Flow */}
              <button
                onClick={handleToggleAnswer}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  'px-4 py-1.5 rounded-full',
                  'bg-primary/10 hover:bg-primary/20 text-primary',
                  'flex items-center gap-1.5',
                  'text-xs font-medium',
                  'transition-all duration-200',
                  'hover:shadow-sm',
                  // nodrag предотвращает начало drag-операции при клике
                  'nodrag'
                )}
                title={isAnswerExpanded ? t.node.hideResponse : t.node.showResponse}
              >
                {isAnswerExpanded ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    <span>{t.node.hideResponse}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    <span>{t.node.showResponse}</span>
                  </>
                )}
              </button>

              {/* Правая часть: кнопка удаления + ручка resize */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive nodrag"
                  title={t.node.deleteCard}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>

                {/* ===============================================================
                    RESIZE HANDLE (РУЧКА ИЗМЕНЕНИЯ ШИРИНЫ)
                    
                    Компактная ручка на правом краю toolbar для изменения ширины.
                    Работает через drag: mousedown → mousemove → mouseup
                    
                    Расположение в toolbar решает проблемы:
                    1. Не перекрывает Handle для создания связей
                    2. Всегда в одном месте независимо от высоты карточки
                    3. Визуально понятно что это ручка (иконка GripVertical)
                    =============================================================== */}
                <div
                  onMouseDown={handleResizeStart}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    'neuro-resize-handle',
                    // Размер и форма
                    'h-8 w-4 -mr-2',
                    // Flex для центрирования иконки
                    'flex items-center justify-center',
                    // Курсор изменения размера
                    'cursor-ew-resize',
                    // Цвет иконки
                    'text-muted-foreground/50',
                    // Hover эффект
                    'hover:text-muted-foreground hover:bg-muted/50',
                    // Активное состояние
                    isResizing && 'text-primary bg-primary/10',
                    // Скругление справа
                    'rounded-r-lg',
                    // Плавная анимация
                    'transition-colors duration-150',
                    // Предотвращаем перетаскивание карточки
                    'nodrag'
                  )}
                  title={t.node.resizeCard}
                >
                  <GripVertical className="w-3 h-4" />
                </div>
              </div>
            </div>

            {/* Контент ответа со слайд-анимацией */}
            <div
              className={cn(
                'neuro-answer-section',
                'overflow-hidden transition-all duration-300 ease-out',
                isAnswerExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
              )}
            >
              {/* 
                Scrollable контейнер ответной части
                
                УМНОЕ ПОВЕДЕНИЕ КОЛЁСИКА:
                - Класс "nowheel" добавляется ТОЛЬКО когда есть вертикальный скролл
                - Если скролла нет → колёсико зуммирует холст (nowheel отсутствует)
                - Если скролл есть → колёсико прокручивает контент (nowheel присутствует)
                - Edge-cases обрабатываются в handleAnswerWheel
                
                nodrag предотвращает начало drag карточки при клике на контент ответа
              */}
              <div
                ref={answerScrollRef}
                onWheel={handleAnswerWheel}
                className={cn(
                  'p-4 overflow-y-auto',
                  // Динамически добавляем nowheel только при наличии скролла
                  // Это говорит React Flow не перехватывать wheel события
                  hasVerticalScroll && 'nowheel'
                )}
                style={{ maxHeight: ANSWER_SECTION_HEIGHT }}
              >
                {/* Loading state */}
                {isGenerating && !hasContent && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                )}

                {/* Error state */}
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Markdown content с поддержкой цитирования */}
                {hasContent && (
                  <div
                    ref={answerContentRef}
                    onMouseUp={handleTextSelection}
                    className={cn(
                      'relative', // Для позиционирования тулбара цитирования
                      // Режим цитирования - подсветка и разрешаем выделение текста
                      isQuoteMode && 'quote-mode-active',
                      // React Flow: nodrag и nopan ТОЛЬКО в режиме цитирования (чтобы можно было выделять)
                      // Без режима цитирования - карточку можно перемещать за ответную часть
                      isQuoteMode && 'nodrag nopan select-text'
                    )}
                  >
                    {/* Индикатор режима цитирования */}
                    {isQuoteMode && (
                      <div className="mb-3 p-2 rounded-lg bg-primary/10 border border-primary/30">
                        <div className="flex items-center gap-2 text-xs text-primary font-medium">
                          <Quote className="w-3.5 h-3.5" />
                          <span>
                            {data.quoteModeInitiatedByNodeId
                              ? t.node.selectTextForQuoteUpdate
                              : t.node.selectTextForQuote
                            }
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Мини-тулбар над/под выделением */}
                    {/* УБРАН ПО ЗАПРОСУ: теперь кнопка в панели инструментов */}

                    {/* Markdown контент */}
                    <div className={cn(
                      'prose prose-sm dark:prose-invert max-w-none',
                      'prose-headings:mt-4 prose-headings:mb-2',
                      'prose-p:my-2 prose-p:leading-relaxed',
                      'prose-ul:my-2 prose-ol:my-2',
                      'prose-li:my-0.5',
                      'prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
                      'prose-pre:bg-muted prose-pre:p-3',
                      // Streaming cursor effect
                      isGenerating && 'streaming-cursor',
                      // Режим цитирования - изменённый курсор
                      isQuoteMode && 'cursor-text'
                    )}>
                      {memoizedMarkdown}
                      {/* Курсор при streaming */}
                      {isGenerating && (
                        <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <ContextViewerModal
        isOpen={isContextModalOpen}
        onClose={() => setIsContextModalOpen(false)}
        directParents={directParents}
        ancestorChain={ancestorChain}
        quote={data.quote}
        quoteSourceNodeId={data.quoteSourceNodeId}
        excludedContextNodeIds={data.excludedContextNodeIds}
        onToggleContextItem={handleToggleContextItem}
      />

      {/* Индикатор ширины во время resize */}
      {isResizing && (
        <div
          className={cn(
            'absolute -bottom-8 left-1/2 -translate-x-1/2',
            'px-2 py-1 rounded-md',
            'bg-primary text-primary-foreground',
            'text-xs font-mono font-medium',
            'shadow-lg',
            'animate-in fade-in zoom-in-95 duration-150'
          )}
        >
          {Math.round(resizeWidth)}px
        </div>
      )}
    </div>
  );
};

// =============================================================================
// МЕМОИЗАЦИЯ (КРИТИЧНО ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ!)
// =============================================================================

/**
 * Мемоизированная версия компонента
 * Предотвращает лишние ре-рендеры при обновлении других нод
 */
export const NeuroNode = memo(NeuroNodeComponent);
