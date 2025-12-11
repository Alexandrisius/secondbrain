/**
 * @file useNodeInput.ts
 * @description Хук для управления вводом текста и обработкой клавиш
 */

import { useRef, useCallback, useEffect } from 'react';
import { useCanvasStore } from '@/store/useCanvasStore';
import type { NeuroNode } from '@/types/canvas';

interface UseNodeInputProps {
  id: string;
  data: NeuroNode['data'];
  isGenerating: boolean;
  setIsAnswerExpanded: (val: boolean) => void;
  handleGenerate: () => void;
  handleCheckAndClearStale: (id: string) => void;
  // Lifted state
  localPrompt: string;
  setLocalPrompt: (val: string) => void;
  isEditing: boolean;
  setIsEditing: (val: boolean) => void;
}

export const useNodeInput = ({
  id,
  data,
  isGenerating,
  setIsAnswerExpanded,
  handleGenerate,
  handleCheckAndClearStale,
  localPrompt,
  setLocalPrompt,
  setIsEditing,
}: UseNodeInputProps) => {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const markChildrenStale = useCanvasStore((s) => s.markChildrenStale);
  const createLinkedNodeRight = useCanvasStore((s) => s.createLinkedNodeRight);
  const createSiblingNode = useCanvasStore((s) => s.createSiblingNode);
  
  const pendingFocusNodeId = useCanvasStore((s) => s.pendingFocusNodeId);
  const clearPendingFocus = useCanvasStore((s) => s.clearPendingFocus);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync prompt from store
  useEffect(() => {
    setLocalPrompt(data.prompt);
  }, [data.prompt, setLocalPrompt]);

  // Autofocus new nodes
  useEffect(() => {
    if (!data.response && textareaRef.current) {
      setIsEditing(true);
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [data.response, setIsEditing]);

  // Pending focus from other actions
  useEffect(() => {
    if (pendingFocusNodeId === id) {
      setIsEditing(true);
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        clearPendingFocus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pendingFocusNodeId, id, clearPendingFocus, setIsEditing]);

  const handlePromptChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalPrompt(newValue);
    if (data.response) {
      markChildrenStale(id);
    }
  }, [data.response, id, markChildrenStale, setLocalPrompt]);

  const handlePromptBlur = useCallback(() => {
    setIsEditing(false);
    if (localPrompt !== data.prompt) {
      updateNodeData(id, { prompt: localPrompt });
    } else {
      if (data.response) {
        handleCheckAndClearStale(id);
      }
    }
  }, [id, localPrompt, data.prompt, data.response, updateNodeData, handleCheckAndClearStale, setIsEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      textareaRef.current?.blur();
      return;
    }

    e.stopPropagation();

    // Tab - Create child
    if (e.key === 'Tab' && !e.shiftKey) {
      if (data.response && !isGenerating) {
        e.preventDefault();
        createLinkedNodeRight(id);
        return;
      }
      e.preventDefault();
      return;
    }

    // Ctrl+Enter - Create sibling
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      if (data.response && !isGenerating && data.parentId) {
        e.preventDefault();
        
        // Сворачиваем текущую карточку
        setIsAnswerExpanded(false);
        // ВАЖНО: Обновляем store, чтобы состояние сохранилось
        // Без этого карточка может остаться развернутой при ре-рендере
        updateNodeData(id, { isAnswerExpanded: false });
        
        createSiblingNode(id);
        return;
      }
      e.preventDefault();
      return;
    }

    // Enter - Submit
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleGenerate();
      return;
    }
  }, [data.response, data.parentId, isGenerating, id, createLinkedNodeRight, createSiblingNode, handleGenerate, setIsAnswerExpanded]);

  return {
    textareaRef,
    handlePromptChange,
    handlePromptBlur,
    handleKeyDown,
  };
};
