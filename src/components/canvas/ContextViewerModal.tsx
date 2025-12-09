/**
 * @file ContextViewerModal.tsx
 * @description Модальное окно для просмотра полного контекста карточки
 * 
 * Функционал:
 * - Показывает иерархию контекста (родители → дедушки → прадедушки)
 * - Для каждого предка отображает: вопрос, тип контекста, содержимое
 * - Динамически склеивает контекст в момент открытия окна (не хранит)
 * - Отображает контент в формате Markdown
 * 
 * Типы контекста (определяются автоматически):
 * - full (полный) - для прямых родителей без цитаты
 * - quote (цитата) - если у карточки есть поле quote
 * - summary (суммаризация) - для дедушек и далее
 */

'use client';

import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Quote,
  FileSignature,
  ChevronRight,
  MessageSquare,
  Sparkles,
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSettingsStore, selectUseSummarization } from '@/store/useSettingsStore';
import { useTranslation, format } from '@/lib/i18n';
import type { NeuroNode, ContextType, ContextBlock } from '@/types/canvas';

// Re-export типов для обратной совместимости
export type { ContextType, ContextBlock } from '@/types/canvas';

/**
 * Props компонента ContextViewerModal
 */
interface ContextViewerModalProps {
  /** Флаг открытости модального окна */
  isOpen: boolean;
  /** Callback для закрытия окна */
  onClose: () => void;
  /** Массив прямых родительских нод */
  directParents: NeuroNode[];
  /** Полная цепочка предков (включая прямых родителей, дедушек и т.д.) */
  ancestorChain: NeuroNode[];
  /** Цитата текущей карточки (если есть) */
  quote: string | null;
  /** ID ноды-источника цитаты */
  quoteSourceNodeId: string | null;
}

/**
 * Расширенный тип блока контекста для UI
 */
