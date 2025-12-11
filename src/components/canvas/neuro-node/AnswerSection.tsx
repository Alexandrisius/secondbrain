import React from 'react';
import {
  Loader2,
  AlertCircle,
  Quote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode } from '@/types/canvas';

interface AnswerSectionProps {
  isAnswerExpanded: boolean;
  isGenerating: boolean;
  hasContent: boolean;
  error: string | null;
  isQuoteMode: boolean;
  memoizedMarkdown: React.ReactNode;
  data: NeuroNode['data'];
  handleAnswerWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  handleTextSelection: () => void;
  answerScrollRef: React.RefObject<HTMLDivElement>;
  answerContentRef: React.RefObject<HTMLDivElement>;
  hasVerticalScroll: boolean;
}

export const AnswerSection: React.FC<AnswerSectionProps> = ({
  isAnswerExpanded,
  isGenerating,
  hasContent,
  error,
  isQuoteMode,
  memoizedMarkdown,
  data,
  handleAnswerWheel,
  handleTextSelection,
  answerScrollRef,
  answerContentRef,
  hasVerticalScroll,
}) => {
  const { t } = useTranslation();

  // Фиксированная высота ответной части
  const ANSWER_SECTION_HEIGHT = 400;

  return (
    <div
      className={cn(
        'neuro-answer-section',
        'overflow-hidden transition-all duration-300 ease-out',
        isAnswerExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
      )}
    >
      <div
        ref={answerScrollRef}
        onWheel={handleAnswerWheel}
        className={cn(
          'p-4 overflow-y-auto',
          // Динамически добавляем nowheel только при наличии скролла
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

        {/* Markdown content */}
        {hasContent && (
          <div
            ref={answerContentRef}
            onMouseUp={handleTextSelection}
            className={cn(
              'relative',
              isQuoteMode && 'quote-mode-active',
              // React Flow: nodrag и nopan ТОЛЬКО в режиме цитирования
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

            {/* Markdown контент */}
            <div className={cn(
              'prose prose-sm dark:prose-invert max-w-none',
              'prose-headings:mt-4 prose-headings:mb-2',
              'prose-p:my-2 prose-p:leading-relaxed',
              'prose-ul:my-2 prose-ol:my-2',
              'prose-li:my-0.5',
              'prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded',
              'prose-pre:bg-muted prose-pre:p-3',
              isGenerating && 'streaming-cursor',
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
  );
};

