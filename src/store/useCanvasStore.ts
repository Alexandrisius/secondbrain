/**
 * @file useCanvasStore.ts
 * @description Zustand store для управления состоянием Canvas
 * Использует Immer для иммутабельных обновлений вложенных структур
 * 
 * ПЕРСИСТЕНТНОСТЬ:
 * Данные автоматически сохраняются в JSON файл через API при каждом изменении.
 * Используется debounce (1 сек) для оптимизации количества запросов.
 * 
 * UNDO/REDO:
 * Система истории реализована через zundo middleware.
 * Поддерживает до 50 шагов истории с группировкой быстрых изменений (debounce 500ms).
 * При undo/redo автоматически синхронизируются поисковые индексы.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import type {
  CanvasStore,
  NeuroNode,
  NeuroEdge,
  NeuroNodeData,
} from '@/types/canvas';

// =============================================================================
// ИМПОРТЫ ДЛЯ ОЧИСТКИ ПОИСКОВЫХ ИНДЕКСОВ ПРИ УДАЛЕНИИ КАРТОЧЕК
// =============================================================================

import { deleteEmbedding, syncEmbeddingsWithCanvas } from '@/lib/db/embeddings';
import { getGlobalHybridEngine } from '@/lib/search';

// =============================================================================
// КОНСТАНТЫ ДЛЯ UNDO/REDO
// =============================================================================

/**
 * Максимальное количество шагов в истории undo
 */
const HISTORY_LIMIT = 50;

/**
 * Задержка для группировки быстрых изменений в один шаг истории (мс)
 * Например, быстрый ввод текста группируется в один шаг
 */
const HISTORY_DEBOUNCE = 500;

/**
 * Флаг: идёт ли операция undo/redo
 * Используется для предотвращения удаления индексов при восстановлении состояния
 */
let isUndoRedoOperation = false;

// =============================================================================
// ТИПЫ ДЛЯ ПЕРСИСТЕНТНОСТИ
// =============================================================================

/**
 * Расширенный интерфейс store с функциями персистентности
 */
export interface CanvasStoreWithPersistence extends CanvasStore {
  /** ID текущего холста (для загрузки/сохранения) */
  currentCanvasId: string | null;
  /** Флаг: идёт ли загрузка данных из файла */
  isLoading: boolean;
  /** Флаг: идёт ли сохранение данных в файл */
  isSaving: boolean;
  /** Временная метка последнего сохранения */
  lastSaved: number | null;
  /** Есть ли несохранённые изменения */
  hasUnsavedChanges: boolean;
  /** Ошибка при сохранении/загрузке */
  persistError: string | null;

  /**
   * ID карточки для центрирования после перехода на другой холст (из поиска)
   * Хранится в store, а не в локальном state, чтобы пережить перемонтирование компонента
   */
  searchTargetNodeId: string | null;

  /** Загрузить данные холста по ID */
  loadFromFile: (canvasId?: string) => Promise<void>;
  /** Сохранить данные в файл */
  saveToFile: () => Promise<void>;
  /** Сбросить ошибку персистентности */
  clearPersistError: () => void;
  /** Установить текущий ID холста */
  setCurrentCanvasId: (canvasId: string | null) => void;
  /** Установить ID карточки для центрирования после загрузки холста */
  setSearchTargetNodeId: (nodeId: string | null) => void;
}

// =============================================================================
// ТИПЫ ДЛЯ UNDO/REDO
// =============================================================================

/**
 * Состояние, которое отслеживается историей undo/redo
 * Включает только данные карточек и связей (без UI-состояний)
 */
