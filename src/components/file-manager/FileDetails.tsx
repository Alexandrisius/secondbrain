'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { 
  X, 
  ExternalLink, 
  Trash2, 
  Download, 
  FileText, 
  Clock,
  Database,
  Link as LinkIcon,
  Info,
  Loader2,
  AlertCircle,
  ZoomIn,
  ZoomOut,
  Maximize,
  RefreshCw,
  Pencil,
  ArrowRightLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileNode } from './types';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useLibraryStore } from '@/store/useLibraryStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Вкладки панели деталей документа.
 *
 * Почему именно такие вкладки:
 * - "Просмотр": встроенный просмотр контента (текст/изображение) — основной UX.
 * - "Метаданные": техническая информация для дебага и управления библиотекой.
 * - "Ссылки": обратные ссылки (где используется документ).
 */
type DetailsTabId = 'view' | 'meta' | 'links';

interface FileDetailsProps {
  file: FileNode;
  onClose: () => void;
  onDelete: (id: string) => void;
  /**
   * Открыть UI-диалог переименования документа.
   *
   * Почему callback, а не прямой вызов store здесь:
   * - sidebar управляет модалками (единая точка),
   * - sidebar уже имеет общий слой обработки ошибок/загрузки,
   * - FileDetails остаётся "вьюхой" (минимум бизнес-логики).
   */
  onRename?: (file: FileNode) => void;
  /**
   * Открыть UI-диалог перемещения документа.
   */
  onMove?: (file: FileNode) => void;
  /**
   * Запустить replace (открыть file picker и вызвать store.replace()).
   */
  onReplace?: (file: FileNode) => void;
  /**
   * Текст кнопки удаления.
   * По умолчанию: "Удалить".
   *
   * Пример использования:
   * - На вкладке "Все": "В корзину"
   * - На вкладке "Корзина": "Восстановить"
   */
  deleteLabel?: string;
  /**
   * Визуальный стиль кнопки:
   * - true: “danger” (красная)
   * - false: нейтральная
   */
  deleteIsDanger?: boolean;
}

