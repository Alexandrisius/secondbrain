import React from 'react';
import {
  Loader2,
  AlertCircle,
  Quote,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode } from '@/types/canvas';
import {
  useSettingsStore,
  selectDefaultCardContentHeight,
} from '@/store/useSettingsStore';

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

  /**
   * Высота “контентной” части карточки (px), настраивается пользователем в Settings.
   *
   * ВАЖНО:
   * - Это именно MAX HEIGHT раскрытого ответа.
   * - Контент внутри скроллится (overflow-y-auto).
   * - Значение хранится в глобальных настройках, чтобы применяться консистентно
   *   и к AI-карточкам, и к NoteNode.
   */
  const defaultCardContentHeight = useSettingsStore(selectDefaultCardContentHeight);

  return (
    <div
      className={cn(
        'neuro-answer-section',
        'overflow-hidden transition-all duration-300 ease-out',
        // maxHeight делаем через inline-style (динамическое значение в px),
        // а opacity оставляем в className, чтобы:
        // - анимация раскрытия/сворачивания работала плавно,
        // - мы не были привязаны к захардкоженному tailwind-классу max-h-[400px].
        isAnswerExpanded ? 'opacity-100' : 'opacity-0'
      )}
      style={{
        // Когда ответ скрыт — maxHeight: 0, чтобы контейнер “схлопывался”.
        // Когда раскрыт — maxHeight: defaultCardContentHeight (px).
        maxHeight: isAnswerExpanded ? defaultCardContentHeight : 0,
      }}
    >
      <div
        ref={answerScrollRef}
        onWheel={handleAnswerWheel}
        className={cn(
          'p-4 overflow-y-auto',
          // Динамически добавляем nowheel только при наличии скролла
          hasVerticalScroll && 'nowheel'
        )}
        style={{
          // Дублируем maxHeight на скролл-контейнере, чтобы:
          // - скролл работал внутри фиксированной области,
          // - размер области был предсказуем и соответствовал настройке.
          maxHeight: defaultCardContentHeight,
        }}
      >
        {/* Loading state */}
        {isGenerating && !hasContent && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* =====================================================================
            NOTICE / "SOFT ERROR" state

            Требование UX (по задаче):
            - пользователь НЕ должен видеть "ошибки" (красные алерты / технические простыни),
              потому что в Demo Mode и в целом при работе с LLM ошибки могут быть частыми/шумными.

            Поэтому:
            - мы используем нейтрально‑предупреждающий amber стиль (не destructive),
            - и ожидаем, что верхний слой (useNodeGeneration / сервер) передаст сюда
              КОРОТКОЕ и ЧЕЛОВЕЧЕСКОЕ сообщение, а не raw JSON/stacktrace.
           ===================================================================== */}
        {error && (
          <div
            className={cn(
              'flex items-center gap-2 p-3 rounded-lg border text-sm',
              // Нейтральный “внимание”, а не “ошибка”.
              'bg-amber-50 text-amber-900 border-amber-200',
              'dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800/50'
            )}
          >
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