export interface HistoryState {
  /** Массив нод (карточек) */
  nodes: NeuroNode[];
  /** Массив связей между нодами */
  edges: NeuroEdge[];
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Генерация уникального ID для новой ноды
 * Использует timestamp + случайную строку для уникальности
 */
const generateNodeId = (): string => {
  return `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Генерация уникального ID для связи между нодами
 */
const generateEdgeId = (source: string, target: string): string => {
  return `edge-${source}-${target}`;
};

/**
 * Простой и быстрый хэш-алгоритм djb2
 * Используется для вычисления хэша контекста карточки
 * 
 * @param str - строка для хэширования
 * @returns хэш в виде hex-строки
 */
const djb2Hash = (str: string): string => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    // Приводим к 32-битному числу
    hash = hash >>> 0;
  }
  return hash.toString(16);
};

/**
 * Нормализация текста для вычисления хэша
 * 
 * Применяется ко всем текстовым полям перед хэшированием:
 * - trim(): удаление пробелов в начале и конце
 * - toLowerCase(): приведение к нижнему регистру
 * 
 * Это позволяет:
 * - "  Hello  " и "Hello" давать одинаковый хэш
 * - "Hello" и "hello" давать одинаковый хэш
 * - Избежать ложных срабатываний stale при незначительных изменениях
 * 
 * @param text - исходный текст (может быть null/undefined)
 * @returns нормализованная строка или пустая строка
 */
const normalizeForHash = (text: string | null | undefined): string => {
  if (!text) return '';
  return text.trim().toLowerCase();
};

/**
 * Вычисление хэша контекста для карточки
 * 
 * Контекст включает (с нормализацией всех текстов):
 * - Промпт самой карточки
 * - Цитата (если есть)
 * - Response прямых родителей (полный текст)
 * - Summary дальних предков (дедушки и далее)
 * 
 * НОРМАЛИЗАЦИЯ: Все текстовые поля проходят через normalizeForHash():
 * - trim() - удаление пробелов в начале и конце
 * - toLowerCase() - приведение к нижнему регистру
 * 
 * Это позволяет избежать ложных срабатываний stale при:
 * - Добавлении/удалении пробелов
 * - Изменении регистра букв
 * 
 * Этот хэш используется для:
 * 1. Сохранения "эталонного" состояния контекста после генерации ответа
 * 2. Проверки: если контекст вернулся к эталонному - снять stale
 * 
 * @param nodeId - ID ноды для которой вычисляется хэш
 * @param nodes - массив всех нод
 * @param edges - массив всех связей
 * @returns хэш-строка или null если нода не найдена
 */
const computeContextHash = (
  nodeId: string,
  nodes: NeuroNode[],
  edges: NeuroEdge[]
): string | null => {
  // Находим целевую ноду
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  // Начинаем собирать контекст для хэширования
  const contextParts: string[] = [];

  // Получаем список исключенных нод
  const excludedIds = node.data.excludedContextNodeIds || [];

  // 1. ПРОМПТ самой карточки (всегда включается) - НОРМАЛИЗОВАН
  contextParts.push(`PROMPT:${normalizeForHash(node.data.prompt)}`);

  // 2. ЦИТАТА (если есть) - НОРМАЛИЗОВАНА
  if (node.data.quote) {
    contextParts.push(`QUOTE:${normalizeForHash(node.data.quote)}`);
    contextParts.push(`QUOTE_SOURCE:${node.data.quoteSourceNodeId || ''}`);
  }

  // 3. Находим ПРЯМЫХ РОДИТЕЛЕЙ (через edges или parentId/parentIds)
  // Приоритет: parentIds > входящие edges > parentId
  let directParentIds: string[] = [];

  if (node.data.parentIds && node.data.parentIds.length > 0) {
    // Множественные родители (карточка создана от нескольких выделенных)
    directParentIds = node.data.parentIds;
  } else {
    // Ищем через входящие связи
    const incomingEdges = edges.filter((e) => e.target === nodeId);
    if (incomingEdges.length > 0) {
      directParentIds = incomingEdges.map((e) => e.source);
    } else if (node.data.parentId) {
      // Fallback на одиночный parentId
      directParentIds = [node.data.parentId];
    }
  }

  // 4. Собираем контекст от ПРЯМЫХ РОДИТЕЛЕЙ (полный response) - НОРМАЛИЗОВАН
  directParentIds.forEach((parentId, index) => {
    // Пропускаем исключенные ноды
    if (excludedIds.includes(parentId)) return;

    const parent = nodes.find((n) => n.id === parentId);
    if (parent) {
      // Для прямого родителя берём полный response
      // Если у ноды есть цитата именно от этого родителя - используем цитату
      if (node.data.quote && node.data.quoteSourceNodeId === parentId) {
        // Цитата уже добавлена выше, не дублируем
      } else {
        // Response родителя - НОРМАЛИЗОВАН
        contextParts.push(`PARENT[${index}]:${normalizeForHash(parent.data.response)}`);
      }
      // Prompt родителя - НОРМАЛИЗОВАН
      contextParts.push(`PARENT_PROMPT[${index}]:${normalizeForHash(parent.data.prompt)}`);
    }
  });

  // 5. Собираем контекст от ДАЛЬНИХ ПРЕДКОВ (summary) - НОРМАЛИЗОВАН
  // BFS для сбора всех предков кроме прямых родителей
  const visited = new Set<string>([nodeId, ...directParentIds]);
  const queue = [...directParentIds];
  let ancestorIndex = 0;

  while (queue.length > 0 && ancestorIndex < 20) { // Ограничение глубины
    const currentId = queue.shift()!;

    // Находим родителей текущей ноды
    const currentNode = nodes.find((n) => n.id === currentId);
    if (!currentNode) continue;

    // Получаем родителей текущей ноды
    let currentParentIds: string[] = [];
    if (currentNode.data.parentIds && currentNode.data.parentIds.length > 0) {
      currentParentIds = currentNode.data.parentIds;
    } else {
      const currentIncoming = edges.filter((e) => e.target === currentId);
      if (currentIncoming.length > 0) {
        currentParentIds = currentIncoming.map((e) => e.source);
      } else if (currentNode.data.parentId) {
        currentParentIds = [currentNode.data.parentId];
      }
    }

    // Обрабатываем каждого родителя
    currentParentIds.forEach((grandparentId) => {
      if (visited.has(grandparentId)) return;
      visited.add(grandparentId);

      // Пропускаем исключенные ноды
      if (excludedIds.includes(grandparentId)) return;

      const grandparent = nodes.find((n) => n.id === grandparentId);
      if (grandparent) {
        // Для дальних предков берём summary (или сокращённый response) - НОРМАЛИЗОВАН
        const summaryContent = grandparent.data.summary
          || (grandparent.data.response?.slice(0, 300) + '...')
          || '';
        contextParts.push(`ANCESTOR[${ancestorIndex}]:${normalizeForHash(summaryContent)}`);
        // Prompt предка - НОРМАЛИЗОВАН
        contextParts.push(`ANCESTOR_PROMPT[${ancestorIndex}]:${normalizeForHash(grandparent.data.prompt)}`);
        ancestorIndex++;

        // Добавляем в очередь для дальнейшего обхода
        queue.push(grandparentId);
      }
    });
  }

  // Соединяем все части и вычисляем хэш
  const fullContext = contextParts.join('|||');
  return djb2Hash(fullContext);
};

/**
 * Создание данных для новой ноды с значениями по умолчанию
 * @param parentId - опциональный ID родительской ноды
 */
const createDefaultNodeData = (parentId?: string): NeuroNodeData => ({
  prompt: '',
  response: null,
  summary: null, // Краткая суть ответа для передачи внукам
  isGenerating: false,
  isSummarizing: false, // Флаг генерации summary
  isStale: false,
  isAnswerExpanded: false, // По умолчанию ответная часть свёрнута
  mode: 'input',
  parentId,
  width: undefined, // Используется дефолтная ширина
  createdAt: Date.now(),
  updatedAt: Date.now(),

  // Поля для цитирования (по умолчанию null - не цитатная карточка)
  quote: null,
  quoteSourceNodeId: null,
  quoteOriginalResponse: null,
  isQuoteInvalidated: false,

  // Хэш контекста для автоматического снятия stale
  // Заполняется после генерации ответа
  lastContextHash: null,
});

// =============================================================================
// ФУНКЦИИ ДЛЯ СИНХРОНИЗАЦИИ ИНДЕКСОВ ПРИ UNDO/REDO
// =============================================================================

/**
 * Таймер для debounce синхронизации stale при undo/redo
 */
let staleCheckDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Задержка для проверки stale после undo/redo (мс)
 */
const STALE_CHECK_DEBOUNCE = 500;

/**
 * Синхронизировать поисковые индексы после операции undo/redo
 * 
 * Сравнивает предыдущее и текущее состояние:
 * - Для удалённых карточек: удаляет из индексов
 * - Для восстановленных карточек: добавляет в индексы (если есть response)
 * 
 * ВАЖНО: Эта функция вызывается с debounce для батчинга множественных операций
 * 
 * @param prevNodes - предыдущий массив нод
 * @param currentNodes - текущий массив нод
 */
const syncIndexesAfterHistoryChange = (
  prevNodes: NeuroNode[],
  currentNodes: NeuroNode[]
): void => {
  // Создаём Set для быстрого поиска
  const prevNodeIds = new Set(prevNodes.map((n) => n.id));
  const currentNodeIds = new Set(currentNodes.map((n) => n.id));

  // Находим удалённые ноды (были в prev, нет в current)
  const removedNodeIds = prevNodes
    .filter((n) => !currentNodeIds.has(n.id))
    .map((n) => n.id);

  // Находим восстановленные ноды (не было в prev, есть в current)
  const restoredNodes = currentNodes.filter((n) => !prevNodeIds.has(n.id));

  // Получаем гибридный движок
  const hybridEngine = getGlobalHybridEngine();

  // Удаляем из индексов удалённые ноды
  for (const nodeId of removedNodeIds) {
    // Удаляем из гибридного индекса (синхронно)
    try {
      const removed = hybridEngine.removeDocument(nodeId);
      if (removed) {
        console.log('[syncIndexes] Удалён документ из поискового индекса:', nodeId);
      }
    } catch (error) {
      console.error('[syncIndexes] Ошибка удаления из поискового индекса:', error);
    }

    // Удаляем эмбеддинг (асинхронно, fire-and-forget)
    deleteEmbedding(nodeId).catch((error) => {
      console.error('[syncIndexes] Ошибка удаления эмбеддинга:', error);
    });
  }

  // Добавляем в гибридный индекс восстановленные ноды (если есть response)
  for (const node of restoredNodes) {
    if (node.data.response) {
      try {
        hybridEngine.addDocument({
          id: node.id,
          text: `${node.data.prompt} ${node.data.response}`,
          title: node.data.prompt,
          preview: node.data.response.slice(0, 200),
        });
        console.log('[syncIndexes] Добавлен документ в поисковый индекс:', node.id);
      } catch (error) {
        console.error('[syncIndexes] Ошибка добавления в поисковый индекс:', error);
      }
    }
  }

  if (removedNodeIds.length > 0 || restoredNodes.length > 0) {
    console.log(
      '[syncIndexes] Синхронизация завершена:',
      `удалено ${removedNodeIds.length}, восстановлено ${restoredNodes.length}`
    );
  }
};

/**
 * Запланировать проверку stale после undo/redo с debounce
 * 
 * Предотвращает множественные вызовы checkAllStaleNodes
 * при быстрых последовательных операциях undo/redo
 */
const scheduleStaleCheck = (): void => {
  // Отменяем предыдущий таймер
  if (staleCheckDebounceTimer) {
    clearTimeout(staleCheckDebounceTimer);
  }

  // Планируем новую проверку
  staleCheckDebounceTimer = setTimeout(() => {
    const { checkAllStaleNodes } = useCanvasStore.getState();
    checkAllStaleNodes();
    console.log('[scheduleStaleCheck] Выполнена проверка stale после undo/redo');
  }, STALE_CHECK_DEBOUNCE);
};

/**
 * Поля ноды, которые НЕ должны влиять на историю undo/redo
 * Это временные UI-поля, которые меняются при взаимодействии
 */
const HISTORY_IGNORED_NODE_FIELDS = ['selected', 'dragging', 'measured', 'resizing'] as const;

/**
 * Поля data ноды, которые НЕ должны влиять на историю undo/redo
 * 
 * ИГНОРИРУЮТСЯ (не вызывают запись в undo):
 * - response, summary - генерация LLM (нельзя откатить)
 * - isGenerating, isSummarizing - состояния процесса генерации
 * - isStale, lastContextHash, isQuoteInvalidated - автоматически вычисляемые
 * - isAnswerExpanded - UI состояние раскрытия ответа
 * - isQuoteModeActive, quoteModeInitiatedByNodeId, pendingRegenerate - UI режим цитирования
 * - quoteOriginalResponse - технический снимок для валидации цитаты
 * 
 * ОТСЛЕЖИВАЮТСЯ (вызывают запись в undo):
 * - prompt - текст промпта (пользовательский ввод)
 * - quote, quoteSourceNodeId - выбор цитаты (пользовательское действие)
 * - mode - режим отображения карточки
 * - parentNodeId - структура связей
 * 
 * СТРУКТУРНЫЕ ИЗМЕНЕНИЯ (отслеживаются отдельно):
 * - Добавление/удаление нод (по количеству и ID)
 * - Добавление/удаление связей (edges)
 * - Перемещение нод (position) - в корне ноды
 */
const HISTORY_IGNORED_DATA_FIELDS = [
  // Генерация LLM - не откатываемые операции
  'response',
  'summary',
  // Состояния процессов генерации
  'isGenerating',
  'isSummarizing',
  // Автоматически вычисляемые поля
  'isStale',
  'lastContextHash',
  'isQuoteInvalidated',
  'updatedAt', // Метка времени последнего обновления
  'createdAt', // Метка времени создания
  // UI состояния
  'isAnswerExpanded',
  'isQuoteModeActive',
  'quoteModeInitiatedByNodeId',
  'pendingRegenerate',
  'mode', // Режим отображения карточки (автоматически меняется при генерации)
  // Технические поля
  'quoteOriginalResponse',
] as const;

/**
 * Очистить ноду от UI-полей для сохранения в историю
 * 
 * @param node - исходная нода
 * @returns нода без UI-полей
 */
const cleanNodeForHistory = (node: NeuroNode): NeuroNode => {
  // Создаём копию без игнорируемых полей верхнего уровня
  const cleanedNode: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (!HISTORY_IGNORED_NODE_FIELDS.includes(key as typeof HISTORY_IGNORED_NODE_FIELDS[number])) {
      if (key === 'data') {
        // Очищаем data от игнорируемых полей
        const cleanedData: Record<string, unknown> = {};
        for (const dataKey of Object.keys(node.data)) {
          if (!HISTORY_IGNORED_DATA_FIELDS.includes(dataKey as typeof HISTORY_IGNORED_DATA_FIELDS[number])) {
            cleanedData[dataKey] = node.data[dataKey as keyof typeof node.data];
          }
        }
        cleanedNode[key] = cleanedData;
      } else {
        cleanedNode[key] = node[key as keyof typeof node];
      }
    }
  }

  return cleanedNode as NeuroNode;
};

/**
 * Сравнение состояний для истории
 * Возвращает true если состояния эквивалентны (не нужно создавать новую запись в истории)
 * 
 * @param pastState - предыдущее состояние
 * @param currentState - текущее состояние
 * @returns true если состояния эквивалентны
 */
const areStatesEqual = (
  pastState: HistoryState,
  currentState: HistoryState
): boolean => {
  // Быстрая проверка по количеству
  if (pastState.nodes.length !== currentState.nodes.length) return false;
  if (pastState.edges.length !== currentState.edges.length) return false;

  // Проверка edges (простое сравнение по ID)
  const pastEdgeIds = new Set(pastState.edges.map((e) => e.id));
  const currentEdgeIds = new Set(currentState.edges.map((e) => e.id));

  for (const id of pastEdgeIds) {
    if (!currentEdgeIds.has(id)) return false;
  }
  for (const id of currentEdgeIds) {
    if (!pastEdgeIds.has(id)) return false;
  }

  // Проверка nodes (без UI-полей)
  const pastNodesMap = new Map(pastState.nodes.map((n) => [n.id, n]));

  for (const currentNode of currentState.nodes) {
    const pastNode = pastNodesMap.get(currentNode.id);
    if (!pastNode) return false;

    // Сравниваем очищенные от UI-полей ноды
    const cleanedPast = JSON.stringify(cleanNodeForHistory(pastNode));
    const cleanedCurrent = JSON.stringify(cleanNodeForHistory(currentNode));

    if (cleanedPast !== cleanedCurrent) return false;
  }

  return true;
};

// =============================================================================
// НАЧАЛЬНОЕ СОСТОЯНИЕ
// =============================================================================

/**
 * Начальная нода, которая появляется при первом запуске
 * Расположена по центру viewport
 */
const initialNodes: NeuroNode[] = [
  {
    id: 'node-initial',
    type: 'neuro',
    position: { x: 250, y: 200 },
    data: createDefaultNodeData(),
  },
];

const initialEdges: NeuroEdge[] = [];

// =============================================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДЛЯ ПАКЕТНОЙ РЕГЕНЕРАЦИИ
// =============================================================================

/**
 * Уровни для пакетной регенерации
 * Хранится в модуле, чтобы быть доступным между вызовами onBatchNodeComplete
 * 
 * Формат: [[nodeId1, nodeId2], [nodeId3], ...] - массив уровней
 * На каждом уровне ноды независимы и могут генерироваться параллельно
 */
let batchLevels: string[][] = [];

// =============================================================================
// ZUSTAND STORE С ПОДДЕРЖКОЙ UNDO/REDO
// =============================================================================

/**
 * Debounce с pause/resume для точного контроля истории
 * 
 * Проблема: при drag карточки генерируется много событий, и нам нужно
 * записать только одно изменение (исходное → финальное).
 * 
 * Решение:
 * 1. При первом изменении в серии - ставим историю на ПАУЗУ
 * 2. Во время drag - изменения происходят, но в историю НЕ записываются
 * 3. После паузы (delay) - СНИМАЕМ паузу и вызываем handleSet
 * 4. Zundo запишет финальное состояние, сохранив исходное как предыдущее
 * 
 * Это позволяет создать ровно 1 запись в истории за одно перемещение.
 */
let historyPauseTimeout: ReturnType<typeof setTimeout> | null = null;
let isHistoryPausedForDrag = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let pendingState: HistoryState | null = null; // Используется для отладки
let pendingHandleSet: (() => void) | null = null;

/**
 * Создаёт обёртку над handleSet с логикой debounce через pause/resume
 * 
 * @param handleSet - Функция zundo для записи состояния в историю
 * @param delay - Задержка в мс перед записью в историю
 * @returns Функция-обёртка
 * 
 * NOTE: Используем any для совместимости с zundo v2.3.0, где сигнатура handleSet
 * отличается от документации. Логика работает корректно.
 */
const setupHistoryPauseDebounce = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleSet: any,
  delay: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...args: any[]) => {
    const state = args[2] as HistoryState; // currentState is 3rd argument in zundo v2

    // Сохраняем последнее состояние и аргументы
    pendingState = state;
    pendingHandleSet = () => handleSet(...args);

    // При первом изменении в серии - ставим на паузу
    if (!isHistoryPausedForDrag) {
      try {
        useCanvasStore.temporal.getState().pause();
        isHistoryPausedForDrag = true;
      } catch (e) {
        console.error('[History] Ошибка паузы:', e);
      }
    }

    // Сбрасываем таймер
    if (historyPauseTimeout) {
      clearTimeout(historyPauseTimeout);
    }

    // Планируем снятие паузы и запись
    historyPauseTimeout = setTimeout(() => {
      if (isHistoryPausedForDrag) {
        try {
          // Снимаем паузу
          useCanvasStore.temporal.getState().resume();
          isHistoryPausedForDrag = false;

          // Записываем финальное состояние
          if (pendingHandleSet) {
            pendingHandleSet();
          }
        } catch (e) {
          console.error('[History] Ошибка resume:', e);
        }
      }
      historyPauseTimeout = null;
      pendingState = null;
      pendingHandleSet = null;
    }, delay);
  };
};

/**
 * Предыдущее состояние для синхронизации индексов
 * Хранится в модуле для доступа из onSave callback
 * 
 * @note Переменная присваивается в onSave callback и сбрасывается при загрузке/очистке.
 *       Используется для отслеживания изменений при будущих расширениях.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let previousHistoryState: HistoryState | null = null;

/**
 * Основной store для управления холстом NeuroCanvas
 * 
 * ВАЖНО: Для оптимизации производительности, streaming текст НЕ хранится здесь!
 * Текст во время генерации хранится в локальном состоянии компонента NeuroNode.
 * В store коммитится только финальный результат после завершения генерации.
 * 
 * ПЕРСИСТЕНТНОСТЬ:
 * - loadFromFile() - загружает данные при старте
 * - saveToFile() - сохраняет вручную
 * - Автосохранение через subscribe (debounce 1 сек)
 * 
 * UNDO/REDO:
 * - temporal middleware отслеживает изменения nodes и edges
 * - Используется debounce 500ms для группировки быстрых изменений
 * - При undo/redo синхронизируются поисковые индексы
 */
export const useCanvasStore = create<CanvasStoreWithPersistence>()(
  temporal(
    subscribeWithSelector(
      immer((set, get) => ({
        // =========================================================================
        // СОСТОЯНИЕ
        // =========================================================================

        /** Массив всех нод на холсте */
        nodes: initialNodes,

        /** Массив всех связей между нодами */
        edges: initialEdges,

        /** ID текущей выбранной ноды */
        selectedNodeId: null,

        /**
         * ID ноды, ожидающей фокус на textarea
         * Устанавливается при создании новой карточки через Tab
         * Сбрасывается после успешного фокуса
         */
        pendingFocusNodeId: null,

        /**
         * ID ноды, на которую нужно центрировать холст
         * Устанавливается при создании новой карточки
         * Сбрасывается после центрирования
         */
        pendingCenterNodeId: null,

        // =========================================================================
        // СОСТОЯНИЕ ПЕРСИСТЕНТНОСТИ
        // =========================================================================

        /** ID текущего холста */
        currentCanvasId: null,

        /** Флаг: идёт ли загрузка данных из файла */
        isLoading: false,

        /** Флаг: идёт ли сохранение данных в файл */
        isSaving: false,

        /** Временная метка последнего сохранения */
        lastSaved: null,

        /** Есть ли несохранённые изменения */
        hasUnsavedChanges: false,

        /** Ошибка при сохранении/загрузке */
        persistError: null,

        /** ID карточки для центрирования после перехода на другой холст (из поиска) */
        searchTargetNodeId: null,

        // =========================================================================
        // СОСТОЯНИЕ ПАКЕТНОЙ РЕГЕНЕРАЦИИ
        // =========================================================================

        /** Флаг: идёт ли пакетная регенерация */
        isBatchRegenerating: false,

        /** Прогресс пакетной регенерации */
        batchRegenerationProgress: null,

        /** Флаг отмены пакетной регенерации */
        batchRegenerationCancelled: false,

        // =========================================================================
        // ЭКШЕНЫ: УПРАВЛЕНИЕ НОДАМИ
        // =========================================================================

        /**
         * Добавление новой ноды на холст
         * 
         * @param position - координаты размещения новой ноды
         * @param parentId - ID родительской ноды (для Drag-to-Create)
         * @returns ID созданной ноды
         */
        addNode: (position, parentId) => {
          const id = generateNodeId();
          const newNode: NeuroNode = {
            id,
            type: 'neuro',
            position,
            data: createDefaultNodeData(parentId),
          };

          set((state) => {
            // Проверяем тип родительской ноды для определения стиля связи
            const parentNode = parentId ? state.nodes.find(n => n.id === parentId) : null;
            const isParentNote = parentNode?.type === 'note';

            return {
              nodes: [...state.nodes, newNode],
              edges: parentId
                ? [
                  ...state.edges,
                  {
                    id: generateEdgeId(parentId, id),
                    source: parentId,
                    target: id,
                    type: isParentNote ? 'neuro-edge' : 'default',
                    animated: isParentNote,
                  },
                ]
                : state.edges,
            };
          });
          return id;
        },

        addNoteNode: (position) => {
          const id = generateNodeId();
          // Initialize with expanded answer for immediate editing
          const defaultData = createDefaultNodeData();
          const noteData: NeuroNodeData = {
            ...defaultData,
            isAnswerExpanded: true, // Always expanded
          };

          const newNode: NeuroNode = {
            id,
            type: 'note',
            position,
            data: noteData,
          };

          set((state) => ({
            nodes: [...state.nodes, newNode],
          }));
          return id;
        },

        /**
         * Обновление данных существующей ноды
         * Автоматически обновляет timestamp updatedAt
         * 
         * ВАЖНО: Создаём новый объект data для корректного отслеживания изменений React!
         * 
         * ИНВАЛИДАЦИЯ ЦИТАТ:
         * При изменении response ноды - проверяем все ноды, которые цитируют эту ноду,
         * и помечаем их как isQuoteInvalidated = true если цитата больше не соответствует.
         * 
         * УСТАРЕВАНИЕ ПОТОМКОВ:
         * При изменении response ноды - все потомки помечаются как stale,
         * потому что их контекст изменился (LLM недетерминированная).
         * 
         * @param nodeId - ID ноды для обновления
         * @param data - частичные данные для merge
         */
        updateNodeData: (nodeId, data) => {
          // Сохраняем старые значения для сравнения
          const { nodes: oldNodes } = get();
          const oldNode = oldNodes.find((n) => n.id === nodeId);
          const oldPrompt = oldNode?.data.prompt;
          const oldResponse = oldNode?.data.response;

          // Флаг: изменился ли response (определяем до set)
          const newResponse = data.response;
          const responseChanged = newResponse !== undefined && newResponse !== oldResponse;

          set((state) => {
            // Находим индекс ноды
            const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);

            if (nodeIndex !== -1) {
              // КРИТИЧНО: Создаём новый объект data для правильного отслеживания изменений!
              // Immer автоматически создаст новую ссылку на nodes[nodeIndex]
              state.nodes[nodeIndex].data = {
                ...state.nodes[nodeIndex].data,
                ...data,
                updatedAt: Date.now(),
              };

              // =================================================================
              // ИНВАЛИДАЦИЯ ЦИТАТ
              // Если изменился response - проверяем все ноды с цитатами из этой ноды
              // =================================================================
              if (responseChanged) {
                // Находим все ноды, которые цитируют эту ноду
                state.nodes.forEach((node, idx) => {
                  if (node.data.quoteSourceNodeId === nodeId && node.data.quote) {
                    // Проверяем: есть ли ещё цитата в новом response?
                    const quoteStillExists = newResponse?.includes(node.data.quote);

                    if (!quoteStillExists) {
                      // Цитата больше не существует в исходном тексте - инвалидируем
                      state.nodes[idx].data = {
                        ...state.nodes[idx].data,
                        isQuoteInvalidated: true,
                        updatedAt: Date.now(),
                      };

                      console.log(
                        '[updateNodeData] Инвалидирована цитата в ноде:',
                        node.id,
                        '- исходный текст изменился'
                      );
                    }
                  }
                });
              }
            }
          });

          // =======================================================================
          // УСТАРЕВАНИЕ ПОТОМКОВ ПРИ ИЗМЕНЕНИИ RESPONSE
          // Если response изменился - все потомки должны быть помечены как stale,
          // потому что LLM недетерминированная и каждый новый ответ уникален
          // =======================================================================
          if (responseChanged) {
            const { markChildrenStale } = get();
            markChildrenStale(nodeId);

            console.log(
              '[updateNodeData] Response изменился для ноды:',
              nodeId,
              '- все потомки помечены как stale'
            );
          }

          // =======================================================================
          // УСТАРЕВАНИЕ САМОЙ КАРТОЧКИ ПРИ ИЗМЕНЕНИИ ПРОМПТА
          // Если промпт изменился и у карточки есть response - карточка устарела,
          // потому что ответ был сгенерирован на другой вопрос
          // =======================================================================
          const newPrompt = data.prompt;
          if (newPrompt !== undefined && newPrompt !== oldPrompt) {
            // Получаем актуальное состояние ноды после set
            const { nodes: currentNodes } = get();
            const currentNode = currentNodes.find((n) => n.id === nodeId);
            
            // Если у карточки есть ответ - помечаем её как устаревшую
            if (currentNode?.data.response) {
              set((state) => {
                const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
                if (nodeIndex !== -1) {
                  state.nodes[nodeIndex].data = {
                    ...state.nodes[nodeIndex].data,
                    isStale: true,
                    updatedAt: Date.now(),
                  };
                }
              });
              
              console.log(
                '[updateNodeData] Промпт изменился для ноды:',
                nodeId,
                '- карточка помечена как stale'
              );
            }
            
            // =======================================================================
            // АВТОМАТИЧЕСКОЕ СНЯТИЕ STALE
            // Если промпт вернулся к эталонному состоянию - проверяем хэш
            // (хэш включает prompt, поэтому если вернулся - stale снимется)
            // =======================================================================
            const { checkAndClearStale } = get();
            checkAndClearStale(nodeId);
          }
        },

        /**
         * Установка флага "устаревшей" ноды
         * Используется когда родительская нода была изменена
         * 
         * @param nodeId - ID ноды
         * @param isStale - новое значение флага
         */
        setNodeStale: (nodeId, isStale) => {
          set((state) => {
            const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);

            if (nodeIndex !== -1) {
              // Создаём новый объект data для правильного отслеживания изменений
              state.nodes[nodeIndex].data = {
                ...state.nodes[nodeIndex].data,
                isStale,
                updatedAt: Date.now(),
              };
            }
          });
        },

        /**
         * Пометить всех потомков ноды как устаревшие
         * Рекурсивно проходит по всем дочерним нодам
         * 
         * Используется когда пользователь редактирует промпт родительской ноды,
         * чтобы показать что результаты детей могут быть неактуальны
         * 
         * @param nodeId - ID родительской ноды
         */
        markChildrenStale: (nodeId) => {
          set((state) => {
            // Находим все связи, исходящие из этой ноды
            const childEdges = state.edges.filter((e) => e.source === nodeId);

            // Для каждого ребёнка устанавливаем isStale = true
            childEdges.forEach((edge) => {
              const childIndex = state.nodes.findIndex((n) => n.id === edge.target);

              if (childIndex !== -1) {
                // Создаём новый объект data для правильного отслеживания изменений
                state.nodes[childIndex].data = {
                  ...state.nodes[childIndex].data,
                  isStale: true,
                  updatedAt: Date.now(),
                };
              }
            });
          });

          // Рекурсивный вызов для глубокого обновления
          const { edges, markChildrenStale: markStale } = get();
          const childEdges = edges.filter((e) => e.source === nodeId);
          childEdges.forEach((edge) => {
            markStale(edge.target);
          });
        },

        /**
         * Удаление ноды с холста
         * Также удаляет все связанные с ней связи
         * ТЕПЕРЬ: помечает дочерние ноды как stale и очищает их parentId
         * 
         * ВАЖНО: При удалении также очищаются поисковые индексы:
         * - Эмбеддинг из IndexedDB (для семантического поиска)
         * - Документ из гибридного поискового индекса (BM25 + Fuzzy)
         * 
         * @param nodeId - ID ноды для удаления
         */
        removeNode: (nodeId) => {
          set((state) => {
            // Находим все дочерние ноды (те, у которых эта нода - source)
            const childEdges = state.edges.filter((e) => e.source === nodeId);

            // Помечаем дочерние ноды как stale и очищаем их parentId
            childEdges.forEach((edge) => {
              const childIndex = state.nodes.findIndex((n) => n.id === edge.target);
              if (childIndex !== -1) {
                // Создаём новый объект data для правильного отслеживания изменений
                state.nodes[childIndex].data = {
                  ...state.nodes[childIndex].data,
                  parentId: undefined, // Очищаем parentId - контекст больше недоступен
                  isStale: true, // Помечаем как устаревшую
                  updatedAt: Date.now(),
                };
              }
            });

            // Удаляем ноду
            state.nodes = state.nodes.filter((n) => n.id !== nodeId);

            // Удаляем все связи, связанные с этой нодой
            state.edges = state.edges.filter(
              (e) => e.source !== nodeId && e.target !== nodeId
            );

            // Сбрасываем выбор, если удалена выбранная нода
            if (state.selectedNodeId === nodeId) {
              state.selectedNodeId = null;
            }
          });

          // =========================================================================
          // ОЧИСТКА ПОИСКОВЫХ ИНДЕКСОВ
          // Удаляем данные карточки из всех поисковых индексов
          // 
          // ВАЖНО: При операциях undo/redo НЕ удаляем из индексов!
          // Синхронизация индексов происходит отдельно через syncIndexesAfterHistoryChange
          // =========================================================================

          // Пропускаем удаление из индексов если идёт операция undo/redo
          if (isUndoRedoOperation) {
            console.log('[removeNode] Пропуск удаления из индексов (undo/redo операция)');
            return;
          }

          // 1. Удаляем эмбеддинг из IndexedDB (асинхронно, fire-and-forget)
          // Это необходимо для корректной работы семантического поиска
          deleteEmbedding(nodeId).catch((error) => {
            console.error('[removeNode] Ошибка удаления эмбеддинга:', error);
          });

          // 2. Удаляем документ из гибридного поискового индекса
          // Это удаляет из BM25 и Fuzzy индексов одновременно
          try {
            const hybridEngine = getGlobalHybridEngine();
            const removed = hybridEngine.removeDocument(nodeId);
            if (removed) {
              console.log('[removeNode] Удалён документ из поискового индекса:', nodeId);
            }
          } catch (error) {
            console.error('[removeNode] Ошибка удаления из поискового индекса:', error);
          }
        },

        /**
         * Установка текущей выбранной ноды
         * 
         * @param nodeId - ID ноды или null для сброса
         */
        setSelectedNode: (nodeId) => {
          set((state) => {
            state.selectedNodeId = nodeId;
          });
        },

        // =========================================================================
        // ЭКШЕНЫ: REACT FLOW CALLBACKS
        // =========================================================================

        /**
         * Обработчик изменений нод от React Flow
         * Применяет изменения (перемещение, выделение, удаление)
         * 
         * ВАЖНО: При удалении нод через React Flow (клавиша Delete и др.)
         * также очищаются поисковые индексы для каждой удаляемой ноды.
         * 
         * @param changes - массив изменений от React Flow
         */
        onNodesChange: (changes: NodeChange<NeuroNode>[]) => {
          // =========================================================================
          // ОБРАБОТКА УДАЛЕНИЙ: Очищаем поисковые индексы для удаляемых нод
          // 
          // ВАЖНО: При операциях undo/redo НЕ удаляем из индексов!
          // Синхронизация индексов происходит отдельно через syncIndexesAfterHistoryChange
          // =========================================================================

          // Пропускаем удаление из индексов если идёт операция undo/redo
          if (!isUndoRedoOperation) {
            const removedNodeIds: string[] = [];

            for (const change of changes) {
              if (change.type === 'remove') {
                removedNodeIds.push(change.id);
              }
            }

            // Если есть удаляемые ноды - очищаем поисковые индексы
            if (removedNodeIds.length > 0) {
              // Получаем гибридный движок один раз
              const hybridEngine = getGlobalHybridEngine();

              for (const nodeId of removedNodeIds) {
                // 1. Удаляем эмбеддинг из IndexedDB (асинхронно)
                deleteEmbedding(nodeId).catch((error) => {
                  console.error('[onNodesChange] Ошибка удаления эмбеддинга:', error);
                });

                // 2. Удаляем документ из гибридного поискового индекса
                try {
                  const removed = hybridEngine.removeDocument(nodeId);
                  if (removed) {
                    console.log('[onNodesChange] Удалён документ из поискового индекса:', nodeId);
                  }
                } catch (error) {
                  console.error('[onNodesChange] Ошибка удаления из поискового индекса:', error);
                }
              }
            }
          }

          // Применяем все изменения к нодам
          set((state) => {
            // applyNodeChanges - встроенная функция React Flow
            // для применения изменений к массиву нод
            state.nodes = applyNodeChanges(changes, state.nodes);
          });
        },

        /**
         * Обработчик изменений связей от React Flow
         * Применяет изменения (создание, удаление связей)
         * 
         * УЛУЧШЕННАЯ ЛОГИКА ПРИ УДАЛЕНИИ СВЯЗИ:
         * - Очищает/обновляет parentId и parentIds
         * - Помечает target ноду как stale (если есть response)
         * - Рекурсивно помечает всех потомков как stale
         * 
         * @param changes - массив изменений от React Flow
         */
        onEdgesChange: (changes: EdgeChange<NeuroEdge>[]) => {
          // Собираем target ноды для последующей рекурсивной пометки потомков
          const targetsToMarkChildrenStale: string[] = [];

          // Сначала обрабатываем удаления связей
          changes.forEach((change) => {
            if (change.type === 'remove') {
              // Находим удаляемую связь
              const { edges, nodes } = get();
              const edgeToRemove = edges.find((e) => e.id === change.id);

              if (edgeToRemove) {
                const targetNode = nodes.find((n) => n.id === edgeToRemove.target);

                // Если у target есть response - добавляем в список для рекурсивной пометки
                if (targetNode?.data.response) {
                  targetsToMarkChildrenStale.push(edgeToRemove.target);
                }

                // Находим target ноду и обновляем её данные
                set((state) => {
                  const targetIndex = state.nodes.findIndex(
                    (n) => n.id === edgeToRemove.target
                  );

                  if (targetIndex !== -1) {
                    const targetNodeData = state.nodes[targetIndex].data;

                    // Проверяем, есть ли другие входящие связи (исключая удаляемую)
                    const otherIncomingEdges = state.edges.filter(
                      (e) => e.target === edgeToRemove.target && e.id !== change.id
                    );

                    // Определяем новые parentId и parentIds
                    const remainingParentIds = otherIncomingEdges.map((e) => e.source);
                    const newParentId = remainingParentIds[0] || undefined;
                    const newParentIds = remainingParentIds.length > 1
                      ? remainingParentIds
                      : undefined;

                    // Определяем: нужно ли помечать как stale
                    // Если есть response - контекст изменился, нужна перегенерация
                    const shouldMarkStale = Boolean(targetNodeData.response);

                    // Создаём новый объект data для правильного отслеживания изменений
                    state.nodes[targetIndex].data = {
                      ...state.nodes[targetIndex].data,
                      parentId: newParentId,
                      parentIds: newParentIds,
                      isStale: shouldMarkStale,
                      updatedAt: Date.now(),
                    };

                    console.log(
                      '[onEdgesChange] Удалена связь:',
                      edgeToRemove.source,
                      '→',
                      edgeToRemove.target,
                      shouldMarkStale ? '(target помечен как stale)' : ''
                    );
                  }
                });
              }
            }
          });

          // Применяем все изменения к edges
          set((state) => {
            state.edges = applyEdgeChanges(changes, state.edges);
          });

          // Рекурсивно помечаем всех потомков как stale
          const { markChildrenStale, checkAllStaleNodes } = get();
          targetsToMarkChildrenStale.forEach((targetId) => {
            markChildrenStale(targetId);
          });

          // =======================================================================
          // АВТОМАТИЧЕСКОЕ СНЯТИЕ STALE
          // После изменения связей проверяем: может контекст каких-то нод
          // вернулся к эталонному состоянию (сохранённому хэшу)
          // =======================================================================
          checkAllStaleNodes();
        },

        /**
         * Обработчик создания новой связи
         * Вызывается когда пользователь соединяет две ноды
         * 
         * УЛУЧШЕННАЯ ЛОГИКА:
         * - Если у target ноды уже есть response → помечаем её как stale
         * - Рекурсивно помечаем всех потомков как stale
         * - Обновляем parentId и parentIds
         * 
         * @param connection - объект с информацией о соединении
         */
        onConnect: (connection: Connection) => {
          // Проверяем что есть source и target
          if (!connection.source || !connection.target) return;

          set((state) => {
            // Проверяем тип исходной ноды
            const sourceNode = state.nodes.find(n => n.id === connection.source);
            const isSourceNote = sourceNode?.type === 'note';

            // Создаём новую связь
            // Если исходная нода - Заметка, связь будет пунктирной (animated)
            const newEdge: NeuroEdge = {
              id: generateEdgeId(connection.source!, connection.target!),
              source: connection.source!,
              target: connection.target!,
              // Используем neuro-edge для нод из заметок, default для остальных
              type: isSourceNote ? 'neuro-edge' : 'default',
              animated: isSourceNote,
            };

            // Проверяем, что такой связи ещё нет
            const exists = state.edges.some(
              (e) => e.source === newEdge.source && e.target === newEdge.target
            );

            if (!exists) {
              state.edges.push(newEdge);

              // Обновляем parentId у целевой ноды
              const targetIndex = state.nodes.findIndex(
                (n) => n.id === connection.target
              );
              if (targetIndex !== -1) {
                const targetNode = state.nodes[targetIndex];

                // Определяем: нужно ли помечать как stale
                // Если у target уже есть response - контекст изменился, нужна перегенерация
                const hasExistingResponse = Boolean(targetNode.data.response);

                // Получаем все входящие связи для обновления parentIds
                const allIncomingEdges = state.edges.filter(
                  (e) => e.target === connection.target
                );
                const allParentIds = allIncomingEdges.map((e) => e.source);

                // Создаём новый объект data для правильного отслеживания изменений
                state.nodes[targetIndex].data = {
                  ...state.nodes[targetIndex].data,
                  // Обновляем parentId (первый родитель)
                  parentId: allParentIds[0] || connection.source!,
                  // Обновляем parentIds если больше одного родителя
                  parentIds: allParentIds.length > 1 ? allParentIds : undefined,
                  // Помечаем как stale если уже был ответ (контекст изменился)
                  isStale: hasExistingResponse,
                  updatedAt: Date.now(),
                };

                console.log(
                  '[onConnect] Создана связь:',
                  connection.source,
                  '→',
                  connection.target,
                  hasExistingResponse ? '(target помечен как stale)' : ''
                );
              }
            }
          });

          // Рекурсивно помечаем всех потомков target ноды как stale
          // (их контекст тоже изменился через цепочку)
          const { markChildrenStale, checkAllStaleNodes, nodes } = get();
          const targetNode = nodes.find((n) => n.id === connection.target);

          // Только если у target есть response (то есть была генерация)
          if (targetNode?.data.response) {
            markChildrenStale(connection.target!);
          }

          // =======================================================================
          // АВТОМАТИЧЕСКОЕ СНЯТИЕ STALE
          // После создания связи проверяем: может контекст каких-то нод
          // вернулся к эталонному состоянию (связь была восстановлена)
          // =======================================================================
          checkAllStaleNodes();
        },

        // =========================================================================
        // ЭКШЕНЫ: БЫСТРОЕ СОЗДАНИЕ КАРТОЧКИ (TAB)
        // =========================================================================

        /**
         * Создать связанную ноду СПРАВА от указанной
         * 
         * Используется для быстрого создания карточки по нажатию Tab.
         * Новая нода размещается справа от исходной с отступом.
         * Автоматически создаётся связь (edge) от исходной к новой.
         * 
         * @param nodeId - ID исходной ноды
         * @returns ID созданной ноды или null если исходная не найдена
         */
        createLinkedNodeRight: (nodeId: string): string | null => {
          const { nodes } = get();

          // Находим исходную ноду
          const sourceNode = nodes.find((n) => n.id === nodeId);
          if (!sourceNode) {
            console.warn('[createLinkedNodeRight] Нода не найдена:', nodeId);
            return null;
          }

          // Константы для позиционирования
          const DEFAULT_WIDTH = 400;
          const parentWidth = sourceNode.data.width ?? DEFAULT_WIDTH;
          const GAP = 100;         // Отступ между карточками

          // Вычисляем позицию новой ноды (справа от исходной)
          const newPosition = {
            x: sourceNode.position.x + parentWidth + GAP,
            y: sourceNode.position.y,  // На той же высоте
          };

          // Создаём новую ноду через существующий addNode
          // addNode автоматически создаст связь с parentId
          const newNodeId = get().addNode(newPosition, nodeId);

          // Устанавливаем pendingFocusNodeId для автофокуса и центрирования
          // А также ВЫДЕЛЯЕМ новую ноду, чтобы пользователь сразу видел где она
          set((state) => {
            state.pendingFocusNodeId = newNodeId;
            state.pendingCenterNodeId = newNodeId;  // Центрируем на новой ноде

            // Снимаем выделение со всех нод
            state.nodes.forEach((node) => {
              node.selected = false;
            });

            // Выделяем новую ноду - чтобы пользователь сразу видел где она
            const newNodeIndex = state.nodes.findIndex((n) => n.id === newNodeId);
            if (newNodeIndex !== -1) {
              state.nodes[newNodeIndex].selected = true;
            }
          });

          console.log('[createLinkedNodeRight] Создана карточка:', newNodeId, 'от:', nodeId);

          return newNodeId;
        },

        /**
         * Установить ID ноды для отложенного фокуса
         * 
         * @param nodeId - ID ноды или null для сброса
         */
        setPendingFocusNodeId: (nodeId: string | null) => {
          set((state) => {
            state.pendingFocusNodeId = nodeId;
          });
        },

        /**
         * Сбросить pendingFocusNodeId
         * Вызывается после успешного фокуса на textarea
         */
        clearPendingFocus: () => {
          set((state) => {
            state.pendingFocusNodeId = null;
          });
        },

        /**
         * Создать "сестринскую" ноду (от того же родителя)
         * 
         * Используется для создания альтернативных веток размышления.
         * Новая нода размещается НИЖЕ текущей (та же x, но y + высота + отступ).
         * Она связана с тем же родителем, что и исходная нода.
         * 
         * @param nodeId - ID текущей ноды
         * @returns ID созданной ноды или null если родитель не найден
         */
        createSiblingNode: (nodeId: string): string | null => {
          const { nodes, edges } = get();

          // Находим текущую ноду
          const currentNode = nodes.find((n) => n.id === nodeId);
          if (!currentNode) {
            console.warn('[createSiblingNode] Нода не найдена:', nodeId);
            return null;
          }

          // Ищем родителя через входящую связь
          const incomingEdge = edges.find((e) => e.target === nodeId);
          const parentId = incomingEdge?.source || currentNode.data.parentId;

          // Если нет родителя - нельзя создать сестринскую ноду
          if (!parentId) {
            console.warn('[createSiblingNode] У ноды нет родителя:', nodeId);
            return null;
          }

          // Константы для позиционирования
          // Высота: вопросная часть (~80px) + ответная часть когда свёрнута (~50px) + отступ
          const ESTIMATED_COLLAPSED_HEIGHT = 150;
          const GAP = 50;

          // Вычисляем позицию новой ноды (ниже текущей)
          const newPosition = {
            x: currentNode.position.x,  // Та же x координата
            y: currentNode.position.y + ESTIMATED_COLLAPSED_HEIGHT + GAP,
          };

          // Создаём новую ноду через существующий addNode
          // addNode автоматически создаст связь с parentId
          const newNodeId = get().addNode(newPosition, parentId);

          // Устанавливаем pendingFocusNodeId для автофокуса
          // А также ВЫДЕЛЯЕМ новую ноду, чтобы пользователь сразу видел где она
          set((state) => {
            state.pendingFocusNodeId = newNodeId;
            state.pendingCenterNodeId = newNodeId;  // Центрируем на новой ноде

            // Снимаем выделение со всех нод
            state.nodes.forEach((node) => {
              node.selected = false;
            });

            // Выделяем новую ноду - чтобы пользователь сразу видел где она
            const newNodeIndex = state.nodes.findIndex((n) => n.id === newNodeId);
            if (newNodeIndex !== -1) {
              state.nodes[newNodeIndex].selected = true;
            }
          });

          console.log('[createSiblingNode] Создана сестринская карточка:', newNodeId, 'от родителя:', parentId);

          return newNodeId;
        },

        /**
         * Создать ноду от нескольких родителей
         * 
         * Используется когда выделено несколько карточек рамкой и нажат Tab.
         * Новая карточка:
         * - Связана (edge) со ВСЕМИ выделенными карточками
         * - Располагается справа от самой правой карточки
         * - Центрируется по высоте между крайними выделенными карточками
         * - Автоматически получает фокус
         * 
         * @param nodeIds - массив ID родительских нод
         * @returns ID созданной ноды или null если родители не найдены
         */
        createNodeFromMultipleParents: (nodeIds: string[]): string | null => {
          const { nodes } = get();

          // Проверяем что есть хотя бы 2 родителя
          if (nodeIds.length < 2) {
            console.warn('[createNodeFromMultipleParents] Нужно минимум 2 родителя, получено:', nodeIds.length);
            return null;
          }

          // Находим все родительские ноды
          const parentNodes = nodeIds
            .map((id) => nodes.find((n) => n.id === id))
            .filter((n): n is NeuroNode => n !== undefined);

          if (parentNodes.length < 2) {
            console.warn('[createNodeFromMultipleParents] Не найдены родительские ноды');
            return null;
          }

          // =======================================================================
          // ВЫЧИСЛЕНИЕ ПОЗИЦИИ НОВОЙ КАРТОЧКИ
          // =======================================================================

          // Константы для позиционирования
          const DEFAULT_WIDTH = 400;
          const GAP = 100;         // Отступ между карточками
          const ESTIMATED_CARD_HEIGHT = 150; // Приблизительная высота карточки

          // Находим самую правую точку среди всех родителей
          // x = max(node.x + node.width) + GAP
          const maxRightX = Math.max(...parentNodes.map((n) => {
            const width = n.data.width ?? DEFAULT_WIDTH;
            return n.position.x + width;
          }));

          // Находим минимальную и максимальную Y позицию для центрирования
          const minY = Math.min(...parentNodes.map((n) => n.position.y));
          const maxY = Math.max(...parentNodes.map((n) => n.position.y + ESTIMATED_CARD_HEIGHT));

          // Центрируем по высоте: (minY + maxY) / 2 - половина высоты карточки
          const centerY = (minY + maxY) / 2 - ESTIMATED_CARD_HEIGHT / 2;

          const newPosition = {
            x: maxRightX + GAP,
            y: centerY,
          };

          // =======================================================================
          // СОЗДАНИЕ НОВОЙ НОДЫ
          // =======================================================================

          const newNodeId = generateNodeId();

          set((state) => {
            // Создаём новую ноду с массивом родителей
            const newNode: NeuroNode = {
              id: newNodeId,
              type: 'neuro',
              position: newPosition,
              data: {
                ...createDefaultNodeData(),
                // Устанавливаем массив родительских ID
                parentIds: nodeIds,
                // Для обратной совместимости - первый родитель как parentId
                parentId: nodeIds[0],
              },
            };

            // Добавляем ноду в массив
            state.nodes.push(newNode);

            // Создаём связи (edges) от ВСЕХ родителей к новой ноде
            nodeIds.forEach((parentId) => {
              const parentNode = state.nodes.find(n => n.id === parentId);
              const isParentNote = parentNode?.type === 'note';

              const newEdge: NeuroEdge = {
                id: generateEdgeId(parentId, newNodeId),
                source: parentId,
                target: newNodeId,
                type: isParentNote ? 'neuro-edge' : 'default',
                animated: isParentNote,
              };
              state.edges.push(newEdge);
            });

            // Устанавливаем фокус и центрирование
            state.pendingFocusNodeId = newNodeId;
            state.pendingCenterNodeId = newNodeId;

            // Снимаем выделение со всех нод
            state.nodes.forEach((node) => {
              node.selected = false;
            });

            // Выделяем новую ноду - чтобы пользователь сразу видел где она
            const newNodeIndex = state.nodes.findIndex((n) => n.id === newNodeId);
            if (newNodeIndex !== -1) {
              state.nodes[newNodeIndex].selected = true;
            }
          });

          console.log(
            '[createNodeFromMultipleParents] Создана карточка:',
            newNodeId,
            'от родителей:',
            nodeIds
          );

          return newNodeId;
        },

        /**
         * Установить ID ноды для центрирования холста
         * 
         * @param nodeId - ID ноды или null для сброса
         */
        setPendingCenterNodeId: (nodeId: string | null) => {
          set((state) => {
            state.pendingCenterNodeId = nodeId;
          });
        },

        /**
         * Сбросить pendingCenterNodeId
         * Вызывается после центрирования холста
         */
        clearPendingCenter: () => {
          set((state) => {
            state.pendingCenterNodeId = null;
          });
        },

        /**
         * Установить ID карточки для центрирования после загрузки холста
         * 
         * Используется при переходе на карточку с другого холста (из поиска).
         * Хранится в store, а не в локальном state, чтобы пережить 
         * перемонтирование компонента при смене холста.
         * 
         * @param nodeId - ID карточки или null для сброса
         */
        setSearchTargetNodeId: (nodeId: string | null) => {
          set((state) => {
            state.searchTargetNodeId = nodeId;
          });
        },

        /**
         * Переключить раскрытие/сворачивание ответной части карточки
         * 
         * Используется для:
         * - Клавиши Space при выделенной карточке
         * - Кнопки toggle в самой карточке
         * 
         * @param nodeId - ID ноды для переключения
         */
        toggleNodeAnswerExpanded: (nodeId: string) => {
          set((state) => {
            const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);

            if (nodeIndex !== -1) {
              state.nodes[nodeIndex].data = {
                ...state.nodes[nodeIndex].data,
                isAnswerExpanded: !state.nodes[nodeIndex].data.isAnswerExpanded,
                updatedAt: Date.now(),
              };
            }
          });
        },

        /**
         * Переключить раскрытие/сворачивание ответной части для ВСЕХ выделенных карточек
         * 
         * Логика:
         * - Если хотя бы одна выделенная карточка раскрыта -> сворачиваем ВСЕ
         * - Если все выделенные карточки свёрнуты -> раскрываем ВСЕ
         * 
         * Это обеспечивает интуитивное поведение "привести к одному виду".
         */
        toggleSelectedNodesAnswerExpanded: () => {
          set((state) => {
            const selectedNodes = state.nodes.filter((n) => n.selected);
            if (selectedNodes.length === 0) return;

            // Проверяем: есть ли хоть одна раскрытая?
            const anyExpanded = selectedNodes.some((n) => n.data.isAnswerExpanded);

            // Если есть раскрытые - будем сворачивать (target = false)
            // Если все скрыты - будем раскрывать (target = true)
            const targetState = !anyExpanded;

            selectedNodes.forEach((node) => {
              // Находим индекс ноды в основном массиве
              const index = state.nodes.findIndex((n) => n.id === node.id);
              if (index !== -1) {
                state.nodes[index].data = {
                  ...state.nodes[index].data,
                  isAnswerExpanded: targetState,
                  updatedAt: Date.now(),
                };
              }
            });

            console.log(
              '[toggleSelectedNodesAnswerExpanded] Обновлено',
              selectedNodes.length,
              'карточек ->',
              targetState ? 'expanded' : 'collapsed'
            );
          });
        },

        /**
         * Снять выделение со всех карточек
         * 
         * Используется при открытии режима чтения чтобы:
         * - Освободить Arrow keys от React Flow навигации
         * - Визуально показать что фокус на modal
         */
        clearSelection: () => {
          set((state) => {
            state.nodes.forEach((node) => {
              node.selected = false;
            });
          });
        },

        // =========================================================================
        // ЭКШЕНЫ: ЦИТИРОВАНИЕ
        // =========================================================================

        /**
         * Создать карточку на основе цитаты из ответа
         * 
         * Создаёт новую ноду справа от ноды-источника с сохранением:
         * - Текста цитаты (quote)
         * - ID источника (quoteSourceNodeId)
         * - Оригинального response для отслеживания изменений
         * 
         * @param sourceNodeId - ID ноды, из ответа которой взята цитата
         * @param quoteText - выделенный текст цитаты
         * @returns ID созданной ноды или null если исходная нода не найдена
         */
        createQuoteNode: (sourceNodeId: string, quoteText: string): string | null => {
          const { nodes } = get();

          // Находим исходную ноду
          const sourceNode = nodes.find((n) => n.id === sourceNodeId);
          if (!sourceNode) {
            console.warn('[createQuoteNode] Нода-источник не найдена:', sourceNodeId);
            return null;
          }

          // Проверяем что у исходной ноды есть response
          if (!sourceNode.data.response) {
            console.warn('[createQuoteNode] У ноды-источника нет response:', sourceNodeId);
            return null;
          }

          // Константы для позиционирования (как в createLinkedNodeRight)
          const DEFAULT_WIDTH = 400;
          const parentWidth = sourceNode.data.width ?? DEFAULT_WIDTH;
          const GAP = 100;

          // Вычисляем позицию новой ноды (справа от исходной)
          const newPosition = {
            x: sourceNode.position.x + parentWidth + GAP,
            y: sourceNode.position.y,
          };

          // Генерируем ID для новой ноды
          const newNodeId = generateNodeId();

          set((state) => {
            // Создаём новую ноду с данными цитаты
            const newNode: NeuroNode = {
              id: newNodeId,
              type: 'neuro',
              position: newPosition,
              data: {
                ...createDefaultNodeData(sourceNodeId),
                // Данные цитирования
                quote: quoteText,
                quoteSourceNodeId: sourceNodeId,
                quoteOriginalResponse: sourceNode.data.response,
                isQuoteInvalidated: false,
              },
            };

            // Добавляем ноду в массив
            state.nodes.push(newNode);

            // Создаём связь с источником
            // ВАЖНО: Помечаем связь как цитатную (isQuoteEdge: true)
            // Это позволяет визуально выделить источник цитаты пурпурным цветом
            const isSourceNote = sourceNode.type === 'note';
            const newEdge: NeuroEdge = {
              id: generateEdgeId(sourceNodeId, newNodeId),
              source: sourceNodeId,
              target: newNodeId,
              type: isSourceNote ? 'neuro-edge' : 'default',
              animated: isSourceNote,
              // Данные связи: помечаем как цитатную для особой стилизации
              data: {
                isQuoteEdge: true,
              },
            };
            state.edges.push(newEdge);

            // Устанавливаем фокус и центрирование
            state.pendingFocusNodeId = newNodeId;
            state.pendingCenterNodeId = newNodeId;

            // Снимаем выделение со всех нод
            state.nodes.forEach((node) => {
              node.selected = false;
            });

            // Выделяем новую ноду - чтобы пользователь сразу видел где она
            const newNodeIndex = state.nodes.findIndex((n) => n.id === newNodeId);
            if (newNodeIndex !== -1) {
              state.nodes[newNodeIndex].selected = true;
            }
          });

          console.log('[createQuoteNode] Создана цитатная карточка:', newNodeId, 'от:', sourceNodeId);

          return newNodeId;
        },

        /**
         * Сбросить инвалидацию цитаты
         * 
         * Очищает флаг isQuoteInvalidated и все quote* поля,
         * позволяя пользователю выделить новую цитату из обновлённого текста
         * 
         * @param nodeId - ID ноды для сброса
         */
        clearQuoteInvalidation: (nodeId: string) => {
          set((state) => {
            const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);

            if (nodeIndex !== -1) {
              // Сбрасываем все поля цитаты
              state.nodes[nodeIndex].data = {
                ...state.nodes[nodeIndex].data,
                quote: null,
                quoteSourceNodeId: null,
                quoteOriginalResponse: null,
                isQuoteInvalidated: false,
                updatedAt: Date.now(),
              };
            }
          });

          console.log('[clearQuoteInvalidation] Сброшена инвалидация цитаты для ноды:', nodeId);
        },

        /**
         * Обновить цитату в существующей карточке
         * 
         * Используется когда пользователь выделяет новую цитату
         * после инвалидации предыдущей
         * 
         * ВАЖНО: После обновления цитаты:
         * - Карточка помечается как stale (контекст изменился)
         * - Все потомки также помечаются как stale
         * - Пользователь сам решает когда запустить перегенерацию
         * 
         * @param nodeId - ID ноды для обновления цитаты
         * @param quoteText - новый текст цитаты
         * @param sourceNodeId - ID ноды-источника цитаты
         * @param originalResponse - текущий response источника
         */
        updateQuote: (
          nodeId: string,
          quoteText: string,
          sourceNodeId: string,
          originalResponse: string
        ) => {
          set((state) => {
            const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);

            if (nodeIndex !== -1) {
              // Обновляем поля цитаты и помечаем как устаревшую
              // (контекст изменился - пользователь сам решит когда перегенерировать)
              state.nodes[nodeIndex].data = {
                ...state.nodes[nodeIndex].data,
                quote: quoteText,
                quoteSourceNodeId: sourceNodeId,
                quoteOriginalResponse: originalResponse,
                isQuoteInvalidated: false,
                // Помечаем как устаревшую - контекст изменился
                isStale: true,
                updatedAt: Date.now(),
              };

              // Центрируем холст на дочерней карточке после обновления цитаты
              state.pendingCenterNodeId = nodeId;
            }
          });

          // Помечаем всех потомков как устаревших (их контекст тоже изменился)
          const { markChildrenStale, checkAndClearStale } = get();
          markChildrenStale(nodeId);

          // =======================================================================
          // АВТОМАТИЧЕСКОЕ СНЯТИЕ STALE
          // Если цитата вернулась к эталонному состоянию - снимаем stale
          // =======================================================================
          checkAndClearStale(nodeId);

          console.log('[updateQuote] Обновлена цитата для ноды:', nodeId, '- помечена как stale вместе с потомками');
        },

        /**
         * Инициировать режим выбора цитаты в родительской карточке
         * 
         * Вызывается из дочерней карточки с инвалидированной цитатой
         * при нажатии кнопки "Выделить новую цитату".
         * 
         * Действия:
         * 1. Находит родительскую ноду (источник цитаты)
         * 2. Выделяет её (selectedNodeId)
         * 3. Разворачивает ответную часть (isAnswerExpanded = true)
         * 4. Активирует режим цитирования (isQuoteModeActive = true)
         * 5. Сохраняет ID дочерней карточки для последующего обновления цитаты
         * 
         * @param quoteNodeId - ID дочерней карточки с инвалидированной цитатой
         */
        initiateQuoteSelectionInParent: (quoteNodeId: string) => {
          const { nodes } = get();

          // Находим дочернюю карточку (с инвалидированной цитатой)
          const quoteNode = nodes.find((n) => n.id === quoteNodeId);
          if (!quoteNode) {
            console.warn('[initiateQuoteSelectionInParent] Карточка не найдена:', quoteNodeId);
            return;
          }

          // Получаем ID родительской ноды (источника цитаты)
          const parentNodeId = quoteNode.data.quoteSourceNodeId || quoteNode.data.parentId;
          if (!parentNodeId) {
            console.warn('[initiateQuoteSelectionInParent] Родительская нода не найдена для:', quoteNodeId);
            return;
          }

          // Проверяем что родительская нода существует
          const parentNode = nodes.find((n) => n.id === parentNodeId);
          if (!parentNode) {
            console.warn('[initiateQuoteSelectionInParent] Родительская нода не существует:', parentNodeId);
            return;
          }

          set((state) => {
            // Находим индекс родительской ноды
            const parentIndex = state.nodes.findIndex((n) => n.id === parentNodeId);

            if (parentIndex !== -1) {
              // 1. Выделяем родительскую ноду
              state.selectedNodeId = parentNodeId;

              // 2. Центрируем холст на родительской карточке
              state.pendingCenterNodeId = parentNodeId;

              // 3. Разворачиваем ответную часть родительской карточки
              // 4. Активируем режим цитирования
              // 5. Сохраняем ID дочерней карточки для последующего обновления
              state.nodes[parentIndex].data = {
                ...state.nodes[parentIndex].data,
                isAnswerExpanded: true,
                isQuoteModeActive: true,
                quoteModeInitiatedByNodeId: quoteNodeId,
                updatedAt: Date.now(),
              };
            }
          });

          console.log(
            '[initiateQuoteSelectionInParent] Активирован режим цитирования в родительской ноде:',
            parentNodeId,
            'для обновления цитаты в:',
            quoteNodeId
          );
        },

        /**
         * Сбросить режим цитирования в ноде
         * 
         * Вызывается когда пользователь:
         * - Отменил режим цитирования
         * - Завершил выбор цитаты (создал или обновил карточку)
         * 
         * @param nodeId - ID ноды для сброса режима цитирования
         */
        clearQuoteModeActive: (nodeId: string) => {
          set((state) => {
            const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);

            if (nodeIndex !== -1) {
              state.nodes[nodeIndex].data = {
                ...state.nodes[nodeIndex].data,
                isQuoteModeActive: false,
                quoteModeInitiatedByNodeId: null,
                updatedAt: Date.now(),
              };
            }
          });

          console.log('[clearQuoteModeActive] Сброшен режим цитирования для ноды:', nodeId);
        },

        // =========================================================================
        // ЭКШЕНЫ: АВТОМАТИЧЕСКОЕ СНЯТИЕ STALE (CONTEXT HASH)
        // =========================================================================

        /**
         * Вычислить и сохранить хэш контекста для ноды
         * 
         * Вызывается ПОСЛЕ успешной генерации ответа.
         * Сохраняет "эталонный" хэш контекста, с которым был сгенерирован ответ.
         * 
         * @param nodeId - ID ноды для которой сохранить хэш
         */
        saveContextHash: (nodeId: string) => {
          const { nodes, edges } = get();

          // Вычисляем хэш текущего контекста
          const hash = computeContextHash(nodeId, nodes, edges);

          if (hash) {
            set((state) => {
              const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
              if (nodeIndex !== -1) {
                state.nodes[nodeIndex].data = {
                  ...state.nodes[nodeIndex].data,
                  lastContextHash: hash,
                  updatedAt: Date.now(),
                };
              }
            });

            console.log('[saveContextHash] Сохранён хэш контекста для ноды:', nodeId, '→', hash);
          }
        },

        /**
         * Получить текущий хэш контекста для ноды (без сохранения)
         * 
         * Используется для сравнения текущего контекста с сохранённым
         * 
         * @param nodeId - ID ноды
         * @returns хэш-строка или null
         */
        getContextHash: (nodeId: string): string | null => {
          const { nodes, edges } = get();
          return computeContextHash(nodeId, nodes, edges);
        },

        /**
         * Проверить и снять stale если контекст вернулся к эталонному
         * 
         * Рекурсивно проверяет ноду и всех её потомков:
         * - Если нода stale И текущий хэш совпадает с сохранённым → снять stale
         * - Для потомков аналогично
         * 
         * @param nodeId - ID ноды для начала проверки
         */
        checkAndClearStale: (nodeId: string) => {
          const { nodes, edges, checkAndClearStale: checkStale } = get();

          const node = nodes.find((n) => n.id === nodeId);
          if (!node) return;

          // Проверяем только если нода помечена как stale
          if (node.data.isStale && node.data.lastContextHash) {
            const currentHash = computeContextHash(nodeId, nodes, edges);

            // Если хэш совпал - контекст вернулся к эталонному состоянию
            if (currentHash === node.data.lastContextHash) {
              set((state) => {
                const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
                if (nodeIndex !== -1) {
                  state.nodes[nodeIndex].data = {
                    ...state.nodes[nodeIndex].data,
                    isStale: false,
                    updatedAt: Date.now(),
                  };
                }
              });

              console.log(
                '[checkAndClearStale] Снят stale для ноды:',
                nodeId,
                '- контекст вернулся к эталонному'
              );
            }
          }

          // Рекурсивно проверяем всех потомков
          const childEdges = edges.filter((e) => e.source === nodeId);
          childEdges.forEach((edge) => {
            checkStale(edge.target);
          });
        },

        /**
         * Проверить и снять stale для ВСЕХ stale нод на холсте
         * 
         * Используется после массовых изменений (например, восстановление связей)
         * Проходит по всем stale нодам и проверяет их хэши
         */
        checkAllStaleNodes: () => {
          const { nodes, edges } = get();

          // Собираем все stale ноды с сохранённым хэшем
          const staleNodes = nodes.filter((n) => n.data.isStale && n.data.lastContextHash);

          if (staleNodes.length === 0) return;

          console.log('[checkAllStaleNodes] Проверяем', staleNodes.length, 'stale нод');

          const nodesToClear: string[] = [];

          staleNodes.forEach((node) => {
            const currentHash = computeContextHash(node.id, nodes, edges);
            if (currentHash === node.data.lastContextHash) {
              nodesToClear.push(node.id);
            }
          });

          if (nodesToClear.length > 0) {
            set((state) => {
              nodesToClear.forEach((nodeId) => {
                const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
                if (nodeIndex !== -1) {
                  state.nodes[nodeIndex].data = {
                    ...state.nodes[nodeIndex].data,
                    isStale: false,
                    updatedAt: Date.now(),
                  };
                }
              });
            });

            console.log('[checkAllStaleNodes] Снят stale для', nodesToClear.length, 'нод:', nodesToClear);
          }
        },

        // =========================================================================
        // ЭКШЕНЫ: ПАКЕТНАЯ РЕГЕНЕРАЦИЯ УСТАРЕВШИХ КАРТОЧЕК
        // =========================================================================

        /**
         * Получить количество устаревших (stale) карточек
         * 
         * @returns количество карточек с isStale === true
         */
        getStaleNodesCount: (): number => {
          const { nodes } = get();
          return nodes.filter((n) => n.data.isStale && n.data.response).length;
        },

        /**
         * Запустить пакетную регенерацию всех устаревших карточек
         * 
         * АЛГОРИТМ:
         * 1. Собрать все stale ноды (только те, у которых есть response - иначе нечего регенерировать)
         * 2. Построить граф зависимостей: для каждой stale ноды найти stale-предков
         * 3. Топологическая сортировка по уровням:
         *    - Уровень 0: stale ноды без stale-предков (корни)
         *    - Уровень 1: stale ноды, у которых ВСЕ stale-предки на уровне 0
         *    - и т.д.
         * 4. На каждом уровне запустить генерацию ПАРАЛЛЕЛЬНО (через pendingRegenerate)
         * 5. Ждать завершения всего уровня (onBatchNodeComplete отслеживает)
         * 6. Переходить к следующему уровню
         */
        regenerateStaleNodes: () => {
          const { nodes, edges, isBatchRegenerating } = get();

          // Если уже идёт регенерация - выходим
          if (isBatchRegenerating) {
            console.log('[regenerateStaleNodes] Регенерация уже идёт');
            return;
          }

          // 1. Собираем все stale ноды с ответом (нечего регенерировать без ответа)
          const staleNodes = nodes.filter((n) => n.data.isStale && n.data.response);

          if (staleNodes.length === 0) {
            console.log('[regenerateStaleNodes] Нет устаревших карточек');
            return;
          }

          console.log('[regenerateStaleNodes] Найдено устаревших карточек:', staleNodes.length);

          // Множество ID stale нод для быстрого поиска
          const staleNodeIds = new Set(staleNodes.map((n) => n.id));

          // 2. Строим граф зависимостей: для каждой stale ноды находим её stale-предков
          // staleParents[nodeId] = [id1, id2, ...] - массив stale родителей
          const staleParents: Map<string, string[]> = new Map();

          /**
           * Вспомогательная функция: получить всех прямых родителей ноды
           */
          const getDirectParents = (nodeId: string): string[] => {
            const node = nodes.find((n) => n.id === nodeId);
            if (!node) return [];

            // Приоритет 1: parentIds (массив родителей)
            if (node.data.parentIds && node.data.parentIds.length > 0) {
              return node.data.parentIds;
            }

            // Приоритет 2: Входящие связи
            const incomingEdges = edges.filter((e) => e.target === nodeId);
            if (incomingEdges.length > 0) {
              return incomingEdges.map((e) => e.source);
            }

            // Приоритет 3: parentId
            if (node.data.parentId) {
              return [node.data.parentId];
            }

            return [];
          };

          /**
           * Рекурсивно находим ВСЕХ stale-предков ноды
           * (не только прямых родителей, но и дедушек и т.д.)
           */
          const findAllStaleAncestors = (nodeId: string, visited: Set<string> = new Set()): string[] => {
            const staleAncestors: string[] = [];
            const directParents = getDirectParents(nodeId);

            for (const parentId of directParents) {
              if (visited.has(parentId)) continue;
              visited.add(parentId);

              // Если родитель stale - добавляем его
              if (staleNodeIds.has(parentId)) {
                staleAncestors.push(parentId);
              }

              // Рекурсивно ищем stale-предков родителя
              const ancestorsOfParent = findAllStaleAncestors(parentId, visited);
              staleAncestors.push(...ancestorsOfParent);
            }

            return staleAncestors;
          };

          // Заполняем staleParents для каждой stale ноды
          for (const node of staleNodes) {
            const ancestors = findAllStaleAncestors(node.id);
            staleParents.set(node.id, ancestors);
          }

          // 3. Топологическая сортировка по уровням
          // Используем алгоритм Кана (Kahn's algorithm) для определения уровней
          const levels: string[][] = [];
          const processed = new Set<string>();

          while (processed.size < staleNodes.length) {
            // Находим ноды для текущего уровня:
            // те, у которых ВСЕ stale-предки уже обработаны
            const currentLevel: string[] = [];

            for (const node of staleNodes) {
              if (processed.has(node.id)) continue;

              const ancestors = staleParents.get(node.id) || [];
              const allAncestorsProcessed = ancestors.every((ancestorId) => processed.has(ancestorId));

              if (allAncestorsProcessed) {
                currentLevel.push(node.id);
              }
            }

            // Защита от бесконечного цикла (циклические зависимости)
            if (currentLevel.length === 0 && processed.size < staleNodes.length) {
              console.error('[regenerateStaleNodes] Обнаружен цикл в зависимостях!');
              break;
            }

            // Добавляем уровень и помечаем как обработанные
            levels.push(currentLevel);
            currentLevel.forEach((id) => processed.add(id));
          }

          console.log('[regenerateStaleNodes] Уровни регенерации:', levels);

          // 4. Запускаем регенерацию
          // Устанавливаем начальное состояние
          set((state) => {
            state.isBatchRegenerating = true;
            state.batchRegenerationCancelled = false;
            state.batchRegenerationProgress = {
              total: staleNodes.length,
              completed: 0,
              currentLevel: 0,
              currentLevelNodeIds: levels[0] || [],
            };
          });

          // Запускаем первый уровень
          // Для каждой ноды устанавливаем pendingRegenerate = true
          // NeuroNode при монтировании/обновлении увидит этот флаг и запустит генерацию
          if (levels.length > 0) {
            const firstLevel = levels[0];

            // Сохраняем уровни в closure для последующих вызовов onBatchNodeComplete
            // ВАЖНО: До set(), чтобы были доступны при обработке
            batchLevels = levels;

            set((state) => {
              console.log('[regenerateStaleNodes] Устанавливаем pendingRegenerate для уровня 0:', firstLevel);

              firstLevel.forEach((nodeId) => {
                const nodeIndex = state.nodes.findIndex((n) => n.id === nodeId);
                if (nodeIndex !== -1) {
                  console.log('[regenerateStaleNodes] Устанавливаем pendingRegenerate для ноды:', nodeId);
                  state.nodes[nodeIndex].data = {
                    ...state.nodes[nodeIndex].data,
                    pendingRegenerate: true,
                    updatedAt: Date.now(),
                  };
                } else {
                  console.error('[regenerateStaleNodes] Нода не найдена:', nodeId);
                }
              });
            });

            console.log('[regenerateStaleNodes] Запущен уровень 0:', firstLevel);
          }
        },

        /**
         * Отменить текущую пакетную регенерацию
         * 
         * Принудительно сбрасывает все флаги и состояние регенерации.
         * Карточки, которые уже начали генерацию, завершатся,
         * но новые уровни не будут запускаться.
         */
        cancelBatchRegeneration: () => {
          // Принудительно сбрасываем ВСЁ состояние регенерации
          set((state) => {
            state.batchRegenerationCancelled = true;
            state.isBatchRegenerating = false;
            state.batchRegenerationProgress = null;

            // Сбрасываем pendingRegenerate у всех карточек которые ещё не начали
            state.nodes.forEach((node, idx) => {
              if (node.data.pendingRegenerate) {
                state.nodes[idx].data = {
                  ...state.nodes[idx].data,
                  pendingRegenerate: false,
                  updatedAt: Date.now(),
                };
              }
            });
          });

          // Очищаем уровни
          batchLevels = [];

          console.log('[cancelBatchRegeneration] Регенерация отменена');
        },

        /**
         * Обработать завершение генерации одной ноды в пакетном режиме
         * 
         * Логика:
         * 1. Увеличить completed
         * 2. Убрать nodeId из currentLevelNodeIds
         * 3. Если currentLevelNodeIds пустой - перейти к следующему уровню
         * 4. Если cancelled - остановить
         * 5. Если все уровни завершены - сбросить состояние
         * 
         * @param nodeId - ID завершившей генерацию ноды
         */
        onBatchNodeComplete: (nodeId: string) => {
          const { isBatchRegenerating, batchRegenerationProgress, batchRegenerationCancelled } = get();

          // Если регенерация не идёт - игнорируем
          if (!isBatchRegenerating || !batchRegenerationProgress) {
            return;
          }

          // Проверяем что нода из текущего уровня
          if (!batchRegenerationProgress.currentLevelNodeIds.includes(nodeId)) {
            return;
          }

          console.log('[onBatchNodeComplete] Завершена нода:', nodeId);

          // Обновляем прогресс
          const newCurrentLevelNodeIds = batchRegenerationProgress.currentLevelNodeIds.filter(
            (id) => id !== nodeId
          );
          const newCompleted = batchRegenerationProgress.completed + 1;

          // Проверяем: уровень завершён?
          if (newCurrentLevelNodeIds.length === 0) {
            // Уровень завершён
            const nextLevelIndex = batchRegenerationProgress.currentLevel + 1;

            // Проверяем отмену
            if (batchRegenerationCancelled) {
              console.log('[onBatchNodeComplete] Регенерация отменена после уровня', batchRegenerationProgress.currentLevel);

              set((state) => {
                state.isBatchRegenerating = false;
                state.batchRegenerationProgress = null;
                state.batchRegenerationCancelled = false;
              });
              return;
            }

            // Проверяем: есть ещё уровни?
            if (nextLevelIndex >= batchLevels.length) {
              // Все уровни завершены!
              console.log('[onBatchNodeComplete] Пакетная регенерация завершена!');

              set((state) => {
                state.isBatchRegenerating = false;
                state.batchRegenerationProgress = null;
              });
              return;
            }

            // Переходим к следующему уровню
            const nextLevel = batchLevels[nextLevelIndex];

            console.log('[onBatchNodeComplete] Переход к уровню', nextLevelIndex, ':', nextLevel);

            set((state) => {
              // Обновляем прогресс
              state.batchRegenerationProgress = {
                total: batchRegenerationProgress.total,
                completed: newCompleted,
                currentLevel: nextLevelIndex,
                currentLevelNodeIds: nextLevel,
              };

              // Запускаем генерацию для следующего уровня
              nextLevel.forEach((nId) => {
                const nodeIndex = state.nodes.findIndex((n) => n.id === nId);
                if (nodeIndex !== -1) {
                  state.nodes[nodeIndex].data = {
                    ...state.nodes[nodeIndex].data,
                    pendingRegenerate: true,
                    updatedAt: Date.now(),
                  };
                }
              });
            });
          } else {
            // Уровень ещё не завершён - просто обновляем прогресс
            set((state) => {
              if (state.batchRegenerationProgress) {
                state.batchRegenerationProgress = {
                  ...state.batchRegenerationProgress,
                  completed: newCompleted,
                  currentLevelNodeIds: newCurrentLevelNodeIds,
                };
              }
            });
          }
        },

        // =========================================================================
        // ЭКШЕНЫ: ПЕРСИСТЕНТНОСТЬ
        // =========================================================================

        /**
         * Установить текущий ID холста
         * Используется для переключения между холстами
         */
        setCurrentCanvasId: (canvasId: string | null) => {
          set((state) => {
            state.currentCanvasId = canvasId;
          });
        },

        /**
         * Загрузка данных холста из JSON файла через API
         * @param canvasId - ID холста для загрузки (если не указан, использует currentCanvasId)
         */
        loadFromFile: async (canvasId?: string) => {
          // Получаем ID холста для загрузки
          const targetCanvasId = canvasId || get().currentCanvasId;

          // Если нет ID - нечего загружать
          if (!targetCanvasId) {
            console.log('[Canvas Store] Нет ID холста для загрузки');
            return;
          }

          // =====================================================================
          // ПАУЗА ИСТОРИИ UNDO/REDO
          // Ставим на паузу ПЕРЕД загрузкой, чтобы рендеринг карточек
          // не записывался в историю как действие
          // =====================================================================
          try {
            useCanvasStore.temporal.getState().pause();
            console.log('[Canvas Store] История поставлена на паузу');
          } catch (error) {
            console.error('[Canvas Store] Ошибка паузы истории:', error);
          }

          // Устанавливаем флаг загрузки и обновляем currentCanvasId
          set((state) => {
            state.isLoading = true;
            state.persistError = null;
            state.currentCanvasId = targetCanvasId;
          });

          try {
            // Запрос к API с ID холста
            const response = await fetch(`/api/canvas/${targetCanvasId}`);

            if (!response.ok) {
              throw new Error(`HTTP error: ${response.status}`);
            }

            const data = await response.json();

            // Обновляем состояние данными из файла
            const loadedNodes = data.nodes || initialNodes;

            set((state) => {
              // Загружаем ноды (или используем пустой массив)
              state.nodes = loadedNodes;
              // Загружаем связи (могут быть пустыми)
              state.edges = data.edges || [];
              // Обновляем метаданные
              state.lastSaved = data.lastSaved || null;
              state.isLoading = false;
              state.hasUnsavedChanges = false;
              // Сбрасываем выбор
              state.selectedNodeId = null;
              state.pendingFocusNodeId = null;
              state.pendingCenterNodeId = null;
            });

            console.log(`[Canvas Store] Загружен холст ${targetCanvasId}: ${loadedNodes.length} нод`);

            // =====================================================================
            // ОЧИСТКА И ВОЗОБНОВЛЕНИЕ ИСТОРИИ UNDO/REDO
            // Очищаем историю и возобновляем запись после загрузки
            // =====================================================================
            try {
              useCanvasStore.temporal.getState().clear();
              previousHistoryState = null;
              // Небольшая задержка перед возобновлением, чтобы React успел отрендерить
              setTimeout(() => {
                useCanvasStore.temporal.getState().resume();
                console.log('[Canvas Store] История очищена и возобновлена');
              }, 100);
            } catch (error) {
              console.error('[Canvas Store] Ошибка очистки истории:', error);
              // Всё равно возобновляем историю при ошибке
              useCanvasStore.temporal.getState().resume();
            }

            // =====================================================================
            // СИНХРОНИЗАЦИЯ ПОИСКОВЫХ ИНДЕКСОВ
            // Удаляем эмбеддинги для карточек, которых больше нет на холсте
            // Это предотвращает появление "призраков" в поиске
            // =====================================================================
            const existingNodeIds = loadedNodes.map((n: NeuroNode) => n.id);
            syncEmbeddingsWithCanvas(targetCanvasId, existingNodeIds).catch((error) => {
              console.error('[Canvas Store] Ошибка синхронизации эмбеддингов:', error);
            });
          } catch (error) {
            console.error('[Canvas Store] Ошибка загрузки:', error);

            set((state) => {
              state.isLoading = false;
              state.persistError = 'Не удалось загрузить данные холста';
            });

            // Возобновляем историю при ошибке загрузки
            try {
              useCanvasStore.temporal.getState().resume();
            } catch (resumeError) {
              console.error('[Canvas Store] Ошибка возобновления истории:', resumeError);
            }
          }
        },

        /**
         * Сохранение данных в JSON файл через API
         * Вызывается автоматически при изменениях (с debounce)
         * или вручную пользователем
         */
        saveToFile: async () => {
          const { nodes, edges, currentCanvasId } = get();

          // Если нет ID холста - нечего сохранять
          if (!currentCanvasId) {
            console.log('[Canvas Store] Нет ID холста для сохранения');
            return;
          }

          // Устанавливаем флаг сохранения
          set((state) => {
            state.isSaving = true;
            state.persistError = null;
          });

          try {
            // Запрос к API с ID холста
            const response = await fetch(`/api/canvas/${currentCanvasId}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ nodes, edges }),
            });

            if (!response.ok) {
              throw new Error(`HTTP error: ${response.status}`);
            }

            const result = await response.json();

            // Обновляем метаданные
            set((state) => {
              state.isSaving = false;
              state.lastSaved = result.lastSaved || Date.now();
              state.hasUnsavedChanges = false;
            });

            console.log(`[Canvas Store] Сохранён холст ${currentCanvasId}`);
          } catch (error) {
            console.error('[Canvas Store] Ошибка сохранения:', error);

            set((state) => {
              state.isSaving = false;
              state.persistError = 'Не удалось сохранить данные холста';
            });
          }
        },

        /**
         * Сброс ошибки персистентности
         */
        clearPersistError: () => {
          set((state) => {
            state.persistError = null;
          });
        },
      }))),
    // ===========================================================================
    // ОПЦИИ TEMPORAL MIDDLEWARE (UNDO/REDO)
    // ===========================================================================
    {
      /**
       * Максимальное количество шагов в истории
       */
      limit: HISTORY_LIMIT,

      /**
       * Выбираем только nodes и edges для отслеживания
       * ВАЖНО: Сохраняем ПОЛНЫЕ ноды (включая response), чтобы при undo/redo
       * восстанавливалось полное состояние карточек.
       * Фильтрация полей происходит только в areStatesEqual для сравнения.
       * 
       * КРИТИЧНО: Используем глубокое копирование чтобы избежать проблем с immer proxy!
       * Без этого при undo позиции карточек не восстанавливаются корректно.
       */
      partialize: (state): HistoryState => ({
        nodes: JSON.parse(JSON.stringify(state.nodes)),
        edges: JSON.parse(JSON.stringify(state.edges)),
      }),

      /**
       * Функция сравнения состояний
       * Возвращает true если состояния эквивалентны (не создавать новую запись)
       */
      equality: areStatesEqual,

      /**
       * Callback при сохранении состояния в историю
       * Используется для синхронизации поисковых индексов
       */
      onSave: (pastState) => {
        // Сохраняем предыдущее состояние для последующей синхронизации
        previousHistoryState = pastState as HistoryState;
      },

      /**
       * Модификация handleSet для группировки быстрых изменений
       * 
       * Pause/Resume стратегия:
       * - При первом изменении в серии - ставим на паузу
       * - Во время серии изменений - ничего не записывается
       * - После паузы (delay) - снимаем паузу и записываем финальное состояние
       * 
       * Создаёт ровно 1 запись в истории за одно перемещение.
       */
      handleSet: (handleSet) =>
        setupHistoryPauseDebounce(handleSet, HISTORY_DEBOUNCE),
    }
  ));

