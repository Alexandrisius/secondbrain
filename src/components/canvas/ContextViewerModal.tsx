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
} from 'lucide-react';
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
      return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30';
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
export const ContextViewerModal: React.FC<ContextViewerModalProps> = ({
  isOpen,
  onClose,
  directParents,
  ancestorChain,
  quote,
  quoteSourceNodeId,
}) => {
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
  const contextBlocks = useMemo((): ContextBlock[] => {
    const blocks: ContextBlock[] = [];
    
    // =========================================================================
    // ЧАСТЬ 1: ПРЯМЫЕ РОДИТЕЛИ
    // =========================================================================
    
    directParents.forEach((parent, index) => {
      if (!parent) return;
      
      // Определяем тип контекста для этого родителя
      let type: ContextType = 'full';
      let content = parent.data.response || '';
      
      // Если есть цитата и источник совпадает с этим родителем
      if (quote && quoteSourceNodeId === parent.id) {
        type = 'quote';
        content = quote;
      }
      
      // Пропускаем если нет контента
      if (!content && !parent.data.prompt) return;
      
      blocks.push({
        nodeId: parent.id,
        prompt: parent.data.prompt || '',
        type,
        content,
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
      
      // ПРИОРИТЕТ 1: Проверяем, цитирует ли кто-то из потомков этого предка
      // Если да - используем эту цитату (она должна "просачиваться" вниз по цепочке)
      const quoteFromDescendant = findQuoteForAncestor(ancestor.id);
      if (quoteFromDescendant) {
        type = 'quote';
        content = quoteFromDescendant;
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
      // ВАЖНО: ancestor.data.quote — это цитата которую предок ПОЛУЧИЛ от своего родителя,
      // а НЕ его ответ! Потомкам нужно показывать response предка.
      else if (ancestor.data.response) {
        // При включённой суммаризации всё равно показываем полный ответ,
        // потому что summary ещё не готов (fallback поведение)
        type = 'full';
        content = ancestor.data.response;
      }
      
      // Пропускаем если нет контента
      if (!content && !ancestor.data.prompt) return;
      
      blocks.push({
        nodeId: ancestor.id,
        prompt: ancestor.data.prompt || '',
        type,
        content,
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
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {t.contextModal.title}
          </DialogTitle>
          <DialogDescription>
            {descriptionText}
          </DialogDescription>
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
            contextBlocks.map((block, index) => (
              <div
                key={block.nodeId}
                className={cn(
                  'rounded-lg border border-border p-4',
                  'bg-card/50',
                  // Небольшой отступ слева для визуализации иерархии
                  block.level > 0 && 'ml-4'
                )}
              >
                {/* Заголовок блока */}
                <div className="flex items-center justify-between mb-3">
                  {/* Уровень и название */}
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {/* Индикатор иерархии */}
                    {index > 0 && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-foreground">{block.levelName}</span>
                  </div>
                  
                  {/* Badge с типом контекста */}
                  <div
                    className={cn(
                      'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
                      getContextTypeColor(block.type)
                    )}
                  >
                    <ContextTypeIcon type={block.type} className="w-3.5 h-3.5" />
                    {getContextTypeName(block.type)}
                  </div>
                </div>
                
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
                {block.content && (
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground mb-1 font-medium">
                      {block.type === 'quote' ? t.contextModal.quoteLabel : t.contextModal.response}
                    </div>
                    
                    {block.type === 'quote' ? (
                      // Цитата отображается особым образом
                      <blockquote className="pl-3 border-l-2 border-primary italic text-sm text-foreground/80">
                        &ldquo;{block.content}&rdquo;
                      </blockquote>
                    ) : (
                      // Полный ответ или summary в Markdown
                      <div
                        className={cn(
                          'prose prose-sm dark:prose-invert max-w-none',
                          'prose-p:my-1.5 prose-headings:my-2',
                          // Ограничиваем высоту только для summary (не для full)
                          block.type === 'summary' && 'max-h-32 overflow-hidden relative',
                          block.type === 'summary' &&
                            'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-8 after:bg-gradient-to-t after:from-card/50 after:to-transparent',
                          // Для полного ответа ограничиваем высоту, но больше чем для summary
                          block.type === 'full' && block.level > 0 && 'max-h-64 overflow-y-auto'
                        )}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {block.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
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
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ContextViewerModal;
