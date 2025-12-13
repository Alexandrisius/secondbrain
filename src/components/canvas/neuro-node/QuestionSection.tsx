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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation, format } from '@/lib/i18n';
import type { NeuroNode } from '@/types/canvas';
import { NeuroSearchButton } from './NeuroSearchButton';
import { useNeuroSearchStore } from '@/store/useNeuroSearchStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import { searchSimilar } from '@/lib/search/semantic';
import { useSettingsStore, selectApiKey, selectEmbeddingsBaseUrl, selectCorporateMode, selectEmbeddingsModel } from '@/store/useSettingsStore';

// Пустой массив для предотвращения лишних ререндеров
const EMPTY_ARRAY: any[] = [];
// Пустой объект для снимка
const EMPTY_SNAPSHOT: Record<string, number> = {};

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
  
  // Canvas Store - для доступа к nodes и обновления data
  const nodes = useCanvasStore(state => state.nodes);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);
  const markChildrenStale = useCanvasStore(state => state.markChildrenStale);
  
  // NeuroSearch Store
  const setNeuroSearchResults = useNeuroSearchStore(state => state.setResults);
  const clearNeuroSearchResults = useNeuroSearchStore(state => state.clearResults);
  const setIsNeuroSearching = useNeuroSearchStore(state => state.setIsSearching);
  const neuroSearchResults = useNeuroSearchStore(state => state.results[id] || EMPTY_ARRAY);
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
      const results = await searchSimilar(
        {
          query: localPrompt,
          canvasId: null, // Глобальный поиск
          limit: 10, // Запрашиваем больше, чтобы можно было отфильтровать
          minSimilarity: 0.5, // Порог схожести
        },
        apiKey,
        embeddingsBaseUrl,
        corporateMode,
        embeddingsModel // Передаем модель
      );
      
      // Фильтрация результатов:
      // 1. Исключаем саму себя (id)
      // 2. Исключаем уже существующие родительские связи (directParents)
      const filteredResults = results.filter(result => {
        // Исключаем саму себя
        if (result.nodeId === id) return false;
        
        // Исключаем прямых родителей
        const isParent = directParents.some(parent => parent.id === result.nodeId);
        if (isParent) return false;
        
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
      const neuroSearchNodeIds = finalResults.map(r => r.nodeId);
      updateNodeData(id, { 
        neuroSearchNodeIds,
        updatedAt: Date.now(),
        // Если у карточки уже есть ответ, то изменение контекста (новые результаты поиска) делает его устаревшим
        ...(data.response ? { isStale: true } : {})
      });
      
      // === ПОМЕЧАЕМ ПОТОМКОВ КАК STALE ===
      // Если у карточки уже есть ответ - её потомки должны знать,
      // что контекст изменился (добавлен нейропоиск)
      if (data.response) {
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
    directParents, 
    nodes,
    data.response,
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
    const excludedIds = data.excludedContextNodeIds || EMPTY_ARRAY;
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