// =============================================================================
// СЕЛЕКТОРЫ (для оптимизации подписок)
// =============================================================================

/**
 * Селектор для получения конкретной ноды по ID
 * Использовать с useCanvasStore(selectNodeById(id))
 */
export const selectNodeById = (nodeId: string) => (state: CanvasStore) =>
  state.nodes.find((n) => n.id === nodeId);

/**
 * Селектор для получения всех дочерних нод
 */
export const selectChildNodes = (nodeId: string) => (state: CanvasStore) => {
  const childEdges = state.edges.filter((e) => e.source === nodeId);
  const childIds = childEdges.map((e) => e.target);
  return state.nodes.filter((n) => childIds.includes(n.id));
};

/**
 * Селектор для получения родительской ноды
 * ДИНАМИЧЕСКИЙ: проверяет наличие связи, а не только parentId
 */
export const selectParentNode = (nodeId: string) => (state: CanvasStore) => {
  // Сначала ищем входящую связь (более надёжно)
  const incomingEdge = state.edges.find((e) => e.target === nodeId);
  if (incomingEdge) {
    return state.nodes.find((n) => n.id === incomingEdge.source) || null;
  }

  // Fallback на parentId в data
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node?.data.parentId) return null;
  return state.nodes.find((n) => n.id === node.data.parentId) || null;
};

