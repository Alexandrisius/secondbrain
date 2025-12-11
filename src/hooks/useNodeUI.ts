/**
 * @file useNodeUI.ts
 * @description Хук для управления UI состоянием ноды (Resize, Scroll, Quote, Copy)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useCanvasStore } from '@/store/useCanvasStore';
import type { NeuroNode } from '@/types/canvas';

interface UseNodeUIProps {
  id: string;
  data: NeuroNode['data'];
  answerScrollRef: React.RefObject<HTMLDivElement>;
  answerContentRef: React.RefObject<HTMLDivElement>;
  streamingText: string;
  // Lifted state
  isAnswerExpanded: boolean;
  setIsAnswerExpanded: (val: boolean) => void;
}

const MIN_CARD_WIDTH = 300;
const MAX_CARD_WIDTH = 800;
const DEFAULT_CARD_WIDTH = 400;

export const useNodeUI = ({
  id,
  data,
  answerScrollRef,
  answerContentRef,
  streamingText,
  isAnswerExpanded,
  setIsAnswerExpanded,
}: UseNodeUIProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const createQuoteNode = useCanvasStore((s) => s.createQuoteNode);
  const updateQuote = useCanvasStore((s) => s.updateQuote);
  const clearQuoteModeActive = useCanvasStore((s) => s.clearQuoteModeActive);
  const initiateQuoteSelectionInParent = useCanvasStore((s) => s.initiateQuoteSelectionInParent);
  const clearQuoteInvalidation = useCanvasStore((s) => s.clearQuoteInvalidation);

  // --- RESIZE STATE ---
  const [isResizing, setIsResizing] = useState(false);
  const [resizeWidth, setResizeWidth] = useState(data.width ?? DEFAULT_CARD_WIDTH);
  const resizeStartXRef = useRef<number>(0);
  const resizeStartWidthRef = useRef<number>(DEFAULT_CARD_WIDTH);

  // --- SCROLL STATE ---
  const [hasVerticalScroll, setHasVerticalScroll] = useState(false);
  
  // --- QUOTE STATE ---
  const [isQuoteMode, setIsQuoteMode] = useState(false);
  const [selectedQuoteText, setSelectedQuoteText] = useState('');

  // --- COPY STATE ---
  const [copied, setCopied] = useState(false);

  // ===========================================================================
  // EFFECTS
  // ===========================================================================

  // Sync width
  useEffect(() => {
    if (data.width !== undefined && data.width !== resizeWidth && !isResizing) {
      setResizeWidth(data.width);
    }
  }, [data.width, isResizing, resizeWidth]);

  // Sync expanded
  useEffect(() => {
    if (data.isAnswerExpanded !== undefined && data.isAnswerExpanded !== isAnswerExpanded) {
      setIsAnswerExpanded(data.isAnswerExpanded);
    }
  }, [data.isAnswerExpanded, isAnswerExpanded, setIsAnswerExpanded]);

  // Sync quote mode
  useEffect(() => {
    if (data.isQuoteModeActive !== undefined && data.isQuoteModeActive !== isQuoteMode) {
      setIsQuoteMode(data.isQuoteModeActive);
      if (data.isQuoteModeActive) {
        setSelectedQuoteText('');
      }
    }
  }, [data.isQuoteModeActive, isQuoteMode]);

  // Scroll observer
  useEffect(() => {
    const scrollContainer = answerScrollRef.current;
    if (!scrollContainer || !isAnswerExpanded) {
      setHasVerticalScroll(false);
      return;
    }

    const checkScroll = () => {
      const hasScroll = scrollContainer.scrollHeight > scrollContainer.clientHeight;
      setHasVerticalScroll(hasScroll);
    };

    checkScroll();

    const resizeObserver = new ResizeObserver(() => checkScroll());
    resizeObserver.observe(scrollContainer);
    if (scrollContainer.firstElementChild) {
      resizeObserver.observe(scrollContainer.firstElementChild);
    }

    return () => resizeObserver.disconnect();
  }, [isAnswerExpanded, data.response, streamingText, answerScrollRef]);

  // Resize handlers global
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const deltaX = e.clientX - resizeStartXRef.current;
      const rawWidth = resizeStartWidthRef.current + deltaX;
      const snappedWidth = Math.round(rawWidth / 10) * 10;
      const newWidth = Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, snappedWidth));
      setResizeWidth(newWidth);
    };

    const handleMouseUp = () => {
      updateNodeData(id, { width: resizeWidth });
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeWidth, id, updateNodeData]);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = resizeWidth;
    setIsResizing(true);
  }, [resizeWidth]);

  const handleToggleAnswer = useCallback(() => {
    const newValue = !isAnswerExpanded;
    setIsAnswerExpanded(newValue);
    updateNodeData(id, { isAnswerExpanded: newValue });
  }, [isAnswerExpanded, id, updateNodeData, setIsAnswerExpanded]);

  const handleAnswerWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const scrollContainer = answerScrollRef.current;
    if (!scrollContainer) return;
    if (!hasVerticalScroll) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    const isAtTop = scrollTop <= 0;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;
    const scrollingDown = e.deltaY > 0;
    const scrollingUp = e.deltaY < 0;

    if ((isAtTop && scrollingUp) || (isAtBottom && scrollingDown)) {
      return;
    }
    e.stopPropagation();
  }, [hasVerticalScroll, answerScrollRef]);

  const handleCopy = useCallback(async () => {
    const textToCopy = data.response || streamingText;
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [data.response, streamingText]);

  // Quote handlers
  const handleEnterQuoteMode = useCallback(() => {
    setIsQuoteMode(true);
    setSelectedQuoteText('');
  }, []);

  const handleExitQuoteMode = useCallback(() => {
    setIsQuoteMode(false);
    setSelectedQuoteText('');
    window.getSelection()?.removeAllRanges();
    if (data.isQuoteModeActive) {
      clearQuoteModeActive(id);
    }
  }, [id, data.isQuoteModeActive, clearQuoteModeActive]);

  const handleTextSelection = useCallback(() => {
    if (!isQuoteMode) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setSelectedQuoteText('');
      return;
    }
    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setSelectedQuoteText('');
      return;
    }
    // Check container
    const range = selection.getRangeAt(0);
    const container = answerContentRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;
    
    setSelectedQuoteText(selectedText);
  }, [isQuoteMode, answerContentRef]);

  const handleCreateQuoteCard = useCallback(() => {
    if (!selectedQuoteText || !data.response) return;

    if (data.quoteModeInitiatedByNodeId) {
      updateQuote(
        data.quoteModeInitiatedByNodeId,
        selectedQuoteText,
        id,
        data.response
      );
    } else {
      createQuoteNode(id, selectedQuoteText);
    }
    handleExitQuoteMode();
  }, [selectedQuoteText, data.response, data.quoteModeInitiatedByNodeId, id, updateQuote, createQuoteNode, handleExitQuoteMode]);

  const handleInitiateQuoteSelectionInParent = useCallback(() => {
    initiateQuoteSelectionInParent(id);
  }, [id, initiateQuoteSelectionInParent]);

  const handleClearQuoteInvalidation = useCallback(() => {
    clearQuoteInvalidation(id);
  }, [id, clearQuoteInvalidation]);

  return {
    isResizing,
    resizeWidth,
    hasVerticalScroll,
    isQuoteMode,
    selectedQuoteText,
    copied,
    handleResizeStart,
    handleToggleAnswer,
    handleAnswerWheel,
    handleCopy,
    handleEnterQuoteMode,
    handleExitQuoteMode,
    handleTextSelection,
    handleCreateQuoteCard,
    handleInitiateQuoteSelectionInParent,
    handleClearQuoteInvalidation,
  };
};
