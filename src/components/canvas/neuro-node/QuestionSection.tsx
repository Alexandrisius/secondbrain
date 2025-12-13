import React, { useState, useCallback, useEffect, useMemo } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Handle, Position } from '@xyflow/react';
import {
  Zap,
  Square,
  AlertCircle,
  RefreshCw,
  Loader2,
  Quote,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation, format } from '@/lib/i18n';
import type { NeuroNode } from '@/types/canvas';
import { NeuroSearchButton } from './NeuroSearchButton';
import { useNeuroSearchStore } from '@/store/useNeuroSearchStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import { searchSimilar } from '@/lib/search/semantic';
import {
  useSettingsStore,
  selectApiKey,
  selectEmbeddingsBaseUrl,
  selectCorporateMode,
  selectEmbeddingsModel,
  selectNeuroSearchMinSimilarity,
} from '@/store/useSettingsStore';

// Пустой массив для предотвращения лишних ререндеров (типизированный)
const EMPTY_SEARCH_RESULTS: import('@/types/embeddings').SearchResult[] = [];
const EMPTY_STRING_ARRAY: string[] = [];
// Пустой объект для снимка
const EMPTY_SNAPSHOT: Record<string, number> = {};

/**
 * Ограничения для построения поискового запроса NeuroSearch.
 *
 * Почему вообще нужен лимит:
 * - Эмбеддинги считаются по тексту, и чем длиннее текст, тем:
 *   1) дороже запрос,
 *   2) выше риск упереться в лимиты модели эмбеддингов,
 *   3) больше «шума» в query (особенно если мы добавляем родительский контекст).
 *
 * Поэтому мы добавляем в query только “самое полезное”:
 * - вопрос ребёнка (обязательно)
 * - цитату (если она есть — это самый точный якорь)
 * - summary родителя (или короткий fallback из response, если summary отсутствует)
 */
const MAX_NEUROSEARCH_QUERY_CHARS = 4000;
const PARENT_CONTEXT_FALLBACK_CHARS = 900;

/**
 * Нормализует список ID для сравнения.
 *
 * ВАЖНО:
 * - Мы считаем `undefined` и `[]` эквивалентными состояниями ("нейропоиск не используется").
 * - Поэтому при пустом результате NeuroSearch мы предпочитаем сохранять `undefined`, чтобы:
 *   1) не плодить "пустые" массивы в data ноды,
 *   2) не триггерить ложную инвалидизацию `stale`,
 *   3) оставаться совместимыми с логикой `useCanvasStore.updateNodeData`,
 *      где переходы `undefined ↔ []` намеренно игнорируются.
 */
const normalizeIdList = (ids?: string[]): string[] => (ids ?? []).filter(Boolean);

/**
 * Сравнение двух списков ID.
 *
 * ВАЖНО:
 * - Сравниваем *в порядке*, т.к. порядок результатов NeuroSearch может влиять на
 *   порядок подмешивания "виртуального" контекста → а значит и на ответ LLM.
 * - Если нужно будет считать порядок неважным, здесь достаточно будет сортировки
 *   (но сейчас оставляем строгую проверку, чтобы не скрыть реальные изменения контекста).
 */