/**
 * Селектор для получения цепочки всех предков ноды
 * 
 * Возвращает массив предков от родителя до корня:
 * [parentNode, grandparentNode, greatGrandparentNode, ...]
 * 
 * Используется для построения иерархического контекста:
 * - index 0 (родитель): получает полный response
 * - index > 0 (дедушки и далее): получает summary
 * 
 * @param nodeId - ID ноды, для которой ищем предков
 * @returns Массив нод-предков от ближайшего к дальнему
 */
export const selectAncestorChain = (nodeId: string) => (state: CanvasStore): NeuroNode[] => {
  const ancestors: NeuroNode[] = [];
  let currentNodeId: string | null = nodeId;

  // Защита от бесконечных циклов (на случай некорректных данных)
  const maxDepth = 100;
  let depth = 0;

  while (currentNodeId && depth < maxDepth) {
    depth++;

    // Ищем входящую связь для текущей ноды
    const incomingEdge = state.edges.find((e) => e.target === currentNodeId);

    if (incomingEdge) {
      // Нашли родителя через связь
      const parentNode = state.nodes.find((n) => n.id === incomingEdge.source);

      if (parentNode) {
        ancestors.push(parentNode);
        currentNodeId = parentNode.id;
        continue;
      }
    }

    // Fallback: ищем через parentId в data
    const currentNode = state.nodes.find((n) => n.id === currentNodeId);

    if (currentNode?.data.parentId) {
      const parentNode = state.nodes.find((n) => n.id === currentNode.data.parentId);

      if (parentNode) {
        ancestors.push(parentNode);
        currentNodeId = parentNode.id;
        continue;
      }
    }

    // Дошли до корня или нет связей - выходим
    break;
  }

  return ancestors;
};

