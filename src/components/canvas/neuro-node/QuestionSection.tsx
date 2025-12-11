import React from 'react';
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
      {hasParentContext && (
        <button
          onClick={() => setIsContextModalOpen(true)}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'flex items-center gap-1 text-xs mb-2',
            // Оранжевый цвет если есть исключённые блоки ИЛИ карточка stale
            (data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0) || data.isStale
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
            // Оранжевый индикатор если есть исключённые блоки ИЛИ карточка stale
            (data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0) || data.isStale
              ? "bg-orange-500"
              : "bg-blue-500"
          )} />
          <span className={cn(
            "underline underline-offset-2",
            // Оранжевое подчёркивание если есть исключённые блоки ИЛИ карточка stale
            (data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0) || data.isStale
              ? "decoration-orange-400/50"
              : "decoration-blue-400/50"
          )}>
            {directParents.length > 1
              ? format(t.node.multipleParentContextUsed, { count: directParents.length })
              : t.node.parentContextUsed
            }
            {/* Звёздочка если есть исключённые блоки контекста */}
            {data.excludedContextNodeIds && data.excludedContextNodeIds.length > 0 && " *"}
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

