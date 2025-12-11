/**
 * @file NeuroNode.tsx
 * @description Кастомный компонент ноды для React Flow.
 * 
 * РЕФАКТОРИНГ:
 * Логика вынесена в хуки:
 * - useNodeContext: построение контекста предков
 * - useNodeGeneration: логика AI генерации (streaming, summary)
 * - useNodeUI: UI стейт (resize, scroll, quote)
 * - useNodeInput: ввод текста и хоткеи
 * 
 * Компоненты UI вынесены в:
 * - QuestionSection
 * - AnswerToolbar
 * - AnswerSection
 */

'use client';

import React, { memo, useState, useRef, useMemo } from 'react';
import { type NodeProps } from '@xyflow/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useCanvasStore } from '@/store/useCanvasStore';
import { useReadingModeStore } from '@/store/useReadingModeStore';
import { cn } from '@/lib/utils';
import type { NeuroNode as NeuroNodeType } from '@/types/canvas';

import { ContextViewerModal } from './ContextViewerModal';
import { QuestionSection } from './neuro-node/QuestionSection';
import { AnswerToolbar } from './neuro-node/AnswerToolbar';
import { AnswerSection } from './neuro-node/AnswerSection';

import { useNodeContext } from '@/hooks/useNodeContext';
import { useNodeGeneration } from '@/hooks/useNodeGeneration';
import { useNodeUI } from '@/hooks/useNodeUI';
import { useNodeInput } from '@/hooks/useNodeInput';

type NeuroNodeProps = NodeProps<NeuroNodeType>;