// =============================================================================
// АВТОСОХРАНЕНИЕ С DEBOUNCE
// =============================================================================

/**
 * Таймер для debounce автосохранения
 * Храним в модуле для доступа из subscribe
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Задержка перед автосохранением (мс)
 * 1 секунда - баланс между отзывчивостью и количеством запросов
 */
const AUTOSAVE_DELAY = 1000;

/**
 * Флаг: была ли выполнена первоначальная загрузка
 * Предотвращает автосохранение при инициализации
 */
let hasLoadedInitialData = false;

// =============================================================================
// ФУНКЦИИ ДЛЯ УМНОГО СРАВНЕНИЯ (ИГНОРИРОВАНИЕ UI-ПОЛЕЙ)
// =============================================================================

/**
 * Поля ноды, которые НЕ должны триггерить автосохранение
 * Это временные UI-поля, которые не влияют на данные пользователя:
 * - selected: выделение карточки на холсте
 * - dragging: перетаскивание карточки
 * - measured: измеренные размеры (React Flow)
 * - resizing: изменение размера
 */
const IGNORED_NODE_FIELDS = ['selected', 'dragging', 'measured', 'resizing'] as const;

/**
 * Поля data ноды, которые НЕ должны триггерить автосохранение
 * Это состояния UI, которые не нужно сохранять:
 * - isGenerating: идёт ли генерация (временное)
 * - isSummarizing: идёт ли суммаризация (временное)
 * - isQuoteModeActive: режим цитирования активен (временное)
 */