interface UiContextBlock extends ContextBlock {
  quoteContent?: string;
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ И ФУНКЦИИ
// =============================================================================

/**
 * Иконка для типа контекста
 */
const ContextTypeIcon: React.FC<{ type: ContextType; className?: string }> = ({
  type,
  className,
}) => {
  switch (type) {
    case 'full':
      return <FileText className={cn('w-4 h-4', className)} />;
    case 'quote':
      return <Quote className={cn('w-4 h-4', className)} />;
    case 'summary':
      return <FileSignature className={cn('w-4 h-4', className)} />;
  }
};

/**
 * Цвет для типа контекста
 */
const getContextTypeColor = (type: ContextType): string => {
  switch (type) {
    case 'full':
      return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30';
    case 'quote':
      return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30';
    case 'summary':
      return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30';
  }
};

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * ContextViewerModal - модальное окно для просмотра контекста
 * 
 * Отображает иерархию контекста карточки:
 * - Прямые родители с полным response или цитатой
 * - Дедушки и далее с суммаризацией
 */
export const ContextViewerModal: React.FC<ContextViewerModalProps & {
  excludedContextNodeIds?: string[];
  onToggleContextItem?: (nodeId: string) => void;
}> = ({
  isOpen,
  onClose,
  directParents,
  ancestorChain,
  quote,
  quoteSourceNodeId,
  excludedContextNodeIds = [],
  onToggleContextItem,
}) => {
    // ===========================================================================
    // STATE
    // ===========================================================================

    // Состояние свернутых блоков
    const [collapsedBlockIds, setCollapsedBlockIds] = React.useState<Set<string>>(new Set());

    // Сброс состояния при открытии/закрытии
    React.useEffect(() => {
      if (!isOpen) {
        setCollapsedBlockIds(new Set());
      }
    }, [isOpen]);

    const toggleCollapse = (blockId: string) => {
      setCollapsedBlockIds(prev => {
        const next = new Set(prev);
        if (next.has(blockId)) {
          next.delete(blockId);
        } else {
          next.add(blockId);
        }
        return next;
      });
    };

    /**
     * Свернуть всё
     */
    const handleCollapseAll = () => {
      const allIds = new Set(contextBlocks.map(b => b.nodeId));
      setCollapsedBlockIds(allIds);
    };

    /**
     * Развернуть всё
     */
    const handleExpandAll = () => {
      setCollapsedBlockIds(new Set());
    };

    // ===========================================================================
    // ЛОКАЛИЗАЦИЯ
    // ===========================================================================

    const { t } = useTranslation();

    // ===========================================================================
    // НАСТРОЙКИ
    // ===========================================================================

    /**
     * Флаг суммаризации из глобальных настроек
     * Когда false - для всех предков показываем полный response
     */
    const useSummarization = useSettingsStore(selectUseSummarization);

    // ===========================================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ С ЛОКАЛИЗАЦИЕЙ
    // ===========================================================================

    /**
     * Получить название уровня предка по индексу
     * 
     * Используем компактный формат:
     * - Уровень 0: "Родитель" (или "Родитель N" если несколько)
     * - Уровень 1+: "Предок [1]", "Предок [2]", и т.д.
     * 
     * @param level - Индекс уровня (0 = родитель, 1 = дедушка, и т.д.)
     * @param parentIndex - Индекс родителя (для карточек с несколькими родителями)
     * @param totalParents - Общее количество прямых родителей
     * @returns Локализованное название уровня
     */
    const getLevelName = (
      level: number,
      parentIndex: number = 0,
      totalParents: number = 1
    ): string => {
      // Для прямых родителей (level 0)
      if (level === 0) {
        if (totalParents > 1) {
          return format(t.contextModal.parentN, { n: parentIndex + 1 });
        }
        return t.contextModal.parent;
      }

      // Для более дальних предков — компактный формат с номером поколения
      return format(t.contextModal.ancestor, { n: level });
    };

    /**
     * Название типа контекста
     */
    const getContextTypeName = (type: ContextType): string => {
      switch (type) {
        case 'full':
          return t.contextModal.fullResponse;
        case 'quote':
          return t.contextModal.quote;
        case 'summary':
          return t.contextModal.summary;
      }
    };

    // ===========================================================================
    // ПОСТРОЕНИЕ БЛОКОВ КОНТЕКСТА
    // ===========================================================================

    /**
     * Динамически строим массив блоков контекста
     * Выполняется в момент открытия окна (не хранится)
     */
    const contextBlocks = useMemo((): UiContextBlock[] => {
      const blocks: UiContextBlock[] = [];

      // =========================================================================
      // ЧАСТЬ 1: ПРЯМЫЕ РОДИТЕЛИ
      // =========================================================================

      directParents.forEach((parent, index) => {
        if (!parent) return;

        // Определяем тип контекста для этого родителя
        let type: ContextType = 'full';
        let content = parent.data.response || '';
        let quoteContent: string | undefined;

        // Если есть цитата и источник совпадает с этим родителем
        if (quote && quoteSourceNodeId === parent.id) {
          type = 'quote';
          // Сохраняем цитату отдельно для чистого отображения
          quoteContent = quote;

          // Определяем контент контекста (summary или full)
          if (useSummarization && parent.data.summary) {
            content = parent.data.summary;
          } else if (parent.data.response) {
            content = parent.data.response;
          } else {
            content = '';
          }
        }

        // Пропускаем если нет контента и нет цитаты
        if (!content && !quoteContent && !parent.data.prompt) return;

        blocks.push({
          nodeId: parent.id,
          prompt: parent.data.prompt || '',
          type,
          content,
          quoteContent,
          level: 0,
          levelName: getLevelName(0, index, directParents.length),
        });
      });

      // =========================================================================
      // ЧАСТЬ 2: ДЕДУШКИ И ДАЛЕЕ
      // Включает ВСЕХ предков (все родители каждого предка собраны через BFS)
      // 
      // ПРИОРИТЕТ КОНТЕНТА для каждого предка:
      // 1. Если кто-то из потомков (ближе к текущей ноде) ЦИТИРУЕТ этого предка
      //    → показываем эту цитату (она "просачивается" вниз по цепочке)
      // 2. Если у самого предка есть своя ЦИТАТА от его родителя
      //    → показываем её ЦЕЛИКОМ (тип 'quote')
      // 3. Если есть summary → используем summary (тип 'summary')
      // 4. Fallback: сокращённый response до 300 символов (тип 'summary')
      // =========================================================================

      // Фильтруем предков, исключая прямых родителей
      const grandparents = ancestorChain.filter(
        (node) => !directParents.some((p) => p.id === node.id)
      );

      /**
       * Вспомогательная функция: найти цитату на предка среди его потомков в цепочке
       * Если родитель или более близкий предок цитирует данного предка,
       * возвращаем эту цитату (она должна передаваться дальше по цепочке)
       */
      const findQuoteForAncestor = (ancestorId: string): string | null => {
        // Проверяем прямых родителей текущей карточки
        for (const parent of directParents) {
          if (parent.data.quoteSourceNodeId === ancestorId && parent.data.quote) {
            return parent.data.quote;
          }
        }

        // Проверяем всех предков (кроме самого искомого)
        // Ищем среди тех, кто "ближе" к текущей ноде
        for (const ancestor of ancestorChain) {
          if (ancestor.id === ancestorId) continue; // Пропускаем самого предка
          if (ancestor.data.quoteSourceNodeId === ancestorId && ancestor.data.quote) {
            return ancestor.data.quote;
          }
        }

        return null;
      };

      grandparents.forEach((ancestor, index) => {
        if (!ancestor) return;

        // Определяем тип и контент для предка
        // По умолчанию 'summary', но если суммаризация выключена - 'full'
        let type: ContextType = useSummarization ? 'summary' : 'full';
        let content = '';
        let quoteContent: string | undefined;

        // ПРИОРИТЕТ 1: Проверяем, цитирует ли кто-то из потомков этого предка
        // Если да - используем эту цитату (она должна "просачиваться" вниз по цепочке)
        const quoteFromDescendant = findQuoteForAncestor(ancestor.id);
        if (quoteFromDescendant) {
          type = 'quote';
          quoteContent = quoteFromDescendant;

          // Контекст предка
          if (useSummarization && ancestor.data.summary) {
            content = ancestor.data.summary;
          } else if (ancestor.data.response) {
            // Fallback - берем начало ответа или полный
            content = !useSummarization
              ? ancestor.data.response
              : (ancestor.data.response.slice(0, 500) + '...');
          }
        }
        // РЕЖИМ ПОЛНОГО КОНТЕКСТА: если суммаризация выключена - всегда полный response
        else if (!useSummarization && ancestor.data.response) {
          type = 'full';
          content = ancestor.data.response;
        }
        // ПРИОРИТЕТ 2: Если есть summary - используем его (суммаризация включена)
        else if (ancestor.data.summary) {
          type = 'summary';
          content = ancestor.data.summary;
        }
        // ПРИОРИТЕТ 3: Fallback на полный response (суммаризация включена, но summary нет)
        else if (ancestor.data.response) {
          // При включённой суммаризации всё равно показываем полный ответ,
          // потому что summary ещё не готов (fallback поведение)
          type = 'full';
          content = ancestor.data.response;
        }

        // Пропускаем если нет контента и нет цитаты
        if (!content && !quoteContent && !ancestor.data.prompt) return;

        blocks.push({
          nodeId: ancestor.id,
          prompt: ancestor.data.prompt || '',
          type,
          content,
          quoteContent,
          level: index + 1, // +1 потому что level 0 = прямые родители
          levelName: getLevelName(index + 1),
        });
      });

      return blocks;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [directParents, ancestorChain, quote, quoteSourceNodeId, useSummarization, t]);

    // ===========================================================================
    // РЕНДЕР
    // ===========================================================================

    // Вычисляем описание в зависимости от количества предков
    const descriptionText = contextBlocks.length > 0
      ? contextBlocks.length === 1
        ? format(t.contextModal.description, { count: contextBlocks.length })
        : format(t.contextModal.descriptionPlural, { count: contextBlocks.length })
      : t.contextModal.noContext;

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {/* Шапка диалога */}
          {/* Шапка диалога */}
          <DialogHeader className="flex-shrink-0 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  {t.contextModal.title}
                </DialogTitle>
                <DialogDescription>
                  {descriptionText}
                </DialogDescription>
              </div>

              {/* Кнопки управления */}
              {contextBlocks.length > 0 && (
                <div className="flex items-center gap-1 mr-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCollapseAll}
                    title="Collapse All"
                    className="h-8 w-8 p-0"
                  >
                    <Minimize2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExpandAll}
                    title="Expand All"
                    className="h-8 w-8 p-0"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Контент с блоками контекста */}
          <div className="flex-1 overflow-y-auto mt-4 space-y-4 pr-2">
            {contextBlocks.length === 0 ? (
              // Пустое состояние
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">{t.contextModal.rootCard}</p>
              </div>
            ) : (
              // Список блоков контекста
              contextBlocks.map((block, index) => {
                const isExcluded = excludedContextNodeIds.includes(block.nodeId);
                const isCollapsed = collapsedBlockIds.has(block.nodeId);

                return (
                  <div
                    key={block.nodeId}
                    className={cn(
                      'rounded-lg border transition-colors',
                      'p-4',
                      block.level > 0 && 'ml-4',
                      isExcluded
                        ? 'bg-muted/30 border-border/50 opacity-60 grayscale-[0.5]'
                        : 'bg-card/50 border-border'
                    )}
                  >
                    {/* Заголовок блока */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {/* Чекбокс исключения контекста */}
                        <button
                          onClick={() => onToggleContextItem?.(block.nodeId)}
                          className={cn(
                            "flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors",
                            isExcluded ? "text-muted-foreground" : "text-primary"
                          )}
                          title={isExcluded ? "Включить контекст" : "Исключить из контекста"}
                        >
                          {isExcluded ? (
                            // Иконка Square (пустой чекбокс) из lucide-react - симуляция uncheck
                            <div className="w-4 h-4 border-2 border-current rounded-sm" />
                          ) : (
                            // Checkbox с галочкой
                            <div className="w-4 h-4 bg-primary text-primary-foreground flex items-center justify-center rounded-sm">
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          )}
                        </button>

                        {/* Уровень и название */}
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {/* Индикатор иерархии */}
                          {index > 0 && (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className={isExcluded ? "text-muted-foreground line-through decoration-border" : "text-foreground"}>
                            {block.levelName}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Badge с типом контекста */}
                        <div
                          className={cn(
                            'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
                            isExcluded ? 'bg-muted text-muted-foreground' : getContextTypeColor(block.type)
                          )}
                        >
                          <ContextTypeIcon type={block.type} className="w-3.5 h-3.5" />
                          {getContextTypeName(block.type)}
                        </div>

                        {/* Кнопка сворачивания */}
                        <button
                          onClick={() => toggleCollapse(block.nodeId)}
                          className="p-1 hover:bg-muted/50 rounded transition-colors text-muted-foreground"
                        >
                          <ChevronRight className={cn("w-4 h-4 transition-transform", !isCollapsed && "rotate-90")} />
                        </button>
                      </div>
                    </div>

                    {/* Контейнер контента, скрываемый при сворачивании */}
                    {!isCollapsed && (
                      <>
                        {/* Вопрос (prompt) */}
                        {block.prompt && (
                          <div className="mb-3 p-2 rounded bg-muted/50">
                            <div className="text-xs text-muted-foreground mb-1 font-medium">
                              {t.contextModal.question}
                            </div>
                            <div className="text-sm">{block.prompt}</div>
                          </div>
                        )}

                        {/* Содержимое контекста */}
                        <div className="mt-2 text-sm">
                          {/* Если есть цитата - отображаем её Plain Text отдельным блоком */}
                          {block.quoteContent && (
                            <div className="mb-3">
                              <div className="text-xs text-orange-600 dark:text-orange-400 mb-1 font-medium">
                                {t.contextModal.quoteLabel}
                              </div>
                              <div className={cn(
                                "whitespace-pre-wrap font-sans text-foreground/90",
                                "pl-3 border-l-2 border-orange-500",
                                "bg-orange-50/50 dark:bg-orange-950/20",
                                "p-2 rounded-r-md"
                              )}>
                                {block.quoteContent}
                              </div>
                            </div>
                          )}

                          {/* Основной контент (Контекст) */}
                          {block.content && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 font-medium">
                                {block.type === 'quote'
                                  ? (block.level === 0 ? t.contextModal.response : t.contextModal.summary)
                                  : (block.type === 'summary' ? t.contextModal.summary : t.contextModal.response)}
                              </div>
                              <div
                                className={cn(
                                  'prose prose-sm dark:prose-invert max-w-none',
                                  'prose-p:my-1.5 prose-headings:my-2',
                                  // Ограничиваем высоту если блок не свернут, но очень большой
                                  'max-h-[500px] overflow-y-auto pr-2 custom-scrollbar'
                                )}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {block.content}
                                </ReactMarkdown>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Легенда типов контекста */}
          {contextBlocks.length > 0 && (
            <div className="flex-shrink-0 mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="font-medium">{t.contextModal.contextTypes}</span>
                <div className="flex items-center gap-1">
                  <ContextTypeIcon type="full" className="w-3 h-3" />
                  <span>{t.contextModal.full}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ContextTypeIcon type="quote" className="w-3 h-3" />
                  <span>{t.contextModal.quote}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ContextTypeIcon type="summary" className="w-3 h-3" />
                  <span>{t.contextModal.summary}</span>
                </div>
                <div className="flex items-center gap-1 ml-4 border-l pl-4">
                  <div className="w-3 h-3 border border-current rounded-sm opacity-50" />
                  <span>{t.contextModal.excluded || "Excluded from context"}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  };

export default ContextViewerModal;