export function FileDetails({
  file,
  onClose,
  onDelete,
  onRename,
  onMove,
  onReplace,
  deleteLabel,
  deleteIsDanger = true,
}: FileDetailsProps) {
  // ---------------------------------------------------------------------------
  // I18N
  // ---------------------------------------------------------------------------
  // FileDetails сейчас не всегда включён в UI, но если он используется,
  // он должен быть полностью локализован (как и весь File Manager).
  const language = useSettingsStore((s) => s.language);
  const fm = language === 'ru' ? ru.fileManager : en.fileManager;
  const d = fm.details;
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  // ===========================================================================
  // STORE DATA (для вкладки "Метаданные")
  // ===========================================================================
  //
  // Мы берём folders из store, чтобы:
  // - уметь показать "путь" документа (Root / ... / Folder),
  // - не передавать folders через prop-drilling из FileManagerSidebar.
  //
  // Важно:
  // - store — клиентский, FileDetails тоже клиентский компонент (см. 'use client').
  const folders = useLibraryStore((s) => s.folders);

  // ===========================================================================
  // TAB STATE
  // ===========================================================================
  //
  // Важное UX-правило:
  // - при выборе другого файла — возвращаемся на вкладку "Просмотр",
  //   чтобы пользователь всегда видел "контент" выбранного документа.
  const [activeTab, setActiveTab] = useState<DetailsTabId>('view');

  /**
   * URL "канонического" файла библиотеки.
   *
   * Важно:
   * - для библиотечных файлов id === docId
   * - но мы оставляем fallback на file.id для совместимости с прежними моками.
   */
  const fileUrlBase = file.docId ? `/api/library/file/${file.docId}` : `/api/library/file/${file.id}`;
  /**
   * Cache-busting (Todo E):
   *
   * Почему нужен `?v=`:
   * - endpoint `/api/library/file/[docId]` отдаёт Cache-Control (max-age),
   * - после replace docId НЕ меняется, поэтому браузер может показать старую версию из кеша,
   * - добавляя `?v=<fileHash|fileUpdatedAt>` мы гарантируем, что URL изменится при замене файла.
   *
   * Что используем как версию:
   * - предпочитаем fileHash (точнее),
   * - fallback: fileUpdatedAt (если hash отсутствует/сломался).
   */
  const versionToken = String(file.fileHash || file.fileUpdatedAt || '').trim();
  const fileUrl = `${fileUrlBase}${versionToken ? `?v=${encodeURIComponent(versionToken)}` : ''}`;

  /**
   * URL для получения текста документа.
   *
   * Важно:
   * - endpoint отдаёт ТОЛЬКО текстовые документы (kind:text на сервере).
   * - Для изображений этот endpoint вернёт 400 — мы это обрабатываем в UI как понятную ошибку.
   */
  const fileTextUrl = file.docId ? `/api/library/text/${file.docId}` : `/api/library/text/${file.id}`;

  /**
   * docId (унифицированный).
   *
   * Важно:
   * - в текущей модели UI мы используем `id = docId` для документов,
   *   но оставляем fallback на `file.docId`.
   */
  const docId = String(file.docId || file.id || '').trim();

  /**
   * Определяем, является ли документ изображением.
   *
   * Почему так:
   * - В библиотеке сейчас документы двух видов: image / text.
   * - На клиенте у нас нет отдельного `kind`, но есть:
   *   - previewUrl (ставится только для изображений),
   *   - mime (как доп. сигнал).
   */
  const isImage = Boolean(file.previewUrl) || String(file.mime || '').toLowerCase().startsWith('image/');
  const isTrashed = Boolean(file.trashedAt);
  // Если вызывающая сторона не передала deleteLabel — выбираем “ожидаемое” действие по вкладке:
  // - документ не в корзине → "В корзину"
  // - документ в корзине → "Восстановить"
  const resolvedDeleteLabel = ((): string => {
    if (typeof deleteLabel === 'string' && deleteLabel.trim()) return deleteLabel;
    return isTrashed ? fm.actions.restore : fm.actions.trash;
  })();

  /**
   * Сброс вкладок/состояний при смене выбранного файла.
   *
   * Важно:
   * - завязываемся на docId, потому что это стабильный идентификатор документа.
   */
  useEffect(() => {
    setActiveTab('view');
  }, [docId]);

  // ===========================================================================
  // TEXT VIEWER STATE (для вкладки "Просмотр" у текстовых документов)
  // ===========================================================================
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string>('');
  const [showFullText, setShowFullText] = useState(false);

  /**
   * Ограничение вывода больших текстов в UI.
   *
   * Почему это важно:
   * - markdown/код может быть очень большим,
   * - рендер "огромного" <pre> в React может подвесить вкладку/страницу,
   * - поэтому мы показываем "первые N символов" и даём кнопку "показать полностью".
   *
   * NOTE:
   * - сервер сейчас отдаёт целиком; лимит — чисто UI слой.
   * - если захотим оптимизировать сильнее, можно добавить пагинацию на API уровне.
   */
  const TEXT_PREVIEW_CHAR_LIMIT = 200_000;

  const displayedText = useMemo(() => {
    const raw = String(textContent || '');
    if (showFullText) return raw;
    if (raw.length <= TEXT_PREVIEW_CHAR_LIMIT) return raw;
    return raw.slice(0, TEXT_PREVIEW_CHAR_LIMIT);
  }, [textContent, showFullText]);

  const isTextTruncated = useMemo(() => {
    const raw = String(textContent || '');
    return !showFullText && raw.length > TEXT_PREVIEW_CHAR_LIMIT;
  }, [textContent, showFullText]);

  /**
   * Ленивая загрузка текста:
   * - только когда открыта вкладка "Просмотр",
   * - и только если документ не изображение.
   *
   * Почему не грузим всегда:
   * - экономим трафик,
   * - не делаем лишнюю работу, если пользователь смотрит только метаданные/ссылки.
   */
  useEffect(() => {
    if (activeTab !== 'view') return;
    if (!docId) return;
    if (isImage) return;

    const ac = new AbortController();

    const run = async () => {
      setTextLoading(true);
      setTextError(null);

      try {
        const res = await fetch(fileTextUrl, {
          method: 'GET',
          signal: ac.signal,
          // Важно: текст можно кешировать "мягко" (private),
          // сервер и так отдаёт Cache-Control private,max-age=3600.
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
        }

        const text = await res.text();
        setTextContent(text);
      } catch (e) {
        if (ac.signal.aborted) return;
        setTextError(e instanceof Error ? e.message : String(e));
        setTextContent('');
      } finally {
        if (!ac.signal.aborted) setTextLoading(false);
      }
    };

    // Сбрасываем флаг "показать полностью" при каждом новом docId,
    // чтобы случайно не "залипнуть" в full-mode между файлами.
    setShowFullText(false);
    void run();

    return () => ac.abort();
  }, [activeTab, docId, isImage, fileTextUrl]);

  // ===========================================================================
  // IMAGE VIEWER STATE (zoom/fit)
  // ===========================================================================
  //
  // Мы делаем минимальный, но полезный набор:
  // - "Вписать" (fit) — по умолчанию: изображение вписывается в область.
  // - "+" / "-" — зум (если пользователь хочет рассмотреть детали).
  //
  // Важно:
  // - Это "встроенный просмотр". Открытие в новой вкладке остаётся доступным.
  const [imageFit, setImageFit] = useState(true);
  const [imageZoom, setImageZoom] = useState(1);

  useEffect(() => {
    // Сбрасываем зум при смене документа (чтобы не переносить масштаб между файлами).
    setImageFit(true);
    setImageZoom(1);
  }, [docId]);

  /**
   * Переход на конкретную карточку (canvasId + nodeId) и фокусировка на ней.
   *
   * Как это работает внутри приложения:
   * - мы кладём `searchTargetNodeId` в `useCanvasStore`,
   * - затем переключаемся на нужный холст через `useWorkspaceStore.openCanvas`,
   * - после загрузки холста `CanvasContent` увидит `searchTargetNodeId`
   *   и сделает центрирование + выделение (см. CanvasContent.tsx).
   *
   * Почему мы используем getState() вместо хуков:
   * - обработчик вызывается по клику (event-driven),
   * - нам не нужно подписываться на изменения стора,
   * - так меньше лишних ререндеров.
   */
  const focusNodeOnCanvas = (canvasId: string, nodeId: string) => {
    const targetCanvasId = String(canvasId || '').trim();
    const targetNodeId = String(nodeId || '').trim();
    if (!targetCanvasId || !targetNodeId) return;

    const ws = useWorkspaceStore.getState();
    const activeCanvasId = String(ws.activeCanvasId || '').trim();

    // 1) В любом случае выставляем “цель” фокусировки
    useCanvasStore.getState().setSearchTargetNodeId(targetNodeId);

    // 2) Если мы уже на нужном холсте — просто оставляем searchTargetNodeId,
    //    CanvasContent effect сработает и центрирует.
    if (activeCanvasId && activeCanvasId === targetCanvasId) return;

    // 3) Иначе переключаемся на нужный холст.
    ws.openCanvas(targetCanvasId);
  };

  // ===========================================================================
  // METADATA HELPERS
  // ===========================================================================
  //
  // file.parentId для документов — это folderId (см. mapping в FileManagerSidebar).
  const folderPath = useMemo(() => {
    const folderId = file.parentId;
    if (!folderId) return d.root;

    // Строим map для быстрого поиска
    const byId = new Map(folders.map((f) => [f.id, f]));

    // Собираем цепочку parentId → ... → null
    const parts: string[] = [];
    let cur: string | null = folderId;

    // Защита от циклов: максимум N шагов (N = кол-во папок + 1)
    const maxSteps = (folders?.length || 0) + 1;
    let steps = 0;

    while (cur && steps < maxSteps) {
      const f = byId.get(cur);
      if (!f) break;
      parts.push(f.name);
      cur = f.parentId;
      steps += 1;
    }

    // Путь показываем от корня к листу
    const path = [d.root, ...parts.reverse()].join(' / ');
    return path;
  }, [file.parentId, folders, d.root]);

  const formatTs = (ts: number | undefined) => {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return '—';
    try {
      return new Date(ts).toLocaleString(locale);
    } catch {
      return String(ts);
    }
  };

  // ===========================================================================
  // TABS MODEL (для рендера таб-бара)
  // ===========================================================================
  const tabs: Array<{ id: DetailsTabId; label: string; icon: React.ReactNode }> = useMemo(
    () => [
      { id: 'view', label: d.tabView, icon: isImage ? <Maximize className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" /> },
      { id: 'meta', label: d.tabMeta, icon: <Info className="w-3.5 h-3.5" /> },
      { id: 'links', label: d.tabLinks, icon: <LinkIcon className="w-3.5 h-3.5" /> },
    ],
    [isImage, d.tabLinks, d.tabMeta, d.tabView]
  );

  return (
    <div className="h-full flex flex-col bg-[#1e1e2e] animate-in slide-in-from-right-10 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[#313244]/60">
        <span className="text-xs font-bold text-[#cdd6f4] uppercase tracking-wider">{d.panelTitle}</span>
        <button 
          onClick={onClose}
          className="p-1 hover:bg-[#313244] rounded-md text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-3 gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center justify-center gap-2 px-2 py-2 rounded-lg border text-[11px] font-semibold transition-colors",
                activeTab === t.id
                  ? "bg-[#313244]/60 border-[#89b4fa]/30 text-[#cdd6f4]"
                  : "bg-[#181825]/30 border-[#313244]/40 text-[#a6adc8] hover:bg-[#313244]/30 hover:text-[#cdd6f4]"
              )}
              title={t.label}
            >
              <span className="text-[#89b4fa]">{t.icon}</span>
              <span className="truncate">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* TAB: VIEW */}
        {activeTab === 'view' && (
          <>
            {/* Preview / Viewer */}
            <div className="w-full bg-[#181825] rounded-xl border border-[#313244] overflow-hidden relative">
              {/* Верхняя панель быстрых действий для просмотра */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#313244]/60 bg-[#1e1e2e]/30">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#cdd6f4] break-all">{file.name}</div>
                  <div className="text-[10px] text-[#6c7086] break-all">
                    {isImage ? d.typeImage : d.typeText} • {docId || '—'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Открыть в новой вкладке — универсально для всех типов */}
                  <button
                    onClick={() => window.open(fileUrl, '_blank')}
                    className="p-2 hover:bg-[#313244] rounded-md text-[#a6adc8] hover:text-[#cdd6f4] transition-colors"
                    title={d.openFileInNewTabTooltip}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>

                  {/* Для текстов: кнопка "перезагрузить" */}
                  {!isImage && (
                    <button
                      onClick={() => {
                        // Небольшой трюк:
                        // - чтобы не усложнять эффекты, мы просто "дергаем" state showFullText,
                        //   а текст перезагрузится при смене fileTextUrl/docId/activeTab.
                        // - здесь делаем "жёсткий" reset контента и повторно запускаем загрузку через reset.
                        setTextContent('');
                        setTextError(null);
                        // переключаем вкладку туда же, чтобы эффект сработал предсказуемо
                        setActiveTab('view');
                      }}
                      className="p-2 hover:bg-[#313244] rounded-md text-[#a6adc8] hover:text-[#cdd6f4] transition-colors"
                      title={d.reloadTextTooltip}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Контент области просмотра */}
              <div className="relative">
                {/* IMAGE VIEWER */}
                {isImage ? (
                  <div className="relative">
                    {/* Панель зума (поверх изображения) */}
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-[#1e1e2e]/80 border border-[#313244]/60 rounded-lg p-1">
                      <button
                        onClick={() => {
                          // "Вписать" — возвращаем режим fit и сбрасываем zoom,
                          // чтобы пользователь быстро вернулся к "нормальному" виду.
                          setImageFit(true);
                          setImageZoom(1);
                        }}
                        className={cn(
                          "p-1.5 rounded-md text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors",
                          imageFit && "bg-[#313244]/60 text-[#cdd6f4]"
                        )}
                        title={d.fitImageTooltip}
                      >
                        <Maximize className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setImageFit(false);
                          setImageZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100));
                        }}
                        className="p-1.5 rounded-md text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
                        title={d.zoomOutTooltip}
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setImageFit(false);
                          setImageZoom((z) => Math.min(6, Math.round((z + 0.25) * 100) / 100));
                        }}
                        className="p-1.5 rounded-md text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors"
                        title={d.zoomInTooltip}
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <div className="px-2 text-[10px] text-[#a6adc8] tabular-nums" title={d.currentZoomTooltip}>
                        {Math.round(imageZoom * 100)}%
                      </div>
                    </div>

                    {/* Контейнер изображения */}
                    <div
                      className={cn(
                        "w-full aspect-video",
                        // В режиме zoom мы включаем скролл, чтобы пользователь мог "панорамировать" изображение.
                        imageFit ? "flex items-center justify-center" : "overflow-auto"
                      )}
                    >
                      {/*
                        ВАЖНО: здесь сознательно используем <img>, а не next/image.
                        
                        Почему:
                        - В этом просмотрщике мы делаем интерактивный zoom + pan через overflow контейнер.
                        - `next/image` рендерит дополнительную обёртку и применяет свои стили/ограничения,
                          из-за чего сложнее реализовать “layout-zoom” (увеличение реального layout box),
                          который нужен для корректной прокрутки.
                        - Мы всё равно используем cache-busting `?v=` в URL, а значит получаем актуальный контент.
                        
                        Почему это безопасно:
                        - src указывает на наш внутренний endpoint `/api/library/file/[docId]`,
                          который выставляет корректные заголовки (Content-Type, nosniff).
                        
                        Поэтому мы выключаем lint-правило точечно для одной строки.
                      */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fileUrl}
                        alt={file.name}
                        className={cn(
                          "select-none block",
                          imageFit ? "w-full h-full object-contain" : "max-w-none"
                        )}
                        style={
                          imageFit
                            ? undefined
                            : {
                                width: `${Math.round(imageZoom * 100)}%`,
                                height: 'auto',
                              }
                        }
                        draggable={false}
                      />
                    </div>
                  </div>
                ) : (
                  /* TEXT VIEWER */
                  <div className="p-3">
                    {/* Состояния загрузки/ошибок */}
                    {textLoading && (
                      <div className="flex items-center gap-2 text-xs text-[#a6adc8]">
                        <Loader2 className="w-4 h-4 animate-spin text-[#89b4fa]" />
                        {d.loadingText}
                      </div>
                    )}

                    {!textLoading && textError && (
                      <div className="p-3 rounded-lg border border-[#f38ba8]/30 bg-[#f38ba8]/10 text-xs text-[#f38ba8] break-words">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertCircle className="w-4 h-4" />
                          {d.failedToLoadText}
                        </div>
                        <div className="text-[10px] text-[#a6adc8]">
                          {textError}
                        </div>
                        <div className="mt-2 text-[10px] text-[#6c7086]">
                          {d.nonTextHint}
                        </div>
                      </div>
                    )}

                    {!textLoading && !textError && (
                      <>
                        {/* Информация о тримминге (если текст очень большой) */}
                        {isTextTruncated && (
                          <div className="mb-2 flex items-center justify-between gap-2 p-2 rounded-lg border border-[#313244]/60 bg-[#1e1e2e]/30">
                            <div className="text-[10px] text-[#a6adc8]">
                              {d.textTruncatedInfo
                                .replace('{limit}', TEXT_PREVIEW_CHAR_LIMIT.toLocaleString(locale))
                                .replace('{total}', textContent.length.toLocaleString(locale))}
                            </div>
                            <button
                              onClick={() => setShowFullText(true)}
                              className="text-[10px] font-semibold text-[#89b4fa] hover:underline"
                              title={d.showFullTextTooltip}
                            >
                              {d.showFullText}
                            </button>
                          </div>
                        )}

                        <pre
                          className={cn(
                            "text-[11px] leading-relaxed text-[#cdd6f4]",
                            "whitespace-pre-wrap break-words",
                            "font-mono",
                            "max-h-[380px] overflow-y-auto pr-2",
                            "scrollbar-thin scrollbar-thumb-[#313244]"
                          )}
                        >
                          {displayedText || '—'}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Info (size/time) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 bg-[#313244]/20 rounded-lg border border-[#313244]/40">
                <div className="flex items-center gap-1.5 text-[#6c7086] mb-1">
                  <Database className="w-3 h-3" />
                  <span className="text-[10px]">{d.sizeLabel}</span>
                </div>
                <span className="text-xs text-[#cdd6f4] font-medium">{file.size || '—'}</span>
              </div>
              <div className="p-2.5 bg-[#313244]/20 rounded-lg border border-[#313244]/40">
                <div className="flex items-center gap-1.5 text-[#6c7086] mb-1">
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px]">{d.updatedLabel}</span>
                </div>
                <span className="text-xs text-[#cdd6f4] font-medium">{file.updatedAt || '—'}</span>
              </div>
            </div>

            {/* Description / Summary (как fallback/резюме для контекста) */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-[#a6adc8]">{isImage ? d.descriptionTitle : d.summaryTitle}</h4>
              <div className="p-3 bg-[#181825]/50 rounded-lg border border-[#313244]/40 text-xs text-[#a6adc8] leading-relaxed">
                {isImage
                  ? // -------------------------------------------------------------------
                    // IMAGE: показываем LLM-описание изображения (caption-only)
                    // -------------------------------------------------------------------
                    //
                    // Важно:
                    // - описание хранится на сервере в `doc.analysis.image.description`
                    // - в UI мы денормализуем это в `file.imageDescription` (см. FileManagerSidebar mapping),
                    // - поэтому здесь не нужно делать дополнительный fetch.
                    file.imageDescription?.trim()
                    ? file.imageDescription
                    : d.noImageDescription
                  : // -------------------------------------------------------------------
                    // TEXT: summary (LLM) или excerpt (быстрое превью)
                    // -------------------------------------------------------------------
                    file.summary?.trim()
                    ? file.summary
                    : file.excerpt?.trim()
                      ? file.excerpt
                      : d.noSummary}
              </div>
            </div>
          </>
        )}

        {/* TAB: META */}
        {activeTab === 'meta' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-[#a6adc8]">{d.nameLabel}</div>
              <div className="text-xs text-[#cdd6f4] break-all">{file.name || '—'}</div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">{d.folderLabel}</div>
                <div className="text-xs text-[#cdd6f4] break-words">{folderPath}</div>
              </div>

              <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">docId</div>
                <div className="text-xs text-[#cdd6f4] break-all">{docId || '—'}</div>
              </div>

              <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">MIME</div>
                <div className="text-xs text-[#cdd6f4] break-all">{file.mime || '—'}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                  <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">sizeBytes</div>
                  <div className="text-xs text-[#cdd6f4]">{typeof file.sizeBytes === 'number' ? file.sizeBytes.toLocaleString('ru-RU') : '—'}</div>
                </div>
                <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                  <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">fileUpdatedAt</div>
                  <div className="text-xs text-[#cdd6f4]">{formatTs(file.fileUpdatedAt)}</div>
                </div>
              </div>

              <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">fileHash</div>
                <div className="text-[11px] text-[#cdd6f4] break-all font-mono">{file.fileHash || '—'}</div>
              </div>

              <div className="p-3 bg-[#181825]/40 rounded-lg border border-[#313244]/40">
                <div className="text-[10px] font-semibold text-[#a6adc8] mb-1">{d.statusLabel}</div>
                <div className="text-xs text-[#cdd6f4]">
                  {file.status || '—'}
                  {file.statusHint ? <span className="text-[#6c7086]"> • {file.statusHint}</span> : null}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: LINKS */}
        {activeTab === 'links' && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[#a6adc8]">{d.usedInTitle}</h4>
            {file.canvasNodeLinks && file.canvasNodeLinks.length > 0 ? (
              <div className="space-y-2">
                {file.canvasNodeLinks.map((link) => (
                  <div
                    key={link.canvasId}
                    className="p-2 rounded-lg bg-[#313244]/20 border border-[#313244]/40"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#89b4fa]" />
                      <span className="text-xs text-[#cdd6f4] font-medium break-all">
                        {d.canvasLabel}: {link.canvasId}
                      </span>
                    </div>

                    {Array.isArray(link.nodeIds) && link.nodeIds.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {link.nodeIds.map((nodeId) => (
                          <button
                            key={nodeId}
                            onClick={() => focusNodeOnCanvas(link.canvasId, nodeId)}
                            className="w-full text-left p-2 rounded-md bg-[#1e1e2e]/40 hover:bg-[#1e1e2e]/70 border border-transparent hover:border-[#45475a] transition-all group"
                            title={d.goToCardTooltip}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-[#cdd6f4] group-hover:underline break-all">
                                {d.cardLabel}: {nodeId}
                              </span>
                              <ExternalLink className="w-3.5 h-3.5 text-[#6c7086] group-hover:text-[#cdd6f4]" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#6c7086] italic">{d.noCardsInCanvas}</p>
                    )}
                  </div>
                ))}
              </div>
            ) : file.canvasLinks && file.canvasLinks.length > 0 ? (
              // Fallback: старый формат "только canvasIds" (без nodeIds).
              <div className="space-y-1">
                {file.canvasLinks.map((linkId) => (
                  <div
                    key={linkId}
                    className="w-full text-left p-2 rounded-lg bg-[#313244]/20 border border-transparent"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#89b4fa]" />
                      <span className="text-xs text-[#cdd6f4] break-all">
                        {d.canvasLabel}: {linkId}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#6c7086] italic">{d.noLinkedCanvases}</p>
            )}
          </div>
        )}
      </div>

      {/* Actions Footer */}
      <div className="p-3 border-t border-[#313244]/60 bg-[#181825]/30 space-y-2">
        {/* Доп. действия над документом (rename/move/replace) */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => onRename?.(file)}
            disabled={!onRename || isTrashed}
            className={cn(
              "flex items-center justify-center gap-2 p-2 rounded-lg text-[10px] font-semibold transition-colors",
              !onRename || isTrashed
                ? "bg-[#313244]/20 text-[#6c7086] cursor-not-allowed"
                : "bg-[#313244]/40 hover:bg-[#313244] text-[#cdd6f4]"
            )}
            title={isTrashed ? d.trashedFirstRestore : d.renameTooltip}
          >
            <Pencil className="w-3.5 h-3.5" />
            {d.renameShort}
          </button>
          <button
            onClick={() => onMove?.(file)}
            disabled={!onMove || isTrashed}
            className={cn(
              "flex items-center justify-center gap-2 p-2 rounded-lg text-[10px] font-semibold transition-colors",
              !onMove || isTrashed
                ? "bg-[#313244]/20 text-[#6c7086] cursor-not-allowed"
                : "bg-[#313244]/40 hover:bg-[#313244] text-[#cdd6f4]"
            )}
            title={isTrashed ? d.trashedFirstRestore : d.moveTooltip}
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            {d.moveShort}
          </button>
          <button
            onClick={() => onReplace?.(file)}
            disabled={!onReplace || isTrashed}
            className={cn(
              "flex items-center justify-center gap-2 p-2 rounded-lg text-[10px] font-semibold transition-colors",
              !onReplace || isTrashed
                ? "bg-[#313244]/20 text-[#6c7086] cursor-not-allowed"
                : "bg-[#313244]/40 hover:bg-[#313244] text-[#cdd6f4]"
            )}
            title={isTrashed ? d.trashedFirstRestore : d.replaceTooltip}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {d.replaceShort}
          </button>
        </div>

        {/* Основные действия (download + trash/restore) */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => window.open(fileUrl, '_blank')}
            className="flex items-center justify-center gap-2 p-2 rounded-lg bg-[#313244]/40 hover:bg-[#313244] text-[#cdd6f4] text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {d.download}
          </button>
          <button 
            onClick={() => onDelete(file.id)}
            className={cn(
              "flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-medium transition-colors",
              deleteIsDanger
                ? "bg-[#f38ba8]/10 hover:bg-[#f38ba8]/20 text-[#f38ba8]"
                : "bg-[#313244]/40 hover:bg-[#313244] text-[#cdd6f4]"
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {resolvedDeleteLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
