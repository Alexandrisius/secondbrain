'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileNode } from './types';
import { Download, ExternalLink, FileText, Info, Loader2, Database, Clock, Link as LinkIcon, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useCanvasStore } from '@/store/useCanvasStore';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileNode | null;
}

type TabId = 'view' | 'meta' | 'links';

/**
 * Тип для хранения загруженных данных о нодах из других холстов
 */
type NodeNamesCache = Record<string, Record<string, string>>; // canvasId -> nodeId -> questionText

/**
 * Обрезает текст до указанной длины с многоточием
 */
function truncateText(text: string, maxLength: number = 50): string {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength).trim() + '…';
}

export function FilePreviewModal({ isOpen, onClose, file }: FilePreviewModalProps) {
  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager.preview : en.fileManager.preview;
  
  const [activeTab, setActiveTab] = useState<TabId>('view');
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Image viewer state
  const [imageFit, setImageFit] = useState(true);
  const [imageZoom, setImageZoom] = useState(1);

  // Кэш названий нод из других холстов
  const [nodeNamesCache, setNodeNamesCache] = useState<NodeNamesCache>({});
  const [loadingCanvasIds, setLoadingCanvasIds] = useState<Set<string>>(new Set());

  // Получаем данные из сторов
  const canvases = useWorkspaceStore((s) => s.canvases);
  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);
  const activeCanvasNodes = useCanvasStore((s) => s.nodes);

  /**
   * Получить название холста по ID
   */
  const getCanvasName = (canvasId: string): string => {
    const canvas = canvases.find((c) => c.id === canvasId);
    return canvas?.name || canvasId;
  };

  /**
   * Получить название карточки (вопрос) по nodeId
   * Сначала проверяем активный холст, потом кэш
   */
  const getNodeName = (canvasId: string, nodeId: string): string => {
    // Если это активный холст — ищем в текущих нодах
    if (canvasId === activeCanvasId && activeCanvasNodes) {
      const node = activeCanvasNodes.find((n) => n.id === nodeId);
      if (node?.data) {
        // Для AI-карточки берём prompt, для заметки — title
        // Примечание: в NeuroNode вопрос хранится в поле "prompt"
        const text = String(node.data.prompt || node.data.title || '').trim();
        if (text) return truncateText(text, 60);
      }
    }

    // Ищем в кэше загруженных данных
    const cached = nodeNamesCache[canvasId]?.[nodeId];
    if (cached) return truncateText(cached, 60);

    // Если не нашли — возвращаем nodeId
    return nodeId;
  };

  /**
   * Загрузить данные холста для получения названий нод
   */
  const loadCanvasNodesData = async (canvasId: string) => {
    // Не загружаем если это активный холст или уже загружаем/загрузили
    if (canvasId === activeCanvasId) return;
    if (loadingCanvasIds.has(canvasId)) return;
    if (nodeNamesCache[canvasId]) return;

    setLoadingCanvasIds((prev) => new Set(prev).add(canvasId));

    try {
      const res = await fetch(`/api/canvas/${canvasId}`);
      if (!res.ok) return;

      const data = await res.json();
      const nodes = data.nodes || [];

      // Создаём маппинг nodeId -> prompt/title
      // Примечание: в NeuroNode вопрос хранится в поле "prompt"
      const nodeNames: Record<string, string> = {};
      for (const node of nodes) {
        const nodeId = String(node.id || '').trim();
        if (!nodeId) continue;
        const text = node.data?.prompt || node.data?.title || '';
        if (text) {
          nodeNames[nodeId] = text;
        }
      }

      setNodeNamesCache((prev) => ({
        ...prev,
        [canvasId]: nodeNames,
      }));
    } catch (err) {
      console.warn('[FilePreviewModal] Failed to load canvas nodes:', canvasId, err);
    } finally {
      setLoadingCanvasIds((prev) => {
        const next = new Set(prev);
        next.delete(canvasId);
        return next;
      });
    }
  };

  // Загружаем данные для всех холстов при открытии вкладки links
  useEffect(() => {
    if (!isOpen || !file || activeTab !== 'links') return;

    const links = file.canvasNodeLinks || [];
    for (const link of links) {
      if (link.canvasId !== activeCanvasId) {
        loadCanvasNodesData(link.canvasId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, file, activeTab, activeCanvasId]);

  // Reset state when file changes
  useEffect(() => {
    if (!isOpen || !file) {
      setContent(null);
      setError(null);
      setIsLoading(false);
      setActiveTab('view');
      setImageFit(true);
      setImageZoom(1);
      return;
    }

    const loadContent = async () => {
      if (file.type === 'image') return;

      try {
        setIsLoading(true);
        setError(null);
        
        const url = file.docId ? `/api/library/text/${file.docId}` : `/api/library/text/${file.id}`;
        
        const res = await fetch(url);
        if (!res.ok) {
            // Если 400/404 - значит текста нет (например, бинарник), это не ошибка загрузки, а отсутствие контента
            if (res.status === 400 || res.status === 404) {
               setContent(null);
               return; 
            }
            throw new Error(`HTTP ${res.status}`);
        }
        
        const text = await res.text();
        setContent(text);
      } catch (err) {
        console.error('Failed to load file content:', err);
        // Важно: сообщение локализовано, но ошибка “техническая” остаётся в console.error.
        setError(t.loadContentError);
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [isOpen, file, language, t.loadContentError]);

  if (!file) return null;

  const fileUrl = file.previewUrl || `/api/library/file/${file.docId || file.id}`;
  const isImage = file.type === 'image' || file.mime?.startsWith('image/');
  const isMarkdown = file.name.endsWith('.md');

  // Formatters
  const formatSize = (bytes?: number) => {
    if (bytes === undefined) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  };

  const formatDate = (ts?: number | string) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');
  };

  // Focus node logic
  const focusNodeOnCanvas = (canvasId: string, nodeId: string) => {
    const targetCanvasId = String(canvasId || '').trim();
    const targetNodeId = String(nodeId || '').trim();
    if (!targetCanvasId || !targetNodeId) return;

    const ws = useWorkspaceStore.getState();
    const currentActiveCanvasId = String(ws.activeCanvasId || '').trim();

    useCanvasStore.getState().setSearchTargetNodeId(targetNodeId);

    if (currentActiveCanvasId && currentActiveCanvasId === targetCanvasId) {
        onClose(); // Close modal so user can see the canvas
        return;
    }

    ws.openCanvas(targetCanvasId);
    onClose();
  };

  const tabs = [
    { id: 'view' as const, label: t.title, icon: isImage ? <Maximize className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" /> },
    { id: 'meta' as const, label: t.fileInfo, icon: <Info className="w-3.5 h-3.5" /> },
    { id: 'links' as const, label: t.links, icon: <LinkIcon className="w-3.5 h-3.5" /> },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 bg-[#1e1e2e] border-[#313244] text-[#cdd6f4]">
        {/* Header with Tabs */}
        <DialogHeader className="px-4 py-3 border-b border-[#313244] flex-shrink-0 flex flex-row items-center justify-between space-y-0 pr-16">
          <div className="flex items-center gap-4 min-w-0 flex-1">
             <div className="flex flex-col min-w-0">
                <DialogTitle className="text-sm font-semibold truncate flex items-center gap-2">
                    {isImage ? <Info className="w-4 h-4 text-[#89b4fa]" /> : <FileText className="w-4 h-4 text-[#89b4fa]" />}
                    <span className="truncate" title={file.name}>{file.name}</span>
                </DialogTitle>
                <DialogDescription className="text-[10px] text-[#a6adc8] truncate">
                    {formatSize(file.sizeBytes)} • {formatDate(file.updatedAtTs || file.updatedAt)}
                </DialogDescription>
             </div>

             {/* Tabs in Header */}
             <div className="flex items-center bg-[#181825]/50 p-0.5 rounded-lg border border-[#313244]/50 ml-4">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all",
                            activeTab === tab.id 
                                ? "bg-[#313244] text-[#cdd6f4] shadow-sm" 
                                : "text-[#6c7086] hover:text-[#a6adc8] hover:bg-[#313244]/30"
                        )}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </button>
                ))}
             </div>
          </div>
            
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2 bg-[#313244]/50 border-[#45475a] hover:bg-[#45475a] hover:text-[#cdd6f4]"
              onClick={() => window.open(fileUrl, '_blank')}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.download}</span>
            </Button>
          </div>
        </DialogHeader>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative bg-[#181825]/50 flex">
          {activeTab === 'view' && (
              <div className="w-full h-full relative overflow-hidden flex flex-col">
                {isLoading ? (
                    <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-[#89b4fa] animate-spin" />
                    </div>
                ) : error ? (
                    <div className="flex-1 flex items-center justify-center text-[#f38ba8]">
                    {error}
                    </div>
                ) : isImage ? (
                    <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-[#11111b]">
                        {/* Image Toolbar */}
                        <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-[#1e1e2e]/90 border border-[#313244] rounded-lg p-1 shadow-lg backdrop-blur-sm">
                            <button
                                onClick={() => { setImageFit(true); setImageZoom(1); }}
                                className={cn("p-1.5 rounded hover:bg-[#313244] text-[#a6adc8]", imageFit && "text-[#89b4fa]")}
                                title={t.fitToScreen}
                            >
                                <Maximize className="w-4 h-4" />
                            </button>
                            <div className="w-px h-4 bg-[#313244] mx-1" />
                            <button
                                onClick={() => { setImageFit(false); setImageZoom(z => Math.max(0.1, z - 0.1)); }}
                                className="p-1.5 rounded hover:bg-[#313244] text-[#a6adc8]"
                            >
                                <ZoomOut className="w-4 h-4" />
                            </button>
                            <span className="text-[10px] w-8 text-center text-[#cdd6f4]">{Math.round(imageZoom * 100)}%</span>
                            <button
                                onClick={() => { setImageFit(false); setImageZoom(z => Math.min(5, z + 0.1)); }}
                                className="p-1.5 rounded hover:bg-[#313244] text-[#a6adc8]"
                            >
                                <ZoomIn className="w-4 h-4" />
                            </button>
                        </div>

                        <div className={cn("w-full h-full", imageFit ? "p-4 flex items-center justify-center" : "overflow-auto")}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img 
                                src={fileUrl} 
                                alt={file.name} 
                                className={cn(
                                    "transition-transform duration-200",
                                    imageFit ? "max-w-full max-h-full object-contain shadow-2xl rounded-lg" : "max-w-none"
                                )}
                                style={!imageFit ? { transform: `scale(${imageZoom})`, transformOrigin: 'top left' } : undefined}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="w-full h-full overflow-y-auto scrollbar-thin scrollbar-thumb-[#313244] p-8">
                        {isMarkdown ? (
                            <div className="prose prose-invert prose-sm max-w-none prose-headings:text-[#cdd6f4] prose-a:text-[#89b4fa] prose-code:text-[#f5c2e7] prose-pre:bg-[#11111b] mx-auto w-full lg:w-3/4">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {content || ''}
                            </ReactMarkdown>
                            </div>
                        ) : content ? (
                            <pre className="p-4 rounded-lg bg-[#11111b] text-xs font-mono text-[#cdd6f4] whitespace-pre-wrap break-words min-h-full border border-[#313244]">
                            {content}
                            </pre>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-[#6c7086] gap-2">
                                <FileText className="w-12 h-12 opacity-20" />
                                <p>{t.noContent}</p>
                                <Button variant="outline" onClick={() => window.open(fileUrl, '_blank')}>
                                    {t.openInNewTab}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
              </div>
          )}

          {activeTab === 'meta' && (
              <div className="w-full h-full overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-[#313244]">
                  <div className="max-w-2xl mx-auto space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                          <div className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244]">
                              <div className="text-[10px] text-[#a6adc8] uppercase tracking-wider font-bold mb-1">{t.docId}</div>
                              <div className="text-xs text-[#cdd6f4] font-mono break-all select-all">{file.docId || file.id}</div>
                          </div>
                          <div className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244]">
                              <div className="text-[10px] text-[#a6adc8] uppercase tracking-wider font-bold mb-1">{t.mimeType}</div>
                              <div className="text-xs text-[#cdd6f4] font-mono">{file.mime || 'application/octet-stream'}</div>
                          </div>
                          <div className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244]">
                              <div className="text-[10px] text-[#a6adc8] uppercase tracking-wider font-bold mb-1 flex items-center gap-1"><Database className="w-3 h-3"/> {t.size}</div>
                              <div className="text-xs text-[#cdd6f4]">{formatSize(file.sizeBytes)}</div>
                          </div>
                          <div className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244]">
                              <div className="text-[10px] text-[#a6adc8] uppercase tracking-wider font-bold mb-1 flex items-center gap-1"><Clock className="w-3 h-3"/> {t.updated}</div>
                              <div className="text-xs text-[#cdd6f4]">{formatDate(file.updatedAtTs || file.updatedAt)}</div>
                          </div>
                      </div>

                      <div className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244]">
                          <div className="text-[10px] text-[#a6adc8] uppercase tracking-wider font-bold mb-2">{t.fileHash} (SHA-256)</div>
                          <div className="text-[10px] text-[#cdd6f4] font-mono break-all bg-[#11111b] p-2 rounded border border-[#313244]/50 select-all">
                              {file.fileHash || '—'}
                          </div>
                      </div>

                      {(file.summary || file.imageDescription) && (
                          <div className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244]">
                              <div className="text-[10px] text-[#a6adc8] uppercase tracking-wider font-bold mb-2">
                                  {isImage ? t.aiDescription : t.aiSummary}
                              </div>
                              <div className="text-xs text-[#cdd6f4] leading-relaxed whitespace-pre-wrap">
                                  {file.summary || file.imageDescription}
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          )}

          {activeTab === 'links' && (
              <div className="w-full h-full overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-[#313244]">
                  <div className="max-w-2xl mx-auto space-y-4">
                    <h3 className="text-sm font-semibold text-[#cdd6f4] mb-4">
                        {t.linksUsedIn} {file.canvasNodeLinks?.length || 0} {t.linksCanvases}
                    </h3>
                    
                    {file.canvasNodeLinks && file.canvasNodeLinks.length > 0 ? (
                        file.canvasNodeLinks.map((link) => {
                            const canvasName = getCanvasName(link.canvasId);
                            const isCurrentCanvas = link.canvasId === activeCanvasId;
                            
                            return (
                                <div key={link.canvasId} className="p-4 rounded-xl bg-[#1e1e2e] border border-[#313244] hover:border-[#89b4fa]/50 transition-colors">
                                    {/* Заголовок холста */}
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#313244]/50">
                                        <div className={cn(
                                            "w-2 h-2 rounded-full",
                                            isCurrentCanvas ? "bg-[#a6e3a1]" : "bg-[#89b4fa]"
                                        )} />
                                        <span className="text-sm font-medium text-[#cdd6f4] truncate flex-1" title={canvasName}>
                                            {canvasName}
                                        </span>
                                        {isCurrentCanvas && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#a6e3a1]/20 text-[#a6e3a1]">
                                                {t.currentCanvasBadge}
                                            </span>
                                        )}
                                    </div>
                                    
                                    {/* Список карточек */}
                                    {link.nodeIds && link.nodeIds.length > 0 ? (
                                        <div className="space-y-2">
                                            {link.nodeIds.map(nodeId => {
                                                const nodeName = getNodeName(link.canvasId, nodeId);
                                                const isNodeIdOnly = nodeName === nodeId;
                                                
                                                return (
                                                    <button 
                                                        key={nodeId}
                                                        onClick={() => focusNodeOnCanvas(link.canvasId, nodeId)}
                                                        className="w-full flex items-center justify-between p-2.5 rounded-lg bg-[#313244]/30 hover:bg-[#313244] text-left transition-colors group"
                                                    >
                                                        <div className="flex-1 min-w-0 mr-2">
                                                            <span className={cn(
                                                                "text-xs block truncate",
                                                                isNodeIdOnly 
                                                                    ? "text-[#6c7086] font-mono" 
                                                                    : "text-[#cdd6f4] group-hover:text-[#cdd6f4]"
                                                            )} title={nodeName}>
                                                                {nodeName}
                                                            </span>
                                                            {!isNodeIdOnly && (
                                                                <span className="text-[10px] text-[#6c7086] font-mono">
                                                                    {nodeId}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <ExternalLink className="w-3.5 h-3.5 text-[#6c7086] group-hover:text-[#89b4fa] flex-shrink-0" />
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-[#6c7086] italic">{t.linksNoCards}</p>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div className="flex flex-col items-center justify-center p-12 text-[#6c7086] border border-dashed border-[#313244] rounded-xl">
                            <LinkIcon className="w-8 h-8 mb-2 opacity-50" />
                            <p>{t.linksNoLinks}</p>
                        </div>
                    )}
                  </div>
              </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