const IGNORED_DATA_FIELDS = ['isGenerating', 'isSummarizing', 'isQuoteModeActive'] as const;

/**
 * Извлекает "значимые" данные из ноды для сравнения
 * Исключает временные UI-поля, которые не нужно сохранять
 * 
 * @param node - нода для обработки
 * @returns объект только со значимыми полями
 */
const getSignificantNodeData = (node: NeuroNode): object => {
  // Копируем ноду без игнорируемых полей верхнего уровня
  const significantNode: Record<string, unknown> = {};

  for (const key of Object.keys(node)) {
    if (!IGNORED_NODE_FIELDS.includes(key as typeof IGNORED_NODE_FIELDS[number])) {
      if (key === 'data') {
        // Для data - также исключаем игнорируемые поля
        const significantData: Record<string, unknown> = {};
        for (const dataKey of Object.keys(node.data)) {
          if (!IGNORED_DATA_FIELDS.includes(dataKey as typeof IGNORED_DATA_FIELDS[number])) {
            significantData[dataKey] = node.data[dataKey as keyof typeof node.data];
          }
        }
        significantNode[key] = significantData;
      } else {
        significantNode[key] = node[key as keyof typeof node];
      }
    }
  }

  return significantNode;
};

/**
 * Проверяет, есть ли "значимые" изменения между двумя массивами нод
 * Игнорирует изменения в полях selected, dragging, measured и т.д.
 * 
 * @param current - текущий массив нод
 * @param previous - предыдущий массив нод
 * @returns true если есть значимые изменения, false если только UI-изменения
 */
