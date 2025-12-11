/**
 * @file useNodeGeneration.ts
 * @description Хук для управления генерацией ответа (streaming, summary, embeddings)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useSettingsStore, selectApiKey, selectApiBaseUrl, selectModel, selectCorporateMode, selectUseSummarization, selectEmbeddingsBaseUrl } from '@/store/useSettingsStore';
import { streamChatCompletion, generateSummary } from '@/services/aiService';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode } from '@/types/canvas';

interface UseNodeGenerationProps {
  id: string;
  data: NeuroNode['data'];
  buildParentContext: () => string | undefined;
  localPrompt: string;
  setIsAnswerExpanded: (val: boolean) => void;
}

export const useNodeGeneration = ({
  id,
  data,
  buildParentContext,
  localPrompt,
  setIsAnswerExpanded
}: UseNodeGenerationProps) => {
  const { t } = useTranslation();
  
  // Zustand actions
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const saveContextHash = useCanvasStore((s) => s.saveContextHash);
  const onBatchNodeComplete = useCanvasStore((s) => s.onBatchNodeComplete);

  // Settings
  const apiKey = useSettingsStore(selectApiKey);
  const apiBaseUrl = useSettingsStore(selectApiBaseUrl);
  const model = useSettingsStore(selectModel);
  const corporateMode = useSettingsStore(selectCorporateMode);
  const useSummarization = useSettingsStore(selectUseSummarization);
  const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
  const embeddingsModel = useSettingsStore((s) => s.embeddingsModel);

  // Local state
  const [streamingText, setStreamingText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(Boolean(data.response));

  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Генерация summary (фоновая)
   */
  const handleGenerateSummary = useCallback(async (responseText: string) => {
    if (!responseText || responseText.length < 100) {
      updateNodeData(id, { summary: responseText });
      return;
    }

    updateNodeData(id, { isSummarizing: true });

    try {
      const summary = await generateSummary({
        text: responseText,
        apiKey: apiKey || '',
        apiBaseUrl,
        model,
        corporateMode
      });
      
      updateNodeData(id, {
        summary: summary || responseText.slice(0, 200) + '...',
        isSummarizing: false
      });
    } catch (err) {
      console.error('Summary generation error:', err);
      updateNodeData(id, {
        summary: responseText.slice(0, 200) + '...',
        isSummarizing: false
      });
    }
  }, [id, updateNodeData, apiKey, apiBaseUrl, model, corporateMode]);

  /**
   * Генерация эмбеддинга (фоновая)
   */
  const handleGenerateEmbedding = useCallback(async (responseText: string) => {
    if (!apiKey || !embeddingsBaseUrl || !embeddingsModel) return;

    try {
        const { generateAndSaveEmbedding } = await import('@/lib/search/semantic');
        const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
        const canvasId = useWorkspaceStore.getState().activeCanvasId;
        
        if (canvasId) {
             await generateAndSaveEmbedding(
                id,
                canvasId,
                localPrompt,
                responseText,
                apiKey,
                embeddingsBaseUrl,
                corporateMode,
                embeddingsModel
             );
             console.log('[useNodeGeneration] Эмбеддинг сохранён:', id);
        }
    } catch (err) {
        console.error('[useNodeGeneration] Ошибка эмбеддинга:', err);
    }
  }, [id, localPrompt, apiKey, embeddingsBaseUrl, embeddingsModel, corporateMode]);


  /**
   * Основной метод генерации
   */
  const handleGenerate = useCallback(async () => {
    if (!localPrompt.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setError(null);
    setStreamingText('');
    setIsGenerating(true);
    setIsAnswerExpanded(true); // Автораскрытие

    // Update store state
    updateNodeData(id, {
      prompt: localPrompt,
      isGenerating: true,
      mode: 'result',
      isAnswerExpanded: true // Sync with store immediately
    });

    try {
      if (!apiKey) throw new Error(t.node.apiKeyMissing);

      const parentContext = buildParentContext();
      
      const response = await streamChatCompletion({
        messages: [{ role: 'user', content: localPrompt }],
        context: parentContext,
        apiKey,
        apiBaseUrl,
        model,
        corporateMode,
        signal: abortControllerRef.current.signal
      });

      // Чтение стрима
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                if (jsonStr === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(jsonStr);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                        fullText += content;
                        setStreamingText(fullText);
                    }
                } catch { /* ignore */ }
            }
        }
      }

      // Final commit
      updateNodeData(id, {
        response: fullText,
        isGenerating: false,
        isStale: false,
      });

      saveContextHash(id);
      onBatchNodeComplete(id);
      setHasGeneratedOnce(true);

      // Background tasks
      handleGenerateEmbedding(fullText);
      if (useSummarization) {
        handleGenerateSummary(fullText);
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      updateNodeData(id, { isGenerating: false });
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [
    id, localPrompt, apiKey, t.node.apiKeyMissing, buildParentContext, 
    apiBaseUrl, model, corporateMode, updateNodeData, saveContextHash, 
    onBatchNodeComplete, handleGenerateEmbedding, useSummarization, 
    handleGenerateSummary, setIsAnswerExpanded
  ]);

  /**
   * Остановка генерации
   */
  const handleAbortGeneration = useCallback(() => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setIsGenerating(false);
    
    // Сохраняем частичный ответ
    if (streamingText.trim()) {
        updateNodeData(id, {
            response: streamingText,
            isGenerating: false,
            isStale: false
        });
        setHasGeneratedOnce(true);
    } else {
        updateNodeData(id, { isGenerating: false });
    }
  }, [id, streamingText, updateNodeData]);

  /**
   * Регенерация
   */
  const handleRegenerate = useCallback(() => {
    setStreamingText('');
    updateNodeData(id, { response: null, summary: null });
    handleGenerate();
  }, [id, updateNodeData, handleGenerate]);

  // Эффект для авто-регенерации (например, при обновлении цитаты)
  const pendingRegenerateHandledRef = useRef(false);
  useEffect(() => {
    if (data.pendingRegenerate && localPrompt.trim() && !pendingRegenerateHandledRef.current) {
        pendingRegenerateHandledRef.current = true;
        updateNodeData(id, { pendingRegenerate: false });
        handleRegenerate();
    }
    if (!data.pendingRegenerate) {
        pendingRegenerateHandledRef.current = false;
    }
  }, [data.pendingRegenerate, localPrompt, id, updateNodeData, handleRegenerate]);

  return {
    isGenerating,
    streamingText,
    error,
    hasGeneratedOnce,
    handleGenerate,
    handleRegenerate,
    handleAbortGeneration
  };
};

