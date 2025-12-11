import React from 'react';
import {
  Check,
  Copy,
  Quote,
  X,
  PlusCircle,
  BookOpen,
  ChevronUp,
  ChevronDown,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode } from '@/types/canvas';

interface AnswerToolbarProps {
  hasContent: boolean;
  isGenerating: boolean;
  copied: boolean;
  isQuoteMode: boolean;
  selectedQuoteText: string;
  data: NeuroNode['data'];
  isAnswerExpanded: boolean;
  isResizing: boolean;
  handleCopy: () => void;
  handleEnterQuoteMode: () => void;
  handleExitQuoteMode: () => void;
  handleCreateQuoteCard: () => void;
  handleOpenReadingMode: () => void;
  handleToggleAnswer: () => void;
  handleDelete: () => void;
  handleResizeStart: (e: React.MouseEvent) => void;
}

export const AnswerToolbar: React.FC<AnswerToolbarProps> = ({
  hasContent,
  isGenerating,
  copied,
  isQuoteMode,
  selectedQuoteText,
  data,
  isAnswerExpanded,
  isResizing,
  handleCopy,
  handleEnterQuoteMode,
  handleExitQuoteMode,
  handleCreateQuoteCard,
  handleOpenReadingMode,
  handleToggleAnswer,
  handleDelete,
  handleResizeStart,
}) => {
  const { t } = useTranslation();

  return (
    <div className="neuro-answer-toolbar flex items-center justify-between px-2 py-1 border-t border-border bg-muted/30">
      {/* Левая часть: кнопки копирования и цитирования */}
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

        {/* Кнопка режима чтения */}
        {hasContent && !isGenerating && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenReadingMode}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-8 w-8 p-0 nodrag text-muted-foreground hover:text-primary"
            title={t.readingMode?.openReadingMode || 'Режим чтения (F2)'}
          >
            <BookOpen className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Центральная часть: кнопка раскрытия/скрытия ответа */}
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

        <div
          onMouseDown={handleResizeStart}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            'neuro-resize-handle',
            'h-8 w-4 -mr-2',
            'flex items-center justify-center',
            'cursor-ew-resize',
            'text-muted-foreground/50',
            'hover:text-muted-foreground hover:bg-muted/50',
            isResizing && 'text-primary bg-primary/10',
            'rounded-r-lg',
            'transition-colors duration-150',
            'nodrag'
          )}
          title={t.node.resizeCard}
        >
          <GripVertical className="w-3 h-4" />
        </div>
      </div>
    </div>
  );
};