const hasSignificantNodeChanges = (
  current: NeuroNode[],
  previous: NeuroNode[]
): boolean => {
  // Быстрая проверка: если одинаковая ссылка - изменений нет
  if (current === previous) return false;

  // Проверка количества нод
  if (current.length !== previous.length) return true;

  // Создаём Map для быстрого поиска предыдущих нод по ID
  const previousMap = new Map(previous.map((n) => [n.id, n]));

  // Проверяем каждую текущую ноду
  for (const currentNode of current) {
    const previousNode = previousMap.get(currentNode.id);

    // Если ноды с таким ID не было - это значимое изменение (новая нода)
    if (!previousNode) return true;

    // Сравниваем значимые данные
    const currentSignificant = JSON.stringify(getSignificantNodeData(currentNode));
    const previousSignificant = JSON.stringify(getSignificantNodeData(previousNode));

    if (currentSignificant !== previousSignificant) {
      return true;
    }
  }

  // Проверяем, не были ли удалены ноды (по ID)
  const currentIds = new Set(current.map((n) => n.id));
  for (const prevNode of previous) {
    if (!currentIds.has(prevNode.id)) {
      return true; // Нода была удалена - значимое изменение
    }
  }

  return false;
};

/**
 * Проверяет, есть ли "значимые" изменения между двумя массивами связей
 * 
 * @param current - текущий массив связей
 * @param previous - предыдущий массив связей
 * @returns true если есть значимые изменения
 */