const areIdListsEqual = (a?: string[], b?: string[]): boolean => {
  const aa = normalizeIdList(a);
  const bb = normalizeIdList(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
};

interface QuestionSectionProps {
  id: string;
  data: NeuroNode['data'];
  isEditing: boolean;
  localPrompt: string;
  hasParentContext: boolean;
  directParents: NeuroNode[];
  isGenerating: boolean;
  hasContent: boolean;
  setIsEditing: (val: boolean) => void;
  handlePromptChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handlePromptBlur: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleGenerate: () => void;
  handleRegenerate: () => void;
  handleAbortGeneration: () => void;
  handleInitiateQuoteSelectionInParent: () => void;
  setIsContextModalOpen: (val: boolean) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  questionSectionRef: React.RefObject<HTMLDivElement>;
}

export const QuestionSection: React.FC<QuestionSectionProps> = ({
  id,
  data,
  isEditing,
  localPrompt,
  hasParentContext,
  directParents,
  isGenerating,
  hasContent,
  setIsEditing,
  handlePromptChange,
  handlePromptBlur,
  handleKeyDown,
  handleGenerate,
  handleRegenerate,
  handleAbortGeneration,
  handleInitiateQuoteSelectionInParent,
  setIsContextModalOpen,
  textareaRef,
  questionSectionRef,
}) => {
  const { t } = useTranslation();
  
  // === STORES ===
  
  // Settings Store
  const apiKey = useSettingsStore(selectApiKey);
  const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
  const corporateMode = useSettingsStore(selectCorporateMode);
  const embeddingsModel = useSettingsStore(selectEmbeddingsModel);
  // Порог “чувствительности” NeuroSearch (настраивается в SettingsModal)
  const neuroSearchMinSimilarity = useSettingsStore(selectNeuroSearchMinSimilarity);
  
  // Canvas Store - для доступа к nodes и обновления data
  const nodes = useCanvasStore(state => state.nodes);
  // Edges нужны для вычисления “родословной” (предки/потомки),
  // чтобы NeuroSearch не подмешивал в контекст уже “родственные” карточки.
  const edges = useCanvasStore(state => state.edges);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);
  const markChildrenStale = useCanvasStore(state => state.markChildrenStale);
  
  // NeuroSearch Store
  const setNeuroSearchResults = useNeuroSearchStore(state => state.setResults);
  const clearNeuroSearchResults = useNeuroSearchStore(state => state.clearResults);
  const setIsNeuroSearching = useNeuroSearchStore(state => state.setIsSearching);
  const neuroSearchResults = useNeuroSearchStore(state => state.results[id] || EMPTY_SEARCH_RESULTS);
  const isNeuroSearching = useNeuroSearchStore(state => state.isSearching[id] || false);
  
  // Получаем снимок состояния подключённых карточек на момент поиска
  const sourceNodesSnapshot = useNeuroSearchStore(state => state.sourceNodesSnapshot[id] || EMPTY_SNAPSHOT);

  // === ВЫЧИСЛЕНИЕ STALE СТАТУСА ===
  // 
  // Результаты NeuroSearch устаревают когда:
  // - Любая из подключённых карточек была обновлена ПОСЛЕ момента поиска
  // 
  // Для этого сравниваем текущий updatedAt каждой подключённой карточки
  // с сохранённым снимком updatedAt на момент поиска.
  const isNeuroSearchStale = useMemo(() => {
    // Если нет результатов - нет устаревания
    if (neuroSearchResults.length === 0) return false;
    
    // Проверяем каждую подключённую карточку
    for (const result of neuroSearchResults) {
      // Находим карточку в текущем состоянии canvas
      const sourceNode = nodes.find(n => n.id === result.nodeId);
      
      if (sourceNode) {
        // Получаем сохранённый updatedAt на момент поиска
        const savedUpdatedAt = sourceNodesSnapshot[result.nodeId];
        
        // Если карточка была обновлена позже снимка - контекст устарел
        // Также считаем устаревшим если снимка нет (savedUpdatedAt === undefined)
        if (!savedUpdatedAt || sourceNode.data.updatedAt > savedUpdatedAt) {
          return true;
        }
      }
    }
    
    return false;
  }, [neuroSearchResults, sourceNodesSnapshot, nodes]);

  // Local state for toggle button visual state
  const [isNeuroSearchEnabled, setIsNeuroSearchEnabled] = useState(false);

  // При монтировании проверяем, есть ли сохраненные результаты и включаем кнопку
  useEffect(() => {
    if (neuroSearchResults.length > 0 && !isNeuroSearchEnabled) {
      setIsNeuroSearchEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neuroSearchResults.length]);

  // === ВЫПОЛНЕНИЕ НЕЙРОПОИСКА ===
  // 
  // Выполняет семантический поиск похожих карточек и:
  // 1. Сохраняет результаты в store
  // 2. Создаёт снимок updatedAt подключённых карточек
  // 3. Обновляет neuroSearchNodeIds в data карточки
  // 4. Помечает потомков как stale (если у карточки есть ответ)
  const executeNeuroSearch = useCallback(async () => {
    if (!localPrompt.trim() || !apiKey) return;

    setIsNeuroSearching(id, true);
    try {
      /**
       * Строим “контекстный” поисковый запрос для эмбеддинга.
       *
       * Проблема текущего подхода (только localPrompt):
       * - вопросы часто бывают короткими/общими: “И что дальше?”, “Почему?”, “А как?”
       * - без контекста родителя эмбеддинг такого запроса не несёт смысла → поиск “слепой”
       *
       * Решение:
       * - добавляем summary прямых родителей (или короткий response, если summary нет)
       * - добавляем цитату (если карточка цитатная) как максимально точный контекст
       *
       * ВАЖНО:
       * - этот текст используется ТОЛЬКО для получения query embedding
       * - он НЕ подмешивается в LLM напрямую (LLM контекст строится отдельно)
       */
      const queryParts: string[] = [];

      // 1) База: вопрос ребёнка
      queryParts.push(`Вопрос (ребёнок): ${localPrompt}`);

      // 2) Цитата (если есть) — очень сильный “якорь” смысла
      if (data.quote) {
        queryParts.push(`Цитата (из родителя): "${data.quote}"`);
      }

      // 3) Контекст прямых родителей: summary → fallback на кусок response
      //    Мы делаем это явно, чтобы запросы типа “А как дальше?” начали работать.
      if (directParents.length > 0) {
        directParents.forEach((parent, index) => {
          const parentPrompt = parent.data.prompt || '';
          const parentSummary = parent.data.summary || '';
          const parentResponse = parent.data.response || '';

          // Берём summary, если оно есть (предпочтительно — меньше шума, быстрее, стабильнее).
          // Если summary нет — fallback на обрезанный response.
          const parentContext =
            parentSummary ||
            (parentResponse
              ? (parentResponse.length > PARENT_CONTEXT_FALLBACK_CHARS
                ? parentResponse.slice(0, PARENT_CONTEXT_FALLBACK_CHARS) + '...'
                : parentResponse)
              : '');

          // Если у родителя совсем нет текста — пропускаем (не добавляем пустой шум)
          if (!parentPrompt && !parentContext) return;

          queryParts.push(
            [
              `Родитель #${index + 1}:`,
              parentPrompt ? `Вопрос (родитель): ${parentPrompt}` : null,
              parentContext ? `Суть/контекст (родитель): ${parentContext}` : null,
            ].filter(Boolean).join('\n')
          );
        });
      }

      // 4) Финальная сборка с жёстким лимитом (чтобы не раздувать эмбеддинг-запрос)
      //    Мы режем по символам, сохраняя начало (там самая важная информация).
      //    Это простая и надёжная стратегия.
      const rawQueryText = queryParts.join('\n\n');
      const queryText =
        rawQueryText.length > MAX_NEUROSEARCH_QUERY_CHARS
          ? rawQueryText.slice(0, MAX_NEUROSEARCH_QUERY_CHARS)
          : rawQueryText;

      const results = await searchSimilar(
        {
          // ВАЖНО: queryText отличается от отображаемого вопроса.
          // localPrompt остаётся вопросом карточки, а queryText — это “упаковка” для эмбеддинга.
          query: queryText,
          canvasId: null, // Глобальный поиск
          limit: 10, // Запрашиваем больше, чтобы можно было отфильтровать
          // Пользовательская “чувствительность” NeuroSearch:
          // - меньше порог → больше кандидатов (выше recall, больше шума)
          // - больше порог → меньше кандидатов (выше precision)
          minSimilarity: neuroSearchMinSimilarity,
        },
        apiKey,
        embeddingsBaseUrl,
        corporateMode,
        embeddingsModel // Передаем модель
      );
      
      // Фильтрация результатов:
      // 1. Исключаем саму себя (id)
      // 2. Исключаем уже существующие родительские связи (directParents)
      // 3. КРИТИЧНО: исключаем “ветку родословной” текущей карточки:
      //    - всех предков (вверх по родителям)
      //    - всех потомков (вниз по детям)
      //
      // Почему это нужно:
      // - контекст предков и так доступен через стандартный механизм контекста
      // - контекст потомков мы формируем “снизу” сами и не должны подтягивать его в родителя
      // - иначе возможны:
      //   1) циклы “контекст сам себя подкрепляет”,
      //   2) утечки будущего контекста (потомок может содержать выводы, которые модель ещё “не должна знать”),
      //   3) деградация качества (много дублей в контексте)
      //
      // ВАЖНО:
      // - Мы исключаем именно ancestors + descendants относительно текущей ноды.
      // - “Боковые” ветки (например, siblings/кузены) НЕ исключаем,
      //   потому что они не являются предком/потомком и часто содержат полезный параллельный контекст.

      /**
       * Строим граф родословных связей в рамках текущего холста.
       *
       * Мы учитываем 2 источника правды:
       * 1) edges (source -> target), где source — родитель, target — ребёнок
       * 2) data.parentId / data.parentIds (на случай несовпадений/legacy)
       *
       * Результат:
       * - parentsOf(childId) -> Set(parentId)
       * - childrenOf(parentId) -> Set(childId)
       */
      const parentsOf = new Map<string, Set<string>>();
      const childrenOf = new Map<string, Set<string>>();

      const addLink = (parentId: string | undefined | null, childId: string | undefined | null) => {
        if (!parentId || !childId) return;
        if (parentId === childId) return;
        const pSet = parentsOf.get(childId) || new Set<string>();
        pSet.add(parentId);
        parentsOf.set(childId, pSet);

        const cSet = childrenOf.get(parentId) || new Set<string>();
        cSet.add(childId);
        childrenOf.set(parentId, cSet);
      };

      // 1) edges — основной источник для связей
      edges.forEach((e) => addLink(e.source, e.target));

      // 2) fallback на parentId / parentIds в data (чтобы не зависеть от того, где хранится связь)
      nodes.forEach((n) => {
        const pid = n.data.parentId;
        if (pid) addLink(pid, n.id);
        const pids = n.data.parentIds;
        if (pids && pids.length > 0) {
          pids.forEach((p) => addLink(p, n.id));
        }
      });

      /**
       * Собираем всех предков (ancestors): идём “вверх” по parentsOf.
       */
      const ancestorIds = new Set<string>();
      const ancestorQueue: string[] = Array.from(parentsOf.get(id) || []);
      const MAX_LINEAGE_WALK = 5000; // страховка от циклов/битых данных
      let lineageSteps = 0;

      while (ancestorQueue.length > 0 && lineageSteps < MAX_LINEAGE_WALK) {
        lineageSteps++;
        const curr = ancestorQueue.shift()!;
        if (ancestorIds.has(curr)) continue;
        ancestorIds.add(curr);

        const ps = parentsOf.get(curr);
        if (ps) {
          ps.forEach((p) => {
            if (!ancestorIds.has(p)) ancestorQueue.push(p);
          });
        }
      }

      /**
       * Собираем всех потомков (descendants): идём “вниз” по childrenOf.
       */
      const descendantIds = new Set<string>();
      const descendantQueue: string[] = Array.from(childrenOf.get(id) || []);
      lineageSteps = 0;

      while (descendantQueue.length > 0 && lineageSteps < MAX_LINEAGE_WALK) {
        lineageSteps++;
        const curr = descendantQueue.shift()!;
        if (descendantIds.has(curr)) continue;
        descendantIds.add(curr);

        const cs = childrenOf.get(curr);
        if (cs) {
          cs.forEach((c) => {
            if (!descendantIds.has(c)) descendantQueue.push(c);
          });
        }
      }

      const filteredResults = results.filter(result => {
        // Исключаем саму себя
        if (result.nodeId === id) return false;
        
        // Исключаем прямых родителей
        const isParent = directParents.some(parent => parent.id === result.nodeId);
        if (isParent) return false;

        // Исключаем предков (любого уровня)
        if (ancestorIds.has(result.nodeId)) return false;

        // Исключаем потомков (любого уровня)
        if (descendantIds.has(result.nodeId)) return false;
        
        return true;
      });
      
      // Ограничиваем количество до 5 лучших после фильтрации
      const finalResults = filteredResults.slice(0, 5);
      
      // === СОЗДАЁМ СНИМОК СОСТОЯНИЯ ПОДКЛЮЧЁННЫХ КАРТОЧЕК ===
      // Для каждой найденной карточки сохраняем её текущий updatedAt
      // Это позволит определить устаревание, если карточка будет изменена
      const snapshot: Record<string, number> = {};
      finalResults.forEach(result => {
        const sourceNode = nodes.find(n => n.id === result.nodeId);
        if (sourceNode) {
          snapshot[result.nodeId] = sourceNode.data.updatedAt;
        }
      });
      
      // Сохраняем результаты вместе со снимком
      setNeuroSearchResults(id, finalResults, snapshot);

      // Если результатов нет - сразу выключаем кнопку
      if (finalResults.length === 0) {
        setIsNeuroSearchEnabled(false);
      }
      
      // === СОХРАНЯЕМ neuroSearchNodeIds В DATA КАРТОЧКИ ===
      // Это нужно для:
      // 1. Вычисления хэша контекста (computeContextHash)
      // 2. Передачи контекста потомкам
      // 3. Персистентности при сохранении холста
      const nextNeuroSearchNodeIds = finalResults.map(r => r.nodeId);

      // =========================================================================
      // КЛЮЧЕВОЙ МОМЕНТ (фикс бага):
      //
      // Ранее код выставлял `isStale: true` просто по факту клика/запуска поиска,
      // если у карточки уже был ответ (`data.response`).
      //
      // Это приводило к ложному `stale` в ситуации:
      // - NeuroSearch ничего не нашёл (0 результатов)
      // - `neuroSearchNodeIds` как был пустым/undefined, так и остался
      // - контекст фактически НЕ менялся, но карточка окрашивалась как устаревшая
      //
      // Теперь мы помечаем `stale` (и потомков) ТОЛЬКО если список
      // `neuroSearchNodeIds` действительно изменился.
      // =========================================================================
      const prevNeuroSearchNodeIds = data.neuroSearchNodeIds;
      const neuroSearchContextChanged = !areIdListsEqual(prevNeuroSearchNodeIds, nextNeuroSearchNodeIds);

      // Если результатов нет — сохраняем `undefined` (см. normalizeIdList комментарий выше).
      const neuroSearchNodeIdsToPersist =
        nextNeuroSearchNodeIds.length > 0 ? nextNeuroSearchNodeIds : undefined;

      updateNodeData(id, {
        neuroSearchNodeIds: neuroSearchNodeIdsToPersist,
        // updatedAt внутри updateNodeData выставляется автоматически,
        // но оставляем явный timestamp, т.к. этот код уже рассчитывает
        // на "обновление" карточки при изменении настроек контекста.
        updatedAt: Date.now(),
        ...(data.response && neuroSearchContextChanged ? { isStale: true } : {}),
      });
      
      // === ПОМЕЧАЕМ ПОТОМКОВ КАК STALE ===
      // Если у карточки уже есть ответ - её потомки должны знать,
      // что контекст изменился (добавлен нейропоиск)
      // ВАЖНО: помечаем потомков только если контекст действительно изменился.
      // Иначе (особенно при 0 результатов) мы снова получим ложный stale-каскад.
      if (data.response && neuroSearchContextChanged) {
        markChildrenStale(id);
      }
      
      console.log('[NeuroSearch] Поиск завершён:', {
        nodeId: id,
        resultsCount: finalResults.length,
        snapshotKeys: Object.keys(snapshot),
      });
      
    } catch (error) {
      console.error('[NeuroSearch] Ошибка поиска:', error);
    } finally {
      setIsNeuroSearching(id, false);
    }
  }, [
    id, 
    localPrompt, 
    apiKey, 
    embeddingsBaseUrl, 
    corporateMode, 
    embeddingsModel, 
    neuroSearchMinSimilarity,
    directParents, 
    nodes,
    edges,
    data.response,
    data.quote,
    // ВАЖНО: используется для определения, изменился ли контекст NeuroSearch.
    // Если список ID меняется, callback должен видеть актуальное значение.
    data.neuroSearchNodeIds,
    setIsNeuroSearching, 
    setNeuroSearchResults,
    updateNodeData,
    markChildrenStale,
  ]);

  // === ОБРАБОТЧИК ПЕРЕКЛЮЧЕНИЯ КНОПКИ НЕЙРОПОИСКА ===
  // 
  // Логика:
  // 1. Если кнопка stale (оранжевая) и включена - перезапускаем поиск
  // 2. Если кнопка выключена - включаем и запускаем поиск
  // 3. Если кнопка включена (не stale) - выключаем и очищаем результаты
  const handleToggleNeuroSearch = async () => {
    // Нельзя включить если нет промпта
    if (!isNeuroSearchEnabled && !localPrompt.trim()) return;

    // === ОБРАБОТКА STALE СОСТОЯНИЯ ===
    // Если кнопка уже включена И результаты устарели - перезапускаем поиск
    // Это позволяет обновить контекст при повторном клике на оранжевую кнопку
    if (isNeuroSearchEnabled && isNeuroSearchStale) {
      console.log('[NeuroSearch] Перезапуск поиска (stale)');
      await executeNeuroSearch();
      return;
    }

    const newState = !isNeuroSearchEnabled;
    setIsNeuroSearchEnabled(newState);
    
    if (newState) {
      // Активация: запускаем поиск
      await executeNeuroSearch();
    } else {
      // Деактивация: очищаем результаты и neuroSearchNodeIds
      clearNeuroSearchResults(id);
      
      // Также очищаем neuroSearchNodeIds в data карточки
      updateNodeData(id, { 
        neuroSearchNodeIds: undefined,
        updatedAt: Date.now(),
        // Если у карточки уже есть ответ, то отключение контекста делает его устаревшим
        ...(data.response ? { isStale: true } : {})
      });
      
      // Если у карточки есть ответ - помечаем потомков как stale
      // (контекст изменился - убран нейропоиск)
      if (data.response) {
        markChildrenStale(id);
      }
    }
  };

  // Горячая клавиша Alt+Enter для активации NeuroSearch
  // Оборачиваем handleKeyDown родителя
  const onKeyDownWrapper = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      
      if (localPrompt.trim()) {
        setIsNeuroSearchEnabled(true);
        executeNeuroSearch();
      }
      return;
    }
    
    // Вызываем стандартный обработчик
    handleKeyDown(e);
  };

  // Вычисляем количество активных (не исключённых) результатов поиска
  const activeResultsCount = useMemo(() => {
    if (!neuroSearchResults.length) return 0;
    const excludedIds = data.excludedContextNodeIds || EMPTY_STRING_ARRAY;
    return neuroSearchResults.filter(r => !excludedIds.includes(r.nodeId)).length;
  }, [neuroSearchResults, data.excludedContextNodeIds]);

  // Есть ли исключённые результаты (для отображения точки)
  const hasExcludedResults = useMemo(() => {
    return neuroSearchResults.length > activeResultsCount;
  }, [neuroSearchResults.length, activeResultsCount]);

  return (
    <div
      ref={questionSectionRef}
      className="neuro-question-section relative p-4"
    >
      {/* --- HANDLES --- */}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          'neuro-handle',
          '!w-6 !h-6',
          '!bg-primary !border-2 !border-background',
          '!absolute !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2',
        )}
      />

      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          'neuro-handle',
          '!w-6 !h-6',
          '!bg-primary !border-2 !border-background',
          '!absolute !right-0 !top-1/2 !translate-x-1/2 !-translate-y-1/2',
        )}
      />

      {/* Контекст родителя badge - всегда видна при наличии родительского контекста */}
      {/* Убрано условие !data.isStale чтобы кнопка была доступна даже в stale состоянии */}
      {/* Это позволяет пользователю изменять настройки контекста без необходимости регенерации */}
      {(hasParentContext || neuroSearchResults.length > 0) && (
        <button
          onClick={() => setIsContextModalOpen(true)}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'flex items-center gap-1 text-xs mb-2',
            // Оранжевый цвет ТОЛЬКО если карточка stale
            data.isStale
              ? 'text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30'
              : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30',
            'rounded-md px-2 py-1 -ml-2',
            'transition-colors duration-150',
            'cursor-pointer',
            'nodrag'
          )}
          title={t.node.viewFullContext}
        >
          <span className={cn(
            "w-2 h-2 rounded-full",
            // Оранжевый индикатор ТОЛЬКО если карточка stale
            data.isStale
              ? "bg-orange-500"
              : "bg-blue-500"
          )} />
          <span className={cn(
            "underline underline-offset-2",
            // Оранжевое подчёркивание ТОЛЬКО если карточка stale
            data.isStale
              ? "decoration-orange-400/50"
              : "decoration-blue-400/50"
          )}>
            {directParents.length > 1
              ? format(t.node.multipleParentContextUsed, { count: directParents.length })
              : (directParents.length > 0 ? t.node.parentContextUsed : t.node.neuroSearchContext)
            }
            {/* Добавляем индикатор количества найденных карточек, если нет родителей но есть поиск */}
            {directParents.length === 0 && neuroSearchResults.length > 0 && ` (${neuroSearchResults.length})`}
          </span>
        </button>
      )}

      {/* Stale badge */}
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

      {/* СЕКЦИЯ ЦИТАТЫ - оранжевый цвет как у связи цитаты */}
      {data.quote && (
        <div
          className={cn(
            'quote-section mb-3 p-3 rounded-lg',
            'border-l-4',
            // Оранжевый фон и рамка для нормального состояния
            !data.isQuoteInvalidated && 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-500',
            // Красный для инвалидированной цитаты
            data.isQuoteInvalidated && 'border-red-500 bg-red-50/10 dark:bg-red-950/20'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Quote className="w-3.5 h-3.5" />
              <span>{t.node.quoteFromParent}</span>
            </div>

            {/* =====================================================================
                КНОПКА "ИЗМЕНИТЬ" (ручная корректировка цитаты пользователем)

                Зачем она нужна:
                - Ранее "обновление цитаты" было доступно пользователю в основном
                  через продуктовый сценарий инвалидации: когда родительская карточка
                  меняет ответ → цитата в дочерней становится invalid → показываем
                  красный блок с CTA "Выделить новую цитату".
                - Но пользователи также хотят менять цитату ПРОАКТИВНО, даже если
                  она ещё валидна (например, выбрали не тот фрагмент или хотят уточнить).

                Что делает клик:
                - Мы НЕ пытаемся "обновить" цитату прямо здесь, в дочерней карточке,
                  потому что выбор цитаты — это выделение текста в РОДИТЕЛЕ.
                - Поэтому мы переходим к карточке-источнику и активируем режим цитирования.

                Где реализована логика:
                - handleInitiateQuoteSelectionInParent() → useCanvasStore.initiateQuoteSelectionInParent()
                  Этот экшен:
                  1) выделяет родительскую ноду,
                  2) центрирует холст на ней,
                  3) разворачивает её ответ (чтобы был текст для выделения),
                  4) включает режим цитирования (isQuoteModeActive),
                  5) сохраняет quoteModeInitiatedByNodeId (ID этой дочерней карточки),
                     благодаря чему в тулбаре родителя появляется кнопка "Обновить".

                Почему НЕ показываем кнопку при invalidated:
                - В invalidated-сценарии уже есть яркий красный CTA "Выделить новую цитату".
                  Дублировать действия не нужно.

                Почему stopPropagation / nodrag:
                - .quote-section используется как "ручка" для перетаскивания карточки
                  (cursor: grab, user-select: none).
                - Нам нужно, чтобы клик по кнопке не инициировал drag ноды в ReactFlow.
               ===================================================================== */}
            {!data.isQuoteInvalidated && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleInitiateQuoteSelectionInParent}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  // Компактная кнопка в правом верхнем углу секции цитаты
                  'h-6 px-2 text-xs',
                  // Визуально делаем как заголовок секции цитаты (text-muted-foreground),
                  // чтобы кнопка смотрелась частью "шапки", а не отдельным CTA.
                  'text-muted-foreground',
                  'hover:text-foreground hover:bg-muted/40',
                  // Делаем расстояние между иконкой и текстом более плотным:
                  // у Button по умолчанию есть `gap-2`, нам здесь нужен компактнее.
                  'gap-1',
                  // Явно делаем её кликабельной внутри "grab" секции
                  'cursor-pointer',
                  // Запрещаем drag на кнопке (важно для ReactFlow)
                  'nodrag'
                )}
                // Тултип делаем "говорящим": это не просто "изменить текст",
                // а переход к источнику + активация режима выделения цитаты.
                title={t.node.selectTextForQuoteUpdate}
              >
                {/* Иконка слева — "карандаш" как привычная метафора редактирования */}
                <Pencil className="w-3 h-3" />
                {t.node.changeQuote}
              </Button>
            )}
          </div>

          <blockquote className={cn(
            'text-sm italic text-foreground/80',
            'pl-2 border-l-2 border-muted-foreground/30'
          )}>
            &ldquo;{data.quote}&rdquo;
          </blockquote>

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

      {/* Поле ввода вопроса */}
      <div className="flex items-end gap-2">
        {/* Кнопка NeuroSearch */}
        <NeuroSearchButton 
          isEnabled={isNeuroSearchEnabled || neuroSearchResults.length > 0} // Кнопка активна если есть результаты
          onToggle={handleToggleNeuroSearch}
          resultCount={activeResultsCount} // Передаем количество активных карточек
          isDeepThink={isNeuroSearching} // Используем пульсацию для индикации загрузки
          isStale={isNeuroSearchStale} // Передаем статус устаревания
          hasExcluded={hasExcludedResults} // Передаем наличие исключённых карточек
        />
        {isEditing ? (
          <TextareaAutosize
            ref={textareaRef}
            value={localPrompt}
            onChange={handlePromptChange}
            onBlur={handlePromptBlur}
            onKeyDown={onKeyDownWrapper}
            placeholder={hasParentContext ? t.node.promptPlaceholderWithContext : t.node.promptPlaceholder}
            minRows={1}
            autoFocus
            className={cn(
              'flex-1 min-w-0 resize-none overflow-hidden',
              'text-sm font-medium',
              'rounded-lg p-3',
              'bg-muted/30 border border-transparent',
              'focus:bg-muted/50 focus:border-primary/30',
              'focus:outline-none focus:ring-0',
              'placeholder:text-muted-foreground/50',
              'transition-all duration-200',
              'nodrag nopan',
              'neuro-textarea'
            )}
          />
        ) : (
          <div
            onDoubleClick={() => setIsEditing(true)}
            className={cn(
              'flex-1 min-w-0 min-h-[46px]',
              'text-sm font-medium',
              'rounded-lg p-3',
              'bg-muted/30 border border-transparent',
              'text-foreground',
              'cursor-grab active:cursor-grabbing',
              'whitespace-pre-wrap break-words',
              'overflow-hidden',
            )}
          >
            {localPrompt || (
              <span className="text-muted-foreground/50">
                {hasParentContext ? t.node.promptPlaceholderWithContext : t.node.promptPlaceholder}
              </span>
            )}
          </div>
        )}

        {/* Кнопка генерации / остановки */}
        <button
          onClick={isGenerating ? handleAbortGeneration : (hasContent ? handleRegenerate : handleGenerate)}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!localPrompt.trim() && !isGenerating}
          className={cn(
            'flex-shrink-0 mb-2',
            'w-8 h-8 rounded-md',
            'flex items-center justify-center',
            'transition-all duration-150',
            'shadow-sm hover:shadow-md',
            'nodrag',
            isGenerating ? [
              'bg-red-500 text-white',
              'hover:bg-red-600',
            ] : [
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ]
          )}
          title={isGenerating ? t.node.stopGeneration : (hasContent ? t.node.regenerateResponse : t.node.generateResponse)}
        >
          {isGenerating ? (
            <Square className="w-4 h-4 fill-current" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};

