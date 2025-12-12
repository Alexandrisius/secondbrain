/**
 * @file NoteNode.tsx
 * @description Component for Personal Note cards.
 *
 * Features:
 * - User-editable title and content.
 * - content stored in `data.response` for compatibility with context system.
 * - Auto-summarization in background.
 * - Quoting support (source for quotes).
 * - Distinguishable visual style.
 */

'use client';

import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import TextareaAutosize from 'react-textarea-autosize';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
    Copy,
    Trash2,
    Check,
    Quote,
    PlusCircle,
    X,
    GripVertical,
    BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useReadingModeStore } from '@/store/useReadingModeStore';
import {
    useSettingsStore,
    selectApiKey,
    selectApiBaseUrl,
    selectModel,
    selectUseSummarization,
    selectCorporateMode,
    selectEmbeddingsBaseUrl,
    selectEmbeddingsModel,
} from '@/store/useSettingsStore';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode as NeuroNodeType } from '@/types/canvas';
import { cn } from '@/lib/utils';
import { useDebounce } from 'use-debounce';

type NoteNodeProps = NodeProps<NeuroNodeType>;

const MIN_CARD_WIDTH = 300;
const MAX_CARD_WIDTH = 1200;
const DEFAULT_CARD_WIDTH = 400;

const NoteNodeComponent = ({ id, data, selected }: NoteNodeProps) => {
    const { t } = useTranslation();

    // ===========================================================================
    // STORE ACTIONS
    // ===========================================================================
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);
    const removeNode = useCanvasStore((s) => s.removeNode);
    // Reusing quote actions
    const createQuoteNode = useCanvasStore((s) => s.createQuoteNode);
    const updateQuote = useCanvasStore((s) => s.updateQuote);
    const clearQuoteModeActive = useCanvasStore((s) => s.clearQuoteModeActive);
    const pendingFocusNodeId = useCanvasStore((s) => s.pendingFocusNodeId);
    const clearPendingFocus = useCanvasStore((s) => s.clearPendingFocus);

    // Action для открытия режима чтения
    const openReadingMode = useReadingModeStore((s) => s.openReadingMode);

    // Settings for auto-summary and embeddings
    const apiKey = useSettingsStore(selectApiKey);
    const apiBaseUrl = useSettingsStore(selectApiBaseUrl);
    const model = useSettingsStore(selectModel);
    const useSummarization = useSettingsStore(selectUseSummarization);
    const corporateMode = useSettingsStore(selectCorporateMode);
    const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
    const embeddingsModel = useSettingsStore(selectEmbeddingsModel);

    // ===========================================================================
    // LOCAL STATE
    // ===========================================================================

    // Title (stored in prompt)
    const [localTitle, setLocalTitle] = useState(data.prompt || '');
    // Content (stored in response)
    const [localContent, setLocalContent] = useState(data.response || '');

    // Debounced values for auto-saving and auto-summarizing
    const [debouncedTitle] = useDebounce(localTitle, 1000);
    const [debouncedContent] = useDebounce(localContent, 2000);

    const [copied, setCopied] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [resizeWidth, setResizeWidth] = useState(data.width ?? DEFAULT_CARD_WIDTH);

    // Quote mode state
    const [isQuoteMode, setIsQuoteMode] = useState(false);
    const [selectedQuoteText, setSelectedQuoteText] = useState('');

    // Edit mode state (double-click to edit)
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [isEditingContent, setIsEditingContent] = useState(false);

    // Refs
    const titleRef = useRef<HTMLTextAreaElement>(null);
    const contentRef = useRef<HTMLTextAreaElement>(null);
    const contentDisplayRef = useRef<HTMLDivElement>(null);
    const contentScrollRef = useRef<HTMLDivElement>(null);
    const resizeStartXRef = useRef<number>(0);
    const resizeStartWidthRef = useRef<number>(DEFAULT_CARD_WIDTH);
    
    // Ref для отслеживания последнего суммаризированного контента
    // Предотвращает бесконечный цикл суммаризации
    const lastSummarizedContentRef = useRef<string>(data.response || '');
    
    // Ref для отслеживания проиндексированного контента
    const lastIndexedDataRef = useRef<{ title: string; content: string }>({
        title: data.prompt || '',
        content: data.response || ''
    });

    // Scroll state for smart wheel handling
    const [hasVerticalScroll, setHasVerticalScroll] = useState(false);

    // ===========================================================================
    // EFFECTS
    // ===========================================================================

    // Sync from store
    useEffect(() => {
        if (data.prompt !== localTitle) setLocalTitle(data.prompt || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.prompt]);

    useEffect(() => {
        if (data.response !== localContent) setLocalContent(data.response || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.response]);

    // Auto-focus new notes
    useEffect(() => {
        if (pendingFocusNodeId === id) {
            setTimeout(() => {
                titleRef.current?.focus();
                clearPendingFocus();
            }, 50);
        }
    }, [pendingFocusNodeId, id, clearPendingFocus]);

    // Sync Quote Mode from Store
    useEffect(() => {
        if (data.isQuoteModeActive !== undefined && data.isQuoteModeActive !== isQuoteMode) {
            setIsQuoteMode(data.isQuoteModeActive);
            if (data.isQuoteModeActive) setSelectedQuoteText('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.isQuoteModeActive]);

    // Save Title on Debounce or Blur
    useEffect(() => {
        if (debouncedTitle !== data.prompt) {
            updateNodeData(id, { prompt: debouncedTitle });
        }
        // Убираем data.prompt из зависимостей, чтобы избежать перезаписи внешних изменений
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedTitle, id, updateNodeData]);

    // Save Content on Debounce
    useEffect(() => {
        if (debouncedContent !== data.response) {
            updateNodeData(id, { response: debouncedContent });
        }
        // Убираем data.response из зависимостей, чтобы избежать перезаписи внешних изменений
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedContent, id, updateNodeData]);

    // Auto-Summarize logic
    const generateSummary = useCallback(async (text: string) => {
        // Если текст пустой - очищаем summary
        if (!text) {
            updateNodeData(id, { summary: null, isSummarizing: false });
            return;
        }
        
        // Если суммаризация отключена или текст короткий - используем сам текст как summary
        if (!useSummarization || text.length < 100 || !apiKey) {
            if (text.length < 100) {
                updateNodeData(id, { summary: text });
            }
            return;
        }

        updateNodeData(id, { isSummarizing: true });

        try {
            const res = await fetch('/api/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    apiKey,
                    apiBaseUrl,
                    model,
                    corporateMode,
                }),
            });

            if (!res.ok) throw new Error('Summary failed');

            const json = await res.json();
            updateNodeData(id, {
                summary: json.summary || text.slice(0, 200) + '...',
                isSummarizing: false
            });
        } catch (err) {
            console.error('Note summary error:', err);
            updateNodeData(id, {
                summary: text.slice(0, 200) + '...',
                isSummarizing: false
            });
        }
    }, [id, updateNodeData, apiKey, apiBaseUrl, model, corporateMode, useSummarization]);

    // Trigger Summary when content changes (debounced)
    // ВАЖНО: Используем ref для отслеживания последнего суммаризированного контента,
    // а НЕ data.summary в зависимостях! Иначе возникает бесконечный цикл:
    // content !== summary (всегда true) → generateSummary → summary обновился → 
    // → эффект перезапустился → content !== summary (снова true) → бесконечный цикл
    useEffect(() => {
        // Проверяем что контент изменился с момента последней суммаризации
        // Включая случай когда контент стал пустым (для очистки summary)
        if (debouncedContent !== lastSummarizedContentRef.current) {
            // Сохраняем текущий контент как "суммаризированный" ДО вызова API
            // чтобы предотвратить повторные вызовы при быстрых изменениях
            lastSummarizedContentRef.current = debouncedContent;
            generateSummary(debouncedContent);
        }
    }, [debouncedContent, generateSummary]); // БЕЗ data.summary в зависимостях!

    // Auto-Embedding logic (background)
    const handleGenerateEmbedding = useCallback(async (title: string, content: string) => {
        if (!apiKey || !embeddingsBaseUrl || !embeddingsModel) return;

        try {
            const { generateAndSaveEmbedding } = await import('@/lib/search/semantic');
            const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
            const canvasId = useWorkspaceStore.getState().activeCanvasId;
            
            if (canvasId) {
                await generateAndSaveEmbedding(
                    id,
                    canvasId,
                    title,
                    content,
                    apiKey,
                    embeddingsBaseUrl,
                    corporateMode,
                    embeddingsModel
                );
                console.log('[NoteNode] Эмбеддинг обновлён:', id);
            }
        } catch (err) {
            console.error('[NoteNode] Ошибка эмбеддинга:', err);
        }
    }, [id, apiKey, embeddingsBaseUrl, embeddingsModel, corporateMode]);

    // Trigger Embedding when content or title changes (debounced)
    useEffect(() => {
        const last = lastIndexedDataRef.current;
        // Если изменился заголовок или контент (и контент не пустой)
        if ((debouncedTitle !== last.title || debouncedContent !== last.content) && debouncedContent.trim()) {
            lastIndexedDataRef.current = {
                title: debouncedTitle,
                content: debouncedContent
            };
            handleGenerateEmbedding(debouncedTitle, debouncedContent);
        }
    }, [debouncedTitle, debouncedContent, handleGenerateEmbedding]);

    // Resize Logic (Copy-paste from NeuroNode)
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

    // Scroll detection for smart wheel handling
    useEffect(() => {
        const checkScroll = () => {
            const container = contentScrollRef.current;
            if (container) {
                const hasScroll = container.scrollHeight > container.clientHeight;
                setHasVerticalScroll(hasScroll);
            }
        };
        checkScroll();
        // Re-check when content changes
        const resizeObserver = new ResizeObserver(checkScroll);
        if (contentScrollRef.current) {
            resizeObserver.observe(contentScrollRef.current);
        }
        return () => resizeObserver.disconnect();
    }, [localContent, isEditingContent, isQuoteMode]);

    // ===========================================================================
    // HANDLERS
    // ===========================================================================

    const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setLocalTitle(e.target.value);
    };

    const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setLocalContent(e.target.value);
    };

    const handleCopy = async () => {
        if (!localContent) return;
        try {
            await navigator.clipboard.writeText(localContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = () => removeNode(id);

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        resizeStartXRef.current = e.clientX;
        resizeStartWidthRef.current = resizeWidth;
        setIsResizing(true);
    };

    // Double-click handlers for View/Edit mode
    const handleTitleDoubleClick = () => {
        setIsEditingTitle(true);
        setTimeout(() => titleRef.current?.focus(), 0);
    };

    const handleContentDoubleClick = () => {
        if (!isQuoteMode) {
            setIsEditingContent(true);
            setTimeout(() => contentRef.current?.focus(), 0);
        }
    };

    const handleTitleBlur = () => {
        setIsEditingTitle(false);
    };

    const handleContentBlur = () => {
        setIsEditingContent(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        // Ctrl+Enter: focus content field
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            setIsEditingContent(true);
            setTimeout(() => contentRef.current?.focus(), 0);
            return;
        }
        if (e.key === 'Escape') {
            setIsEditingTitle(false);
            titleRef.current?.blur();
        }
        e.stopPropagation();
    };

    const handleContentKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsEditingContent(false);
            contentRef.current?.blur();
        }
        e.stopPropagation();
    };

    // Quote Handlers
    const handleEnterQuoteMode = () => {
        setIsQuoteMode(true);
        setSelectedQuoteText('');
    };

    const handleExitQuoteMode = useCallback(() => {
        setIsQuoteMode(false);
        setSelectedQuoteText('');
        window.getSelection()?.removeAllRanges();
        if (data.isQuoteModeActive) {
            clearQuoteModeActive(id);
        }
    }, [id, data.isQuoteModeActive, clearQuoteModeActive]);

    /**
     * Открытие режима чтения для текущей заметки
     */
    const handleOpenReadingMode = useCallback(() => {
        openReadingMode(id);
    }, [id, openReadingMode]);

    const handleTextSelection = useCallback(() => {
        if (!isQuoteMode) return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            setSelectedQuoteText('');
            return;
        }
        const selectedText = selection.toString().trim();
        if (selectedText) setSelectedQuoteText(selectedText);
    }, [isQuoteMode]);

    const handleCreateQuoteCard = () => {
        if (!selectedQuoteText || !localContent) return;
        if (data.quoteModeInitiatedByNodeId) {
            updateQuote(data.quoteModeInitiatedByNodeId, selectedQuoteText, id, localContent);
        } else {
            createQuoteNode(id, selectedQuoteText);
        }
        handleExitQuoteMode();
    };


    // ===========================================================================
    // RENDER
    // ===========================================================================

    return (
        <div
            className={cn(
                'neuro-node-wrapper relative',
                isResizing && 'neuro-node-wrapper--resizing'
            )}
            style={{ width: resizeWidth }}
        >
            <div
                className={cn(
                    'neuro-node bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-800 shadow-lg backdrop-blur-sm transition-all duration-300',
                    selected && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background',
                    // Reuse stale/invalid styles if needed, though notes rarely go stale in the same way
                    data.isQuoteInvalidated && 'neuro-node--quote-invalid'
                )}
            >
                {/* HEADER: Title */}
                <div
                    className={cn(
                        "relative p-4 border-b border-amber-100 dark:border-amber-900/50",
                        !isEditingTitle && "cursor-grab"
                    )}
                    onDoubleClick={handleTitleDoubleClick}
                >
                    {/* Only Right Handle (Output) */}
                    <Handle
                        type="source"
                        position={Position.Right}
                        className={cn(
                            'neuro-handle !w-6 !h-6 !bg-amber-500 !border-2 !border-background',
                            '!absolute !right-0 !top-1/2 !translate-x-1/2 !-translate-y-1/2'
                        )}
                    />

                    {isEditingTitle ? (
                        <TextareaAutosize
                            ref={titleRef}
                            value={localTitle}
                            onChange={handleTitleChange}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            placeholder={t.noteNode?.titlePlaceholder || 'Note title'}
                            minRows={1}
                            className={cn(
                                'w-full resize-none overflow-hidden bg-transparent border-none p-0',
                                'text-lg font-bold text-amber-900 dark:text-amber-100 placeholder:text-amber-900/30 dark:placeholder:text-amber-100/30',
                                'focus:outline-none focus:ring-0 nodrag'
                            )}
                        />
                    ) : (
                        <div className="text-lg font-bold text-amber-900 dark:text-amber-100 min-h-[28px]">
                            {localTitle || <span className="text-amber-900/30 dark:text-amber-100/30">{t.noteNode?.titlePlaceholder || 'Note title'}</span>}
                        </div>
                    )}
                </div>

                {/* TOOLBAR */}
                <div className="flex items-center justify-between px-2 py-1 bg-amber-100/50 dark:bg-amber-900/30">
                    <div className="flex items-center gap-1">
                        {/* Copy */}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleCopy}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="h-8 w-8 p-0 nodrag text-amber-800 dark:text-amber-200 hover:bg-amber-200/50 dark:hover:bg-amber-900/50"
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>

                        {/* Quote */}
                        <div className="flex items-center gap-1">
                            <Button
                                variant={isQuoteMode ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={isQuoteMode ? handleExitQuoteMode : handleEnterQuoteMode}
                                onPointerDown={(e) => e.stopPropagation()}
                                className={cn(
                                    'h-8 w-8 p-0 nodrag text-amber-800 dark:text-amber-200 hover:bg-amber-200/50 dark:hover:bg-amber-900/50',
                                    isQuoteMode && 'bg-amber-200 dark:bg-amber-800'
                                )}
                            >
                                {isQuoteMode ? <X className="w-4 h-4" /> : <Quote className="w-4 h-4" />}
                            </Button>

                            {isQuoteMode && selectedQuoteText && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCreateQuoteCard}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="h-8 px-2 text-amber-800 dark:text-amber-200 hover:bg-amber-200/50 gap-1.5 animate-in fade-in nodrag"
                                >
                                    <PlusCircle className="w-4 h-4" />
                                    <span className="text-xs font-medium">
                                        {data.quoteModeInitiatedByNodeId ? t.common.update : t.common.create}
                                    </span>
                                </Button>
                            )}
                        </div>

                        {/* Кнопка режима чтения */}
                        {localContent && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleOpenReadingMode}
                                onPointerDown={(e) => e.stopPropagation()}
                                className="h-8 w-8 p-0 nodrag text-amber-800 dark:text-amber-200 hover:bg-amber-200/50 dark:hover:bg-amber-900/50"
                                title={t.readingMode?.openReadingMode || 'Режим чтения (F2)'}
                            >
                                <BookOpen className="w-4 h-4" />
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDelete}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 nodrag"
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>

                        <div
                            onMouseDown={handleResizeStart}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="neuro-resize-handle h-8 w-4 -mr-2 flex items-center justify-center cursor-ew-resize text-amber-900/30 hover:text-amber-900 hover:bg-amber-200/50 nodrag"
                        >
                            <GripVertical className="w-3 h-4" />
                        </div>
                    </div>
                </div>

                {/* CONTENT - единственный контейнер со скроллом */}
                <div
                    ref={contentScrollRef}
                    className={cn(
                        "note-content-scroll relative p-4 overflow-y-auto overflow-x-hidden",
                        !isEditingContent && !isQuoteMode && "cursor-grab",
                        // Динамически добавляем nowheel только при наличии скролла
                        hasVerticalScroll && 'nowheel'
                    )}
                    style={{ maxHeight: 400 }}
                    onDoubleClick={handleContentDoubleClick}
                >
                    {isQuoteMode ? (
                        <div
                            ref={contentDisplayRef}
                            onMouseUp={handleTextSelection}
                            className={cn(
                                'relative', // Для позиционирования индикатора режима
                                'prose prose-sm dark:prose-invert max-w-none',
                                'select-text cursor-text quote-mode-active nodrag'
                            )}
                        >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {localContent || `*${t.noteNode?.emptyNote || 'Empty note'}*`}
                            </ReactMarkdown>
                            <div className="absolute top-0 right-0 bg-amber-200 text-amber-900 text-xs px-2 py-1 rounded shadow">
                                {t.noteNode?.quoteSelectionMode || 'Text selection mode'}
                            </div>
                        </div>
                    ) : isEditingContent ? (
                        <TextareaAutosize
                            ref={contentRef}
                            value={localContent}
                            onChange={handleContentChange}
                            onBlur={handleContentBlur}
                            onKeyDown={handleContentKeyDown}
                            placeholder={t.noteNode?.contentPlaceholder || 'Write your note...'}
                            minRows={5}
                            className={cn(
                                'w-full resize-none bg-transparent border-none p-0 overflow-hidden',
                                'text-sm text-foreground focus:outline-none focus:ring-0',
                                'nodrag neuro-textarea'
                            )}
                        />
                    ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                            {localContent ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {localContent}
                                </ReactMarkdown>
                            ) : (
                                <span className="text-muted-foreground">{t.noteNode?.contentPlaceholder || 'Write your note...'}</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer info */}
                <div className="px-4 py-2 text-xs text-amber-900/40 dark:text-amber-100/40 flex justify-between">
                    <span>{localContent.length} {t.noteNode?.chars || 'chars'}</span>
                    {data.isSummarizing && <span className="animate-pulse">{t.noteNode?.summarizing || 'Summarizing...'}</span>}
                </div>

            </div>
        </div>
    );
};

export default memo(NoteNodeComponent);