const hasSignificantEdgeChanges = (
  current: NeuroEdge[],
  previous: NeuroEdge[]
): boolean => {
  // Быстрая проверка: если одинаковая ссылка - изменений нет
  if (current === previous) return false;

  // Проверка количества связей
  if (current.length !== previous.length) return true;

  // Создаём Set ID для быстрого сравнения
  const currentIds = new Set(current.map((e) => e.id));
  const previousIds = new Set(previous.map((e) => e.id));

  // Проверяем что все текущие связи были и раньше
  for (const id of currentIds) {
    if (!previousIds.has(id)) return true;
  }

  // Проверяем что все предыдущие связи есть сейчас
  for (const id of previousIds) {
    if (!currentIds.has(id)) return true;
  }

  return false;
};

/**
 * Подписка на изменения nodes и edges для автосохранения
 * 
 * ВАЖНО: 
 * - УМНОЕ СРАВНЕНИЕ: игнорируем UI-поля (selected, dragging и т.д.)
 * - Debounce предотвращает множественные сохранения при быстрых изменениях
 * - Не сохраняем во время загрузки или если уже идёт сохранение
 * 
 * КРИТИЧНО: Автосохранение срабатывает ТОЛЬКО при "серьёзных" изменениях:
 * - Добавление/удаление нод или связей
 * - Изменение позиции нод
 * - Изменение данных нод (prompt, response, и т.д.)
 * 
 * НЕ срабатывает при:
 * - Выделении карточки (selected)
 * - Перетаскивании (dragging)
 * - Изменении размеров (measured, resizing)
 * - Временных UI-состояниях (isGenerating, isSummarizing)
 */
useCanvasStore.subscribe(
  // Селектор: отслеживаем изменения nodes и edges
  (state) => ({ nodes: state.nodes, edges: state.edges }),

  // Callback при изменениях
  (current, previous) => {
    // Пропускаем если ссылки одинаковые (редкий случай, но быстрая проверка)
    if (current.nodes === previous.nodes && current.edges === previous.edges) {
      return;
    }

    // Пропускаем если ещё не загрузили начальные данные
    if (!hasLoadedInitialData) {
      return;
    }

    // Получаем текущее состояние
    const state = useCanvasStore.getState();

    // Пропускаем если идёт загрузка или сохранение
    if (state.isLoading || state.isSaving) {
      return;
    }

    // =======================================================================
    // УМНАЯ ПРОВЕРКА: Есть ли ЗНАЧИМЫЕ изменения?
    // Игнорируем изменения только в UI-полях (selected, dragging и т.д.)
    // =======================================================================
    const hasNodeChanges = hasSignificantNodeChanges(current.nodes, previous.nodes);
    const hasEdgeChanges = hasSignificantEdgeChanges(current.edges, previous.edges);

    // Если изменений в значимых полях нет - не сохраняем
    if (!hasNodeChanges && !hasEdgeChanges) {
      return;
    }

    // Отмечаем что есть несохранённые изменения
    useCanvasStore.setState({ hasUnsavedChanges: true });

    // Очищаем предыдущий таймер
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Устанавливаем новый таймер для debounced сохранения
    saveTimeout = setTimeout(() => {
      console.log('[Canvas Store] Автосохранение...');
      useCanvasStore.getState().saveToFile();
    }, AUTOSAVE_DELAY);
  },

  // Опции: НЕ используем equalityFn - проверка происходит внутри callback
  {
    equalityFn: () => false, // Всегда вызываем callback, проверка внутри
  }
);

/**
 * Функция для пометки что начальные данные загружены
 * Вызывается после loadFromFile()
 */
export const markInitialDataLoaded = () => {
  hasLoadedInitialData = true;
};

/**
 * Функция для сброса флага (для тестов)
 */
export const resetInitialDataFlag = () => {
  hasLoadedInitialData = false;
};

// =============================================================================
// ЭКСПОРТ TEMPORAL STORE (UNDO/REDO)
// =============================================================================

/**
 * Получить temporal store (историю состояний) напрямую
 * 
 * Возвращает объект с методами:
 * - undo(): void - отменить последнее изменение
 * - redo(): void - повторить отменённое изменение
 * - clear(): void - очистить историю
 * - pastStates: HistoryState[] - предыдущие состояния
 * - futureStates: HistoryState[] - отменённые состояния для redo
 * 
 * @note Для React-компонентов используйте performUndo/performRedo функции,
 *       которые также синхронизируют поисковые индексы.
 */
export const getTemporalStore = (): TemporalState<HistoryState> => {
  return useCanvasStore.temporal.getState();
};

/**
 * Выполнить операцию Undo (отмена)
 * 
 * Восстанавливает предыдущее состояние и синхронизирует поисковые индексы.
 * Блокирует удаление индексов во время операции.
 */
export const performUndo = (): void => {
  const temporalStore = useCanvasStore.temporal.getState();

  // Проверяем есть ли что отменять
  if (temporalStore.pastStates.length === 0) {
    console.log('[performUndo] Нет состояний для отмены');
    return;
  }

  // Сохраняем текущее состояние для синхронизации индексов
  const currentState = useCanvasStore.getState();
  const prevNodes = [...currentState.nodes];

  // Устанавливаем флаг операции undo/redo
  isUndoRedoOperation = true;

  try {
    // Выполняем undo
    temporalStore.undo();

    // Синхронизируем индексы
    const newState = useCanvasStore.getState();
    syncIndexesAfterHistoryChange(prevNodes, newState.nodes);

    // Планируем проверку stale
    scheduleStaleCheck();

    console.log('[performUndo] Отмена выполнена успешно');
  } finally {
    // Сбрасываем флаг
    isUndoRedoOperation = false;
  }
};

/**
 * Выполнить операцию Redo (повтор)
 * 
 * Восстанавливает следующее состояние и синхронизирует поисковые индексы.
 * Блокирует удаление индексов во время операции.
 */
export const performRedo = (): void => {
  const temporalStore = useCanvasStore.temporal.getState();

  // Проверяем есть ли что повторять
  if (temporalStore.futureStates.length === 0) {
    console.log('[performRedo] Нет состояний для повтора');
    return;
  }

  // Сохраняем текущее состояние для синхронизации индексов
  const currentState = useCanvasStore.getState();
  const prevNodes = [...currentState.nodes];

  // Устанавливаем флаг операции undo/redo
  isUndoRedoOperation = true;

  try {
    // Выполняем redo
    temporalStore.redo();

    // Синхронизируем индексы
    const newState = useCanvasStore.getState();
    syncIndexesAfterHistoryChange(prevNodes, newState.nodes);

    // Планируем проверку stale
    scheduleStaleCheck();

    console.log('[performRedo] Повтор выполнен успешно');
  } finally {
    // Сбрасываем флаг
    isUndoRedoOperation = false;
  }
};

/**
 * Очистить историю состояний
 * 
 * Сбрасывает pastStates и futureStates.
 * Используется при смене холста или загрузке нового файла.
 */
export const clearHistory = (): void => {
  const temporalStore = useCanvasStore.temporal.getState();
  temporalStore.clear();
  previousHistoryState = null;
  console.log('[clearHistory] История очищена');
};

/**
 * Проверить возможность выполнения Undo
 */
export const canUndo = (): boolean => {
  return useCanvasStore.temporal.getState().pastStates.length > 0;
};

/**
 * Проверить возможность выполнения Redo
 */
export const canRedo = (): boolean => {
  return useCanvasStore.temporal.getState().futureStates.length > 0;
};

/**
 * Получить количество шагов в истории для Undo
 */
export const getUndoCount = (): number => {
  return useCanvasStore.temporal.getState().pastStates.length;
};

/**
 * Получить количество шагов в истории для Redo
 */
export const getRedoCount = (): number => {
  return useCanvasStore.temporal.getState().futureStates.length;
};

/**
 * Проверить идёт ли операция undo/redo
 * Используется в removeNode для предотвращения удаления индексов
 */
export const isHistoryOperation = (): boolean => {
  return isUndoRedoOperation;
};