const NeuroNodeComponent = ({ id, data, selected }: NeuroNodeProps) => {
  // --- STORE ACTIONS ---
  const removeNode = useCanvasStore((s) => s.removeNode);
  const checkAndClearStale = useCanvasStore((s) => s.checkAndClearStale);
  const openReadingMode = useReadingModeStore((s) => s.openReadingMode);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);

  // --- REFS ---
  const questionSectionRef = useRef<HTMLDivElement>(null);
  const answerScrollRef = useRef<HTMLDivElement>(null);
  const answerContentRef = useRef<HTMLDivElement>(null);

  // --- LOCAL UI STATE (LIFTED) ---
  const [localPrompt, setLocalPrompt] = useState(data.prompt);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(data.isAnswerExpanded ?? false);
  const [isEditing, setIsEditing] = useState(!data.response);
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);

  // --- HOOKS ---
  
  // 1. Context Logic
  const { 
    directParents, 
    ancestorChain, 
    buildParentContext, 
  } = useNodeContext({ nodeId: id, data });

  // 2. Generation Logic
  const generation = useNodeGeneration({
    id,
    data,
    buildParentContext,
    localPrompt,
    setIsAnswerExpanded,
  });

  // 3. UI Logic
  const ui = useNodeUI({
    id,
    data,
    answerScrollRef,
    answerContentRef,
    streamingText: generation.streamingText,
    isAnswerExpanded,
    setIsAnswerExpanded,
  });

  // 4. Input Logic
  const input = useNodeInput({
    id,
    data,
    isGenerating: generation.isGenerating,
    setIsAnswerExpanded,
    handleGenerate: generation.handleGenerate,
    handleCheckAndClearStale: checkAndClearStale,
                localPrompt,
    setLocalPrompt,
    isEditing,
    setIsEditing,
  });

  // Handlers
  const handleDelete = () => {
    if (generation.isGenerating) generation.handleAbortGeneration();
    removeNode(id);
  };

  const handleOpenReadingMode = () => openReadingMode(id);

  // Memoized Markdown
  const displayText = generation.isGenerating ? generation.streamingText : data.response;
  const hasContent = Boolean(displayText);
  const memoizedMarkdown = useMemo(() => (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {displayText || ''}
    </ReactMarkdown>
  ), [displayText]);

  return (
    <div
      className={cn(
        'neuro-node-wrapper relative',
        ui.isResizing && 'neuro-node-wrapper--resizing'
      )}
      style={{ width: ui.resizeWidth }}
    >
      <div
        className={cn(
          'neuro-node',
          'bg-card rounded-xl border border-border',
          'shadow-lg backdrop-blur-sm',
          'transition-all duration-300 ease-out',
          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
          data.isStale && !data.isQuoteInvalidated && 'neuro-node--stale',
          data.isQuoteInvalidated && 'neuro-node--quote-invalid'
        )}
      >
        {/* --- QUESTION SECTION --- */}
        <QuestionSection
          id={id}
          data={data}
          isEditing={isEditing}
          localPrompt={localPrompt}
          hasParentContext={Boolean(directParents.length > 0 || ancestorChain.some(n => n.data.summary))}
          directParents={directParents}
          isGenerating={generation.isGenerating}
          hasContent={hasContent}
          setIsEditing={setIsEditing}
          handlePromptChange={input.handlePromptChange}
          handlePromptBlur={input.handlePromptBlur}
          handleKeyDown={input.handleKeyDown}
          handleGenerate={generation.handleGenerate}
          handleRegenerate={generation.handleRegenerate}
          handleAbortGeneration={generation.handleAbortGeneration}
          handleInitiateQuoteSelectionInParent={ui.handleInitiateQuoteSelectionInParent}
          setIsContextModalOpen={setIsContextModalOpen}
          textareaRef={input.textareaRef}
          questionSectionRef={questionSectionRef}
        />

        {/* --- ANSWER SECTION WRAPPER --- */}
        {(hasContent || generation.isGenerating || generation.error) && (
          <div className="relative">
            {/* --- TOOLBAR --- */}
            <AnswerToolbar
              hasContent={hasContent}
              isGenerating={generation.isGenerating}
              copied={ui.copied}
              isQuoteMode={ui.isQuoteMode}
              selectedQuoteText={ui.selectedQuoteText}
              data={data}
              isAnswerExpanded={isAnswerExpanded}
              isResizing={ui.isResizing}
              handleCopy={ui.handleCopy}
              handleEnterQuoteMode={ui.handleEnterQuoteMode}
              handleExitQuoteMode={ui.handleExitQuoteMode}
              handleCreateQuoteCard={ui.handleCreateQuoteCard}
              handleOpenReadingMode={handleOpenReadingMode}
              handleToggleAnswer={ui.handleToggleAnswer}
              handleDelete={handleDelete}
              handleResizeStart={ui.handleResizeStart}
            />

            {/* --- ANSWER CONTENT --- */}
            <AnswerSection
              isAnswerExpanded={isAnswerExpanded}
              isGenerating={generation.isGenerating}
              hasContent={hasContent}
              error={generation.error}
              isQuoteMode={ui.isQuoteMode}
              memoizedMarkdown={memoizedMarkdown}
              data={data}
              handleAnswerWheel={ui.handleAnswerWheel}
              handleTextSelection={ui.handleTextSelection}
              answerScrollRef={answerScrollRef}
              answerContentRef={answerContentRef}
              hasVerticalScroll={ui.hasVerticalScroll}
            />
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
        onToggleContextItem={(targetId) => {
            const currentExcluded = data.excludedContextNodeIds || [];
            let newExcluded;
            if (currentExcluded.includes(targetId)) {
                newExcluded = currentExcluded.filter(id => id !== targetId);
            } else {
                newExcluded = [...currentExcluded, targetId];
            }
            if (data.response) {
                updateNodeData(id, { 
                    excludedContextNodeIds: newExcluded,
                    isStale: true,
                    updatedAt: Date.now()
                });
                setTimeout(() => checkAndClearStale(id), 0);
            } else {
                updateNodeData(id, { excludedContextNodeIds: newExcluded });
            }
        }}
      />

      {ui.isResizing && (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-primary text-primary-foreground text-xs font-mono font-medium shadow-lg animate-in fade-in zoom-in-95 duration-150">
          {Math.round(ui.resizeWidth)}px
        </div>
      )}
    </div>
  );
};

export const NeuroNode = memo(NeuroNodeComponent);
