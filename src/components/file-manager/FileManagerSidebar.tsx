'use client';

import React, { useMemo, useRef, useState, useEffect } from 'react';
import { 
  ChevronRight, 
  Trash2, 
  Archive,
  GripVertical,
  X,
  ExternalLink,
  Download,
  FolderPlus,
  Pencil,
  ArrowRightLeft,
  RefreshCw,
  Sparkles,
  RotateCcw,
  Check,
  ChevronDown
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Toolbar } from './Toolbar';
import { FileItem } from './FileItem';
import { FolderItem } from './FolderItem';
import { FilePreviewModal } from './FilePreviewModal';
import { UploadZone } from './UploadZone';
import { FileNode } from './types';
import { useLibraryStore } from '@/store/useLibraryStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '@/components/sidebar/ContextMenu';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

// ... (helpers left as is) ...
const formatBytes = (bytes: number | null | undefined): string => {
  const b = typeof bytes === 'number' && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 1 : 0)} GB`;
};

/**
 * Короткое “человеческое” время вроде:
 * - RU: "только что", "5м назад", "2ч назад", "3д назад"
 * - EN: "just now", "5m ago", "2h ago", "3d ago"
 *
 * Почему не Intl.RelativeTimeFormat:
 * - нам нужен предсказуемый, компактный формат (m/h/d),
 * - и одинаковая длина строк для аккуратного UI в списке файлов.
 */
const formatRelativeTime = (
  ts: number | null | undefined,
  i18n: { time: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string } }
): string => {
  const t = typeof ts === 'number' && Number.isFinite(ts) ? ts : null;
  if (!t) return '';

  const diffMs = Date.now() - t;
  if (diffMs < 60_000) return i18n.time.justNow;

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return i18n.time.minutesAgo.replace('{count}', String(mins));

  const hours = Math.floor(mins / 60);
  if (hours < 24) return i18n.time.hoursAgo.replace('{count}', String(hours));

  const days = Math.floor(hours / 24);
  return i18n.time.daysAgo.replace('{count}', String(days));
};

/**
 * Обрезает текст для отображения в компактных списках (например, список карточек
 * в предупреждении при удалении файла).
 *
 * Важно:
 * - мы НЕ “мутируем” исходные данные ноды;
 * - обрезаем только для UI, чтобы длинные вопросы не ломали верстку.
 */
function truncateText(text: string, maxLength: number = 60): string {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength).trim() + '…';
}

/**
 * Кэш имён карточек (nodeId -> prompt/title) по canvasId.
 *
 * Зачем нужен кэш:
 * - подтверждение удаления файла должно показывать список карточек,
 * - но данные карточек других холстов не загружены в память,
 * - поэтому подгружаем /api/canvas/:id только по требованию и кэшируем.
 */
type NodeNamesCache = Record<string, Record<string, string>>; // canvasId -> nodeId -> questionText

function parseExtInput(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const parts = raw.split(/[,\s]+/g).map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const s0 = p.toLowerCase().replace(/^\.+/, '');
    if (!s0) continue;
    if (s0.includes('/') || s0.includes('\\')) continue;
    if (seen.has(s0)) continue;
    seen.add(s0);
    out.push(s0);
  }
  return out;
}

type FolderLike = { id: string; parentId: string | null; name: string };
function buildFolderSelectOptions(folders: FolderLike[]): Array<{ id: string; label: string; depth: number }> {
  const list = Array.isArray(folders) ? folders : [];
  const childrenByParent = new Map<string | null, FolderLike[]>();
  for (const f of list) {
    const p = f.parentId ?? null;
    const arr = childrenByParent.get(p) || [];
    arr.push(f);
    childrenByParent.set(p, arr);
  }
  for (const [k, arr] of childrenByParent.entries()) {
    arr.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' }));
    childrenByParent.set(k, arr);
  }
  const out: Array<{ id: string; label: string; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = childrenByParent.get(parentId) || [];
    for (const child of children) {
      out.push({ id: child.id, label: child.name, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 250;
const MAX_WIDTH = 600;

export function FileManagerSidebar() {
  const {
    folders,
    docs,
    meta,
    activeTab,
    viewMode,
    searchQuery,
    selectedItemId,
    isLoading,
    error,
    analysisInFlightDocIds,
    analysisErrorsByDocId,
    setActiveTab,
    setViewMode,
    setSearchQuery,
    setSelectedItemId,
    load,
    trash,
    restore,
    trashUnlinked,
    rename,
    move,
    replace,
    analyzeInBackground,
    emptyTrash,
    createFolder,
    renameFolder,
    deleteFolder,
    filterCanvasId,
    filterExts,
    setFilterCanvasId,
    setFilterExts,
  } = useLibraryStore();

  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager : en.fileManager;
  // Общие короткие лейблы (например, “Закрыть”) лучше брать из common,
  // чтобы не плодить дубликаты ключей в каждом модуле.
  const c = language === 'ru' ? ru.common : en.common;

  // ===========================================================================
  // LLM CONFIG (client-side)
  // ===========================================================================
  //
  // Нам нужно знать, есть ли у пользователя API key, чтобы:
  // - корректно объяснять статус "stale" (жёлтый значок "нужен анализ/обновление")
  // - разрешать/запускать ручной анализ по кнопке/пункту контекстного меню.
  //
  // ВАЖНО:
  // - apiKey хранится ТОЛЬКО в памяти (или подхватывается из OS vault), см. useSettingsStore.
  // - Значит отсутствие ключа — нормальный сценарий (offline/без LLM).
  const apiKey = useSettingsStore((s) => s.apiKey);
  const hasApiKey = String(apiKey || '').trim().length > 0;

  const lastSaved = useCanvasStore((s) => s.lastSaved);
  useEffect(() => {
    if (!lastSaved) return;
    void load({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSaved]);

  // ===========================================================================
  // ФИЛЬТРЫ: БОЛЬШЕ НЕ “ПРИВЯЗЫВАЕМ” К АКТИВНОМУ ХОЛСТУ (Variant A)
  // ===========================================================================
  //
  // Контекст (почему мы меняем поведение):
  // - Раньше FileManager автоматически ставил `filterCanvasId = currentCanvasId`.
  // - На сервере фильтр `canvasId` означает “показать документы, которые УЖЕ ИСПОЛЬЗУЮТСЯ
  //   на этом холсте” (см. `/api/library/_shared.ts` → `usedInCanvasIds.includes(canvasId)`).
  // - Новый загруженный файл ещё нигде не используется → он “unlinked”.
  // - Следствие: при авто-фильтре “текущий холст” пользователь НЕ ВИДИТ только что
  //   загруженный файл, пока не снимет фильтр.
  //
  // Это ломает ключевой пользовательский сценарий:
  // - “Загрузил → вижу в списке → перетащил/привязал к карточке”.
  //
  // Решение (вариант A, который вы утвердили):
  // - НЕ синхронизировать filterCanvasId автоматически при смене холста.
  // - Оставить фильтр по холсту только ручным (через панель фильтров).
  //
  // Практический итог для UX:
  // - По умолчанию (filterCanvasId = null) пользователь всегда видит свежие загрузки.
  // - Если пользователь сам выбрал конкретный холст в фильтре — он осознанно получает “used-on-canvas”
  //   выборку, где unlinked файлы скрыты (что логично и предсказуемо).

  const {
    isOpen: isCtxMenuOpen,
    position: ctxMenuPos,
    open: openCtxMenu,
    close: closeCtxMenu,
  } = useContextMenu();

  const [ctxMenuItems, setCtxMenuItems] = useState<ContextMenuItem[]>([]);
  const [ctxPreferLeft, setCtxPreferLeft] = useState<boolean>(true);
  const [ctxPreferTop, setCtxPreferTop] = useState<boolean>(false);
  const [ctxTarget, setCtxTarget] = useState<
    | { kind: 'doc'; doc: FileNode }
    | { kind: 'folder'; folder: FileNode }
    | null
  >(null);

  const [renameDocOpen, setRenameDocOpen] = useState(false);
  const [renameDocId, setRenameDocId] = useState<string>('');
  const [renameDocName, setRenameDocName] = useState<string>('');

  const [moveDocOpen, setMoveDocOpen] = useState(false);
  const [moveDocId, setMoveDocId] = useState<string>('');
  const [moveDocFolderId, setMoveDocFolderId] = useState<string>('');

  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceDocId, setReplaceDocId] = useState<string | null>(null);

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState<string>('');

  const [renameFolderOpen, setRenameFolderOpen] = useState(false);
  const [renameFolderId, setRenameFolderId] = useState<string>('');
  const [renameFolderName, setRenameFolderName] = useState<string>('');

  const [deleteFolderConfirmOpen, setDeleteFolderConfirmOpen] = useState(false);
  const [deleteFolderId, setDeleteFolderId] = useState<string>('');
  const [deleteFolderName, setDeleteFolderName] = useState<string>('');

  const [emptyTrashConfirmOpen, setEmptyTrashConfirmOpen] = useState(false);
  /**
   * Подтверждение "убрать файлы без ссылок".
   *
   * Требование пользователя:
   * - без галочки/checkbox (никаких режимов),
   * - это действие НЕ должно дублировать "Очистить корзину",
   * - оно просто перемещает в корзину "живые" документы без ссылок.
   */
  const [trashUnlinkedConfirmOpen, setTrashUnlinkedConfirmOpen] = useState(false);
  const [isReindexingUsage, setIsReindexingUsage] = useState(false);
  const [trashUsedConfirmOpen, setTrashUsedConfirmOpen] = useState(false);
  const [trashUsedDoc, setTrashUsedDoc] = useState<FileNode | null>(null);

  // ===========================================================================
  // LLM ANALYZE UX (manual "repair" action)
  // ===========================================================================
  //
  // Пользовательский сценарий, который вы описали:
  // - пользователь загрузил файл, но у него нет API key → LLM-анализ не может выполниться
  // - UI показывает "stale" (нужен анализ/обновление), но пользователь не понимает, что делать
  //
  // Мы решаем это двумя шагами:
  // 1) добавляем явное действие "Обновить данные LLM" в контекстное меню файла
  // 2) если ключа нет — показываем маленький диалог с понятным объяснением
  //
  // Почему диалог, а не "disabled item":
  // - наш ContextMenu не показывает tooltip для disabled элементов
  // - поэтому лучше дать пользователю явное объяснение по клику.
  const [llmMissingKeyOpen, setLlmMissingKeyOpen] = useState(false);
  const [llmMissingKeyDoc, setLlmMissingKeyDoc] = useState<FileNode | null>(null);
  // В диалоге подтверждения удаления (если файл используется) показываем
  // список карточек, чтобы пользователь понимал, что “контекст устареет”.
  //
  // Для этого нам нужно:
  // - по canvasId подгрузить данные нод (/api/canvas/:id),
  // - извлечь из них читаемые заголовки (prompt/title),
  // - закэшировать, чтобы не запрашивать один и тот же холст повторно.
  const [trashUsageNodeNamesCache, setTrashUsageNodeNamesCache] = useState<NodeNamesCache>({});
  const [trashUsageLoadingCanvasIds, setTrashUsageLoadingCanvasIds] = useState<Set<string>>(new Set());

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [extInput, setExtInput] = useState<string>(() => (filterExts && filterExts.length ? filterExts.join(', ') : ''));

  // PREVIEW MODAL STATE
  const [previewFile, setPreviewFile] = useState<FileNode | null>(null);

  // Custom Select State
  const [isCanvasSelectOpen, setIsCanvasSelectOpen] = useState(false);
  const canvasSelectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (canvasSelectRef.current && !canvasSelectRef.current.contains(event.target as Node)) {
        setIsCanvasSelectOpen(false);
      }
    };
    if (isCanvasSelectOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isCanvasSelectOpen]);

  useEffect(() => {
    setExtInput(filterExts && filterExts.length ? filterExts.join(', ') : '');
  }, [filterExts]);

  const canvases = useWorkspaceStore((s) => s.canvases);
  // Важно: activeCanvasId — “активный” холст из workspace-стора (тот, что открыт),
  // его используем для:
  // - сравнения “текущий холст” в UI,
  // - корректного поведения перехода к карточке (focusNodeOnCanvas).
  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);
  // Ноды активного холста уже в памяти — их можно использовать, чтобы показывать
  // названия карточек без дополнительных запросов.
  const activeCanvasNodes = useCanvasStore((s) => s.nodes);

  const canvasOptions = (canvases || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru', { sensitivity: 'base' }));

  const selectedCanvasLabel = useMemo(() => {
    if (!filterCanvasId) return t.all;
    const found = canvasOptions.find((c) => c.id === filterCanvasId);
    return found ? found.name || found.id : filterCanvasId;
  }, [filterCanvasId, canvasOptions, t.all]);

  /**
   * Получить “человеческое” имя холста по id.
   * Если холст неизвестен (например, удалён) — возвращаем id.
   */
  const getCanvasName = (canvasId: string): string => {
    const canvas = (canvases || []).find((c) => c.id === canvasId);
    return canvas?.name || canvasId;
  };

  /**
   * Получить “человеческое” имя карточки (вопрос/заголовок) по nodeId.
   *
   * Приоритет:
   * 1) активный холст (данные уже в памяти),
   * 2) кэш (если мы уже подгружали другой холст),
   * 3) fallback: nodeId.
   */
  const getNodeName = (canvasId: string, nodeId: string): string => {
    if (canvasId === activeCanvasId && activeCanvasNodes) {
      const node = activeCanvasNodes.find((n) => n.id === nodeId);
      const text = String(node?.data?.prompt || node?.data?.title || '').trim();
      if (text) return truncateText(text, 60);
    }

    const cached = trashUsageNodeNamesCache[canvasId]?.[nodeId];
    if (cached) return truncateText(cached, 60);

    return nodeId;
  };

  /**
   * Подгрузить данные другого холста, чтобы показать читаемые названия карточек.
   * (Нужно только для предупреждения при удалении файла.)
   */
  const loadCanvasNodesDataForTrashWarning = async (canvasId: string) => {
    const id = String(canvasId || '').trim();
    if (!id) return;
    if (id === activeCanvasId) return;
    if (trashUsageLoadingCanvasIds.has(id)) return;
    if (trashUsageNodeNamesCache[id]) return;

    setTrashUsageLoadingCanvasIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/canvas/${id}`);
      if (!res.ok) return;

      const data = await res.json();
      const nodes = data?.nodes || [];

      const nodeNames: Record<string, string> = {};
      for (const node of nodes) {
        const nodeId = String(node?.id || '').trim();
        if (!nodeId) continue;
        const text = String(node?.data?.prompt || node?.data?.title || '').trim();
        if (text) nodeNames[nodeId] = text;
      }

      setTrashUsageNodeNamesCache((prev) => ({ ...prev, [id]: nodeNames }));
    } catch (e) {
      // Ошибка подгрузки имён не должна блокировать пользователя.
      console.warn('[FileManager] Failed to load canvas nodes for trash warning:', id, e);
    } finally {
      setTrashUsageLoadingCanvasIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  /**
   * При открытии диалога “файл используется” подгружаем данные холстов,
   * чтобы превратить nodeId в читаемые заголовки карточек.
   */
  useEffect(() => {
    if (!trashUsedConfirmOpen) return;
    if (!trashUsedDoc) return;

    const links = trashUsedDoc.canvasNodeLinks || [];
    for (const link of links) {
      void loadCanvasNodesDataForTrashWarning(link.canvasId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashUsedConfirmOpen, trashUsedDoc, activeCanvasId]);

  /**
   * “Фокус” на карточке, которая использует файл:
   * - ставим searchTargetNodeId, чтобы холст подсветил/выделил нужную ноду,
   * - если холст другой — открываем его.
   */
  const focusNodeOnCanvas = (canvasId: string, nodeId: string) => {
    const targetCanvasId = String(canvasId || '').trim();
    const targetNodeId = String(nodeId || '').trim();
    if (!targetCanvasId || !targetNodeId) return;

    const ws = useWorkspaceStore.getState();
    const current = String(ws.activeCanvasId || '').trim();

    useCanvasStore.getState().setSearchTargetNodeId(targetNodeId);
    if (current && current === targetCanvasId) return;
    ws.openCanvas(targetCanvasId);
  };

  useEffect(() => {
    // Вкладки переключаются часто, поэтому тут держим логику максимально простой и предсказуемой.
    //
    // Требование:
    // - В "Корзине": никаких фильтров (canvas/ext) и даже UI панели фильтров.
    // - В "Файлах": возвращаемся к списку “живых” документов с ТЕКУЩИМИ (ручными) фильтрами.
    //
    // ВАЖНО (Variant A):
    // - Мы больше НЕ навязываем filterCanvasId = “текущий холст”.
    // - Это нужно, чтобы пользователь видел свежезагруженные файлы сразу после upload
    //   (они unlinked и иначе пропадут из выборки “used-on-canvas”).

    // UX: если пользователь переключился на корзину, закрываем панель фильтров,
    // чтобы не было ощущения, что они применяются (даже если ранее панель была открыта).
    if (activeTab === 'trash') {
      setIsFiltersOpen(false);
      // Грузим корзину. Store `load()` проигнорирует canvas/ext фильтры автоматически.
      load({ trashed: true, q: searchQuery });
      return;
    }

    // activeTab === 'files':
    // Загружаем “живые” документы (НЕ корзину).
    //
    // Важно:
    // - мы НЕ передаём сюда canvasId/exts специально:
    //   store сам возьмёт текущие значения `filterCanvasId`/`filterExts` из Zustand state.
    // - это гарантирует, что FileManager ведёт себя одинаково для:
    //   - ручной смены фильтров,
    //   - программной перезагрузки списка (refresh),
    //   - переключения вкладок.
    load({ trashed: false, q: searchQuery });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const applyExtFilter = () => {
    const exts = parseExtInput(extInput);
    setFilterExts(exts);
    void load({ trashed: activeTab === 'trash', q: searchQuery });
  };

  const applyCanvasFilter = (canvasId: string | null) => {
    setFilterCanvasId(canvasId);
    void load({ trashed: activeTab === 'trash', q: searchQuery });
  };

  const clearFilters = () => {
    setFilterCanvasId(null);
    setFilterExts([]);
    setExtInput('');
    void load({ trashed: activeTab === 'trash', q: searchQuery });
  };

  const removeExtChip = (ext: string) => {
    const next = (filterExts || []).filter((x) => x !== ext);
    setFilterExts(next);
    setExtInput(next.join(', '));
    void load({ trashed: activeTab === 'trash', q: searchQuery });
  };

  const folderItems: FileNode[] = useMemo(
    () =>
      folders.map((f) => ({
        id: f.id,
        name: f.name,
        type: 'other',
        isDirectory: true,
        parentId: f.parentId,
        size: '',
        sizeBytes: undefined,
        updatedAt: formatRelativeTime(f.updatedAt, t),
        updatedAtTs: f.updatedAt,
      })),
    // `t` участвует в formatRelativeTime (локализация "time ago"),
    // поэтому добавляем его в зависимости.
    [folders, t]
  );

  const docItems: FileNode[] = useMemo(
    () =>
      docs.map((d) => ({
        id: d.docId,
        docId: d.docId,
        name: d.name,
        type: d.kind === 'image' ? 'image' : 'other',
        isDirectory: false,
        parentId: d.folderId,
        size: formatBytes(d.sizeBytes),
        sizeBytes: d.sizeBytes,
        mime: d.mime,
        fileHash: d.fileHash,
        fileUpdatedAt: d.fileUpdatedAt,
        updatedAt: formatRelativeTime(d.fileUpdatedAt, t),
        updatedAtTs: d.fileUpdatedAt,
        status: (() => {
          const docId = d.docId;
          if (analysisInFlightDocIds && analysisInFlightDocIds[docId]) return 'processing';
          const errMsg = analysisErrorsByDocId ? analysisErrorsByDocId[docId] : undefined;
          if (errMsg) return 'error';

          const isTextReady =
            d.kind === 'text' && Boolean(d.analysis?.summary) && d.analysis?.summaryForFileHash === d.fileHash;
          const isImageReady =
            d.kind === 'image' &&
            Boolean(d.analysis?.image?.description) &&
            d.analysis?.imageForFileHash === d.fileHash;
          const isReady = d.kind === 'text' ? isTextReady : isImageReady;
          return isReady ? 'ready' : 'stale';
        })(),
        statusHint: (() => {
          const docId = d.docId;
          if (analysisInFlightDocIds && analysisInFlightDocIds[docId]) {
            return t.processing;
          }
          const errMsg = analysisErrorsByDocId ? analysisErrorsByDocId[docId] : undefined;
          if (errMsg) {
            // ВАЖНО:
            // - ошибки анализа — это UX-слой (сервер не хранит "причину" в индексе),
            // - поэтому мы показываем их как tooltip на красном значке.
            return `${t.fileItem.errorFallback}: ${errMsg}`;
          }

          // Если анализ не в процессе и явной ошибки нет, но документ "не ready" —
          // значит не хватает актуального summary/description для текущего fileHash.
          //
          // Это НЕ всегда "ошибка". Частые случаи:
          // - пользователь только что загрузил файл (анализ ещё не успел завершиться),
          // - у пользователя нет API key (анализ не может выполниться вообще),
          // - пользователь отключил/не использует LLM (offline сценарий).
          const isTextReady =
            d.kind === 'text' && Boolean(d.analysis?.summary) && d.analysis?.summaryForFileHash === d.fileHash;
          const isImageReady =
            d.kind === 'image' &&
            Boolean(d.analysis?.image?.description) &&
            d.analysis?.imageForFileHash === d.fileHash;
          const isReady = d.kind === 'text' ? isTextReady : isImageReady;

          if (!isReady) {
            // Текст подсказки завязан на наличие API key:
            // - если ключа нет → объясняем, что без ключа LLM-анализ невозможен,
            // - если ключ есть → показываем "что делать": ПКМ → "Обновить данные LLM".
            return hasApiKey ? t.fileItem.staleHintWithKey : t.fileItem.staleHintNoKey;
          }

          return undefined;
        })(),
        canvasLinks: d.usedInCanvasIds || [],
        canvasNodeLinks: d.usedIn,
        previewUrl:
          d.kind === 'image'
            ? (() => {
                const v = String(d.fileHash || d.fileUpdatedAt || '').trim();
                return `/api/library/file/${d.docId}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
              })()
            : undefined,
        trashedAt: d.trashedAt,
        summary: d.analysis?.summary || '',
        excerpt: d.analysis?.excerpt || '',
        imageDescription: d.analysis?.image?.description || '',
      })),
    // hasApiKey влияет на подсказку staleHint*
    [docs, analysisInFlightDocIds, analysisErrorsByDocId, hasApiKey, t]
  );

  const items: FileNode[] = useMemo(
    () => (activeTab === 'trash' ? docItems : [...folderItems, ...docItems]),
    [activeTab, folderItems, docItems]
  );

  const activeFiltersCount = (filterCanvasId ? 1 : 0) + (filterExts ? filterExts.length : 0);
  // Глобальные счётчики для бейджей в UI:
  // - unlinkedCount: сколько "живых" документов без ссылок (для кнопки уборки)
  // - trashedCount: сколько документов в корзине (для бейджа на вкладке "Корзина")
  const unlinkedCount = meta?.unlinkedLiveDocs ?? 0;
  const trashedCount = meta?.trashedDocs ?? 0;

  const toggleFolder = (id: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedFolders(newExpanded);
  };

  const selectedFolderId: string | null = useMemo(() => {
    if (activeTab === 'trash') return null;
    if (!selectedItemId) return null;
    const it = items.find((x) => x.id === selectedItemId) || null;
    if (!it || !it.isDirectory) return null;
    return it.id;
  }, [activeTab, items, selectedItemId]);

  const folderSelectOptions = useMemo(() => buildFolderSelectOptions(folders), [folders]);

  const requestRenameDoc = (doc: FileNode) => {
    const id = String(doc.docId || doc.id || '').trim();
    if (!id) return;
    setRenameDocId(id);
    setRenameDocName(String(doc.name || '').trim());
    setRenameDocOpen(true);
  };

  const requestMoveDoc = (doc: FileNode) => {
    const id = String(doc.docId || doc.id || '').trim();
    if (!id) return;
    setMoveDocId(id);
    setMoveDocFolderId(doc.parentId ? String(doc.parentId) : '');
    setMoveDocOpen(true);
  };

  const requestReplaceDoc = (doc: FileNode) => {
    const id = String(doc.docId || doc.id || '').trim();
    if (!id) return;
    setReplaceDocId(id);
    replaceInputRef.current?.click();
  };

  const requestCreateFolder = (parentId: string | null) => {
    setCreateFolderParentId(parentId);
    setCreateFolderName('');
    setCreateFolderOpen(true);
  };

  const requestRenameFolder = (folder: FileNode) => {
    const id = String(folder.id || '').trim();
    if (!id) return;
    setRenameFolderId(id);
    setRenameFolderName(String(folder.name || '').trim());
    setRenameFolderOpen(true);
  };

  const requestDeleteFolder = (folder: FileNode) => {
    const id = String(folder.id || '').trim();
    if (!id) return;
    setDeleteFolderId(id);
    setDeleteFolderName(String(folder.name || '').trim());
    setDeleteFolderConfirmOpen(true);
  };

  const openItemMenu = (e: React.MouseEvent, item: FileNode, opts?: { preferLeft?: boolean; preferTop?: boolean }) => {
    e.preventDefault();
    e.stopPropagation();

    setCtxPreferLeft(Boolean(opts?.preferLeft));
    setCtxPreferTop(Boolean(opts?.preferTop));

    if (item.isDirectory) {
      setCtxTarget({ kind: 'folder', folder: item });
      setCtxMenuItems([
        { id: 'folder.create', label: t.actions.createSubfolder, icon: FolderPlus },
        { id: 'folder.rename', label: t.actions.rename, icon: Pencil },
        { id: 'folder.delete', label: t.actions.delete, icon: Trash2, danger: true, dividerBefore: true },
      ]);
    } else {
      setCtxTarget({ kind: 'doc', doc: item });

      const base: ContextMenuItem[] = [
        { id: 'doc.open', label: t.actions.open, icon: ExternalLink },
        { id: 'doc.download', label: t.actions.download, icon: Download },
      ];

      const actionsFiles: ContextMenuItem[] = [
        { id: 'doc.rename', label: t.actions.rename, icon: Pencil, dividerBefore: true },
        { id: 'doc.move', label: t.actions.move, icon: ArrowRightLeft },
        { id: 'doc.replace', label: t.actions.replace, icon: RefreshCw },
        {
          id: 'doc.analyze',
          label: t.actions.analyzeLlm,
          icon: Sparkles,
          // Не отключаем пункт при отсутствии API key:
          // - иначе пользователь не увидит объяснения "почему нельзя",
          // - а disabled пункты не имеют tooltip в текущем ContextMenu.
          // Вместо этого мы покажем диалог при клике (см. onSelectContextMenuItem).
          disabled: item.status === 'processing',
        },
        { id: 'doc.trash', label: t.actions.trash, icon: Trash2, danger: true, dividerBefore: true },
      ];

      const actionsTrash: ContextMenuItem[] = [
        { id: 'doc.restore', label: t.actions.restore, icon: RotateCcw, dividerBefore: true },
      ];

      setCtxMenuItems(activeTab === 'trash' ? [...base, ...actionsTrash] : [...base, ...actionsFiles]);
    }

    openCtxMenu(e);
  };

  const onSelectContextMenuItem = async (itemId: string) => {
    const tItem = ctxTarget;
    if (!tItem) return;

    const getDocId = (doc: FileNode) => String(doc.docId || doc.id || '').trim();
    const getDocFileUrl = (doc: FileNode) => {
      const id = getDocId(doc);
      if (!id) return '';
      const v = String(doc.fileHash || doc.fileUpdatedAt || '').trim();
      return `/api/library/file/${id}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
    };

    try {
      if (tItem.kind === 'doc') {
        const doc = tItem.doc;
        const docId = getDocId(doc);
        const url = getDocFileUrl(doc);
        if (!docId) return;

        if (itemId === 'doc.open') {
          // Open PREVIEW MODAL instead of window.open for "Open" action
          setPreviewFile(doc);
          return;
        }
        if (itemId === 'doc.download') {
          if (url) window.open(url, '_blank');
          return;
        }
        if (itemId === 'doc.rename') {
          requestRenameDoc(doc);
          return;
        }
        if (itemId === 'doc.move') {
          requestMoveDoc(doc);
          return;
        }
        if (itemId === 'doc.replace') {
          requestReplaceDoc(doc);
          return;
        }
        if (itemId === 'doc.analyze') {
          // Ручной запуск LLM-анализа (summary для текста / description для изображений).
          //
          // Почему ручной запуск нужен:
          // - если в момент загрузки файла не было API key, автозапуск анализа пропускается
          // - пользователь позже добавляет ключ и хочет "досчитать" метаданные
          // - также это способ "починить" недостающие summary/description, если они не появились
          //
          // Поведение:
          // - если API key есть → запускаем analyzeInBackground([docId]) (batch из 1 элемента)
          // - если ключа нет → показываем диалог с объяснением
          if (!hasApiKey) {
            setLlmMissingKeyDoc(doc);
            setLlmMissingKeyOpen(true);
            return;
          }
          // Fire-and-forget: UI не должен "висеть" на сетевом запросе.
          void analyzeInBackground([docId]);
          return;
        }
        if (itemId === 'doc.trash') {
          // Документ может иметь:
          // - упрощённые ссылки (canvasLinks),
          // - детализированные ссылки (canvasNodeLinks: canvasId + nodeIds).
          // Для предупреждения считаем “используется”, если есть что-то из этого.
          const usedCanvasCount = Array.isArray(doc.canvasLinks) ? doc.canvasLinks.length : 0;
          const usedDetailedCount = Array.isArray(doc.canvasNodeLinks) ? doc.canvasNodeLinks.length : 0;
          const usedCount = Math.max(usedCanvasCount, usedDetailedCount);

          if (usedCount > 0) {
            setTrashUsedDoc(doc);
            setTrashUsedConfirmOpen(true);
            return;
          }
          await trash(docId);
          if (selectedItemId === docId) setSelectedItemId(null);
          return;
        }
        if (itemId === 'doc.restore') {
          await restore(docId);
          if (selectedItemId === docId) setSelectedItemId(null);
          return;
        }
      }

      if (tItem.kind === 'folder') {
        const folder = tItem.folder;
        const folderId = String(folder.id || '').trim();
        if (!folderId) return;

        if (itemId === 'folder.create') {
          requestCreateFolder(folderId);
          return;
        }
        if (itemId === 'folder.rename') {
          requestRenameFolder(folder);
          return;
        }
        if (itemId === 'folder.delete') {
          requestDeleteFolder(folder);
          return;
        }
      }
    } finally {
      closeCtxMenu();
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const renderTree = (parentId: string | null = null, level = 0) => {
    const currentItems = items.filter((f) => f.parentId === parentId);
    
    const sortedItems = currentItems.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
      return a.isDirectory ? -1 : 1;
    });

    return sortedItems.map(item => {
      if (item.isDirectory) {
        const isOpen = expandedFolders.has(item.id);
        return (
          <div key={item.id}>
            <FolderItem 
              folder={item}
              level={level}
              isOpen={isOpen}
              isSelected={selectedItemId === item.id}
              onToggle={() => toggleFolder(item.id)}
              onSelect={() => setSelectedItemId(item.id)}
              onOpenMenu={openItemMenu}
            />
            {isOpen && <div className="ml-0">{renderTree(item.id, level + 1)}</div>}
          </div>
        );
      } else {
        return (
          <div key={item.id} style={{ paddingLeft: `${level * 12 + 8}px` }}>
            <FileItem 
              file={item} 
              isSelected={selectedItemId === item.id}
              viewMode={viewMode}
              onClick={() => setSelectedItemId(item.id)}
              onDoubleClick={() => setPreviewFile(item)}
              onOpenMenu={openItemMenu}
            />
          </div>
        );
      }
    });
  };

  if (isCollapsed) {
    return (
      <div className="h-full w-12 bg-[#1e1e2e] border-l border-[#313244] flex flex-col items-center py-4 gap-4 z-50">
        <button 
          onClick={() => setIsCollapsed(false)}
          className="p-2 rounded-lg bg-[#313244] text-[#cdd6f4] hover:bg-[#45475a]"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
        </button>
      </div>
    );
  }

  return (
    <aside
      className="h-full relative flex flex-col bg-[#1e1e2e]/95 backdrop-blur-md border-l border-[#313244]/80 shadow-2xl z-50"
      style={{ width }}
    >
      <div
        onMouseDown={handleResizeStart}
        className={cn(
          "absolute top-0 left-0 bottom-0 w-1 cursor-col-resize z-50 hover:bg-[#89b4fa]/50 transition-colors",
          isResizing && "bg-[#89b4fa]"
        )}
      >
        <div className="absolute top-1/2 -left-3 p-1 rounded-full bg-[#313244] border border-[#45475a] opacity-0 hover:opacity-100 transition-opacity">
           <GripVertical className="w-3 h-3 text-[#a6adc8]" />
        </div>
      </div>

      {/* HEADER */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-[#313244]/60 bg-[#181825]/50">
        <div className="flex items-center gap-2">
          <button 
             onClick={() => setIsCollapsed(true)}
             className="p-1.5 -ml-1.5 rounded-lg text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#313244] transition-all"
             // Tooltip: это именно “свернуть панель”, а не “закрыть диалог”.
             // Поэтому используем отдельный ключ `fileManager.collapse`.
             title={t.collapse}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-bold text-[#cdd6f4] tracking-wide flex items-center gap-2">
            <Archive className="w-4 h-4 text-[#89b4fa]" />
            {t.title}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button 
             onClick={() => {
               setActiveTab('files');
               setSelectedItemId(null);
             }}
             className={cn(
               "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
               activeTab === 'files' ? "bg-[#313244] text-[#cdd6f4]" : "text-[#6c7086] hover:text-[#a6adc8]"
             )}
          >
            {t.all}
          </button>
          <button 
             onClick={() => {
               setActiveTab('trash');
               setSelectedItemId(null);
             }}
             className={cn(
               // relative — чтобы разместить бейдж счётчика поверх иконки
               "relative px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
               activeTab === 'trash' ? "bg-[#313244] text-[#f38ba8]" : "text-[#6c7086] hover:text-[#f38ba8]"
             )}
             title={t.trash}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {/* Бейдж на корзине: показывает, что в корзине есть файлы. */}
            {trashedCount > 0 && (
              <span
                className={cn(
                  "absolute -top-1 -right-1 inline-flex items-center justify-center",
                  "min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-none font-semibold",
                  "bg-[#f38ba8]/20 text-[#f38ba8] border border-[#f38ba8]/30"
                )}
                aria-label={t.trashCountAria.replace('{count}', String(trashedCount))}
              >
                {trashedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* BODY */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 w-full">
          <Toolbar 
            viewMode={viewMode} 
            onViewModeChange={setViewMode}
            onSearch={(q) => {
              setSearchQuery(q);
              load({ trashed: activeTab === 'trash', q });
            }}
            onFilterClick={() => setIsFiltersOpen((v) => !v)}
            activeFiltersCount={activeFiltersCount}
            // New Props for Toolbar actions
            onCreateFolder={() => requestCreateFolder(selectedFolderId)}
            onTrashUnlinked={() => setTrashUnlinkedConfirmOpen(true)}
            onEmptyTrash={() => setEmptyTrashConfirmOpen(true)}
            onRefresh={async () => {
                if (isReindexingUsage) return;
                setIsReindexingUsage(true);
                try {
                  const res = await fetch('/api/library/reindex-usage', { method: 'POST' });
                  if (!res.ok) throw new Error();
                  await load({ silent: true });
                } catch (e) {
                  console.warn('[FileManager] reindex usage failed:', e);
                } finally {
                  setIsReindexingUsage(false);
                }
            }}
            isReindexing={isReindexingUsage}
            activeTab={activeTab}
            selectedFolderId={selectedFolderId}
            unlinkedCount={unlinkedCount}
          />

          {/* FILTER PANEL
              Важно: в корзине панель фильтров НЕ должна появляться вообще. */}
          {activeTab !== 'trash' && isFiltersOpen && (
            <div className="px-3 pb-3 border-b border-[#313244]/40 bg-[#181825]/30">
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] font-semibold text-[#a6adc8]">{t.filterCanvas}</div>
                
                {/* Custom Canvas Select */}
                <div className="relative" ref={canvasSelectRef}>
                  <button
                    onClick={() => setIsCanvasSelectOpen(!isCanvasSelectOpen)}
                    className={cn(
                      "w-full h-8 px-2 rounded-md flex items-center justify-between",
                      "bg-[#181825]/50 border border-[#313244]/50",
                      "text-[10px] text-[#cdd6f4] transition-colors",
                      "hover:border-[#89b4fa]/50 focus:outline-none",
                      isCanvasSelectOpen && "border-[#89b4fa]/50 ring-1 ring-[#89b4fa]/20"
                    )}
                  >
                    <span className="truncate mr-2">{selectedCanvasLabel}</span>
                    <motion.div
                      animate={{ rotate: isCanvasSelectOpen ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="w-3.5 h-3.5 text-[#6c7086]" />
                    </motion.div>
                  </button>

                  <AnimatePresence>
                    {isCanvasSelectOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -5, scale: 0.95 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute top-full left-0 right-0 mt-1 z-[60] overflow-hidden rounded-md border border-[#313244] bg-[#1e1e2e]/95 backdrop-blur-xl shadow-xl"
                      >
                        <div className="max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-[#313244] p-1">
                          <button
                            onClick={() => {
                              applyCanvasFilter(null);
                              setIsCanvasSelectOpen(false);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-2 py-1.5 rounded text-[10px] text-left transition-colors",
                              !filterCanvasId ? "bg-[#89b4fa]/20 text-[#89b4fa]" : "text-[#cdd6f4] hover:bg-[#313244]"
                            )}
                          >
                            <span>{t.all}</span>
                            {!filterCanvasId && <Check className="w-3 h-3" />}
                          </button>
                          
                          {canvasOptions.map((c) => {
                            const isSelected = filterCanvasId === c.id;
                            return (
                              <button
                                key={c.id}
                                onClick={() => {
                                  applyCanvasFilter(c.id);
                                  setIsCanvasSelectOpen(false);
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-2 py-1.5 rounded text-[10px] text-left transition-colors",
                                  isSelected ? "bg-[#89b4fa]/20 text-[#89b4fa]" : "text-[#cdd6f4] hover:bg-[#313244]"
                                )}
                              >
                                <span className="truncate">{c.name || c.id}</span>
                                {isSelected && <Check className="w-3 h-3 flex-shrink-0 ml-2" />}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-1.5">
                <div className="text-[10px] font-semibold text-[#a6adc8]">{t.filterExt}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={extInput}
                    onChange={(e) => setExtInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyExtFilter();
                      }
                    }}
                    placeholder={t.filterExtPlaceholder}
                    className={cn(
                      "flex-1 h-8 px-2 rounded-md",
                      "bg-[#181825]/50 border border-[#313244]/50",
                      "text-[10px] text-[#cdd6f4] placeholder:text-[#6c7086]",
                      "focus:outline-none focus:border-[#89b4fa]/50"
                    )}
                  />
                  <button
                    onClick={applyExtFilter}
                    className={cn(
                      "h-8 px-2.5 rounded-md",
                      "text-[10px] font-semibold",
                      "bg-[#313244]/40 border border-[#313244]/40 text-[#cdd6f4]",
                      "hover:bg-[#313244]/70 transition-colors"
                    )}
                  >
                    {t.apply}
                  </button>
                </div>

                {filterExts && filterExts.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {filterExts.map((ext) => (
                      <button
                        key={ext}
                        onClick={() => removeExtChip(ext)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-full",
                          "text-[10px] font-semibold",
                          "bg-[#89b4fa]/10 text-[#89b4fa] border border-[#89b4fa]/20",
                          "hover:bg-[#89b4fa]/20 transition-colors"
                        )}
                      >
                        <span>.{ext}</span>
                        <X className="w-3 h-3" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={clearFilters}
                  className={cn(
                    "text-[10px] font-semibold px-2.5 py-1.5 rounded-md",
                    "bg-[#313244]/30 border border-[#313244]/30 text-[#a6adc8]",
                    "hover:bg-[#313244]/60 hover:text-[#cdd6f4] transition-colors"
                  )}
                >
                  {t.reset}
                </button>

                <button
                  onClick={() => setIsFiltersOpen(false)}
                  className={cn(
                    "text-[10px] font-semibold px-2.5 py-1.5 rounded-md",
                    "bg-[#313244]/30 border border-[#313244]/30 text-[#a6adc8]",
                    "hover:bg-[#313244]/60 hover:text-[#cdd6f4] transition-colors"
                  )}
                >
                  {c.close}
                </button>
              </div>
            </div>
          )}
          
          <div className="flex-1 overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-[#313244]">
            <input
              ref={replaceInputRef}
              type="file"
              className="hidden"
              onChange={async (e) => {
                const list = e.target.files;
                const f = list && list.length > 0 ? list[0] : null;
                const docId = String(replaceDocId || '').trim();
                e.target.value = '';
                if (!f || !docId) {
                  setReplaceDocId(null);
                  return;
                }
                try {
                  await replace(docId, f);
                } finally {
                  setReplaceDocId(null);
                }
              }}
            />

            {activeTab !== 'trash' && <UploadZone targetFolderId={selectedFolderId} />}

            {(isLoading || error) && (
              <div className="mx-3 mb-3 text-[10px]">
                {isLoading && <div className="text-[#6c7086]">{t.processing}</div>}
                {error && <div className="text-[#f38ba8] break-words">{error}</div>}
              </div>
            )}
            
            <div className={cn(
              "gap-2",
              viewMode === 'grid' ? "grid grid-cols-2 p-2" : "flex flex-col"
            )}>
              {viewMode === 'list' ? (
                renderTree()
              ) : (
                items.filter(f => !f.isDirectory).map(file => (
                  <FileItem 
                    key={file.id} 
                    file={file} 
                    viewMode="grid"
                    isSelected={selectedItemId === file.id}
                    onClick={() => setSelectedItemId(file.id)}
                    onDoubleClick={() => setPreviewFile(file)}
                    onOpenMenu={openItemMenu}
                  />
                ))
              )}
            </div>
            
            <div className="h-20" />
          </div>
        </div>
      </div>

      <div className="h-8 border-t border-[#313244]/40 bg-[#181825]/80 flex items-center px-4 justify-between text-[10px] text-[#6c7086]">
        <span>
          {activeTab === 'trash'
            ? `${items.filter((x) => !x.isDirectory).length} ${t.trash.toLowerCase()}`
            : t.itemsSelected.replace('{count}', String(docItems.length + folderItems.length))}
        </span>
        <span>{meta ? `${meta.totalDocs} ${t.all.toLowerCase()}` : ''}</span>
      </div>

      <ContextMenu
        isOpen={isCtxMenuOpen}
        position={ctxMenuPos}
        items={ctxMenuItems}
        onSelect={(id) => void onSelectContextMenuItem(id)}
        onClose={closeCtxMenu}
        preferLeft={ctxPreferLeft}
        preferTop={ctxPreferTop}
      />

      {/* RENAME DOC */}
      <Dialog open={renameDocOpen} onOpenChange={(open) => !open && setRenameDocOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.renameDocTitle}</DialogTitle>
            <DialogDescription>{t.dialogs.renameDocDesc.replace('{id}', renameDocId || '—')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Input value={renameDocName} onChange={(e) => setRenameDocName(e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDocOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              onClick={async () => {
                const name = String(renameDocName || '').trim();
                const id = String(renameDocId || '').trim();
                if (!id || !name) return;
                await rename(id, name);
                setRenameDocOpen(false);
              }}
            >
              {t.dialogs.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MOVE DOC */}
      <Dialog open={moveDocOpen} onOpenChange={(open) => !open && setMoveDocOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.moveDocTitle}</DialogTitle>
            <DialogDescription>{t.dialogs.moveDocDesc.replace('{id}', moveDocId || '—')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <select
              value={moveDocFolderId}
              onChange={(e) => setMoveDocFolderId(e.target.value)}
              className={cn(
                "w-full h-9 px-3 rounded-md",
                "bg-background border border-input",
                "text-sm",
                "focus:outline-none focus:ring-1 focus:ring-ring"
              )}
            >
              <option value="">{t.root}</option>
              {folderSelectOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {`${'— '.repeat(opt.depth)}${opt.label}`}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDocOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              onClick={async () => {
                const id = String(moveDocId || '').trim();
                if (!id) return;
                const folderIdOrNull = moveDocFolderId ? String(moveDocFolderId) : null;
                await move(id, folderIdOrNull);
                setMoveDocOpen(false);
              }}
            >
              {t.actions.move}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CREATE FOLDER */}
      <Dialog open={createFolderOpen} onOpenChange={(open) => !open && setCreateFolderOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.createFolderTitle}</DialogTitle>
            <DialogDescription>
              {createFolderParentId ? `${t.uploadingTo} ${createFolderParentId}` : `${t.uploadingTo} ${t.root}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Input value={createFolderName} onChange={(e) => setCreateFolderName(e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateFolderOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              onClick={async () => {
                const name = String(createFolderName || '').trim();
                if (!name) return;
                await createFolder(name, createFolderParentId);
                setCreateFolderOpen(false);
              }}
            >
              {t.dialogs.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RENAME FOLDER */}
      <Dialog open={renameFolderOpen} onOpenChange={(open) => !open && setRenameFolderOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.renameFolderTitle}</DialogTitle>
            <DialogDescription>{t.dialogs.renameFolderDesc.replace('{id}', renameFolderId || '—')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Input value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)} />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameFolderOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              onClick={async () => {
                const id = String(renameFolderId || '').trim();
                const name = String(renameFolderName || '').trim();
                if (!id || !name) return;
                await renameFolder(id, name);
                setRenameFolderOpen(false);
              }}
            >
              {t.dialogs.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE FOLDER CONFIRM */}
      <Dialog open={deleteFolderConfirmOpen} onOpenChange={(open) => !open && setDeleteFolderConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.deleteFolderTitle}</DialogTitle>
            <DialogDescription>
              {t.dialogs.deleteFolderDesc}
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            <div className="font-semibold">{deleteFolderName || '—'}</div>
            <div className="text-xs text-muted-foreground break-all">
              {t.dialogs.renameFolderDesc.replace('{id}', deleteFolderId || '—')}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteFolderConfirmOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const id = String(deleteFolderId || '').trim();
                if (!id) return;
                await deleteFolder(id);
                if (selectedItemId === id) setSelectedItemId(null);
                setDeleteFolderConfirmOpen(false);
              }}
            >
              {t.dialogs.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EMPTY TRASH CONFIRM */}
      <Dialog open={emptyTrashConfirmOpen} onOpenChange={(open) => !open && setEmptyTrashConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.emptyTrashTitle}</DialogTitle>
            <DialogDescription>
              {t.dialogs.emptyTrashDesc}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmptyTrashConfirmOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                await emptyTrash();
                setEmptyTrashConfirmOpen(false);
              }}
            >
              {t.emptyTrash}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TRASH UNLINKED CONFIRM */}
      <Dialog
        open={trashUnlinkedConfirmOpen}
        onOpenChange={(open) => !open && setTrashUnlinkedConfirmOpen(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.trashUnlinkedTitle}</DialogTitle>
            <DialogDescription>
              {t.dialogs.trashUnlinkedDesc.replace('{count}', String(unlinkedCount))}
            </DialogDescription>
          </DialogHeader>

          {/* 
            Важно для UX:
            - никаких дополнительных чекбоксов/режимов (как вы просили),
            - операция мягкая: файлы НЕ удаляются навсегда, а попадают в корзину.
          */}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTrashUnlinkedConfirmOpen(false)}>
              {t.dialogs.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={unlinkedCount <= 0}
              onClick={async () => {
                // Если нечего переносить — просто закрываем.
                if (unlinkedCount <= 0) {
                  setTrashUnlinkedConfirmOpen(false);
                  return;
                }
                await trashUnlinked();
                setTrashUnlinkedConfirmOpen(false);
              }}
            >
              {t.actions.trash}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TRASH USED DOC CONFIRM */}
      <Dialog open={trashUsedConfirmOpen} onOpenChange={(open) => !open && setTrashUsedConfirmOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.trashUsedTitle}</DialogTitle>
            <DialogDescription>
              {t.dialogs.trashUsedDesc}
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm space-y-3">
            <div className="font-semibold break-words">{trashUsedDoc?.name || '—'}</div>

            {/* 
              ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ (требование пользователя):
              - файл будет перемещён в корзину,
              - карточки, которые ссылались на него, останутся со ссылками,
              - но их контекст станет устаревшим (stale), т.к. источник контента “спрятан”.
              
              Поэтому показываем список карточек, чтобы пользователь заранее видел,
              какие места нужно будет проверить/перегенерировать.
            */}
            <div className="rounded-lg border border-[#313244] bg-[#181825] p-3 space-y-3">
              <div className="text-[11px] font-semibold text-[#cdd6f4] uppercase tracking-wider opacity-80">
                {t.preview.linksUsedIn}{' '}
                {trashUsedDoc?.canvasNodeLinks?.length || trashUsedDoc?.canvasLinks?.length || 0}{' '}
                {t.preview.linksCanvases}
              </div>

              {trashUsedDoc?.canvasNodeLinks && trashUsedDoc.canvasNodeLinks.length > 0 ? (
                <div className="space-y-3">
                  {trashUsedDoc.canvasNodeLinks.map((link) => {
                    const canvasName = getCanvasName(link.canvasId);
                    const isCurrentCanvas = link.canvasId === activeCanvasId;
                    const isLoadingCanvas = trashUsageLoadingCanvasIds.has(link.canvasId);

                    return (
                      <div
                        key={link.canvasId}
                        className="rounded-md border border-[#313244] bg-[#1e1e2e] overflow-hidden shadow-sm"
                      >
                        <div className="flex items-center gap-2 px-3 py-2 bg-[#252535] border-b border-[#313244]">
                          <div
                            className={cn(
                              'w-2 h-2 rounded-full shrink-0',
                              isCurrentCanvas ? 'bg-[#a6e3a1]' : 'bg-[#89b4fa]'
                            )}
                          />
                          <div className="text-xs font-semibold text-[#cdd6f4] truncate flex-1" title={canvasName}>
                            {canvasName}
                          </div>
                          {isCurrentCanvas && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#a6e3a1]/10 text-[#a6e3a1] font-medium border border-[#a6e3a1]/20">
                              {t.preview.currentCanvasBadge}
                            </span>
                          )}
                          {isLoadingCanvas && <span className="text-[10px] text-[#6c7086]">{t.processing}</span>}
                        </div>

                        {link.nodeIds && link.nodeIds.length > 0 ? (
                          <div className="p-1 space-y-1">
                            {link.nodeIds.map((nodeId) => {
                              const nodeName = getNodeName(link.canvasId, nodeId);
                              const isNodeIdOnly = nodeName === nodeId;

                              return (
                                <button
                                  key={nodeId}
                                  onClick={() => focusNodeOnCanvas(link.canvasId, nodeId)}
                                  className="w-full text-left rounded px-2 py-1.5 hover:bg-[#313244] transition-colors group"
                                  title={nodeName}
                                >
                                  <div className="flex flex-col gap-0.5">
                                    <div
                                      className={cn(
                                        'text-xs truncate font-medium group-hover:text-white transition-colors',
                                        isNodeIdOnly ? 'text-[#a6adc8] font-mono' : 'text-[#cdd6f4]'
                                      )}
                                    >
                                      {nodeName}
                                    </div>
                                    {!isNodeIdOnly && (
                                      <div className="text-[10px] text-[#6c7086] font-mono truncate group-hover:text-[#9399b2] transition-colors">
                                        {nodeId}
                                      </div>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-[11px] text-[#6c7086] italic">{t.preview.linksNoCards}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-[#6c7086] italic px-2">{t.preview.linksNoLinks}</div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTrashUsedConfirmOpen(false);
                setTrashUsedDoc(null);
              }}
            >
              {t.dialogs.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const id = String(trashUsedDoc?.docId || trashUsedDoc?.id || '').trim();
                if (!id) {
                  setTrashUsedConfirmOpen(false);
                  setTrashUsedDoc(null);
                  return;
                }
                try {
                  await trash(id);
                  if (selectedItemId === id) setSelectedItemId(null);
                } finally {
                  setTrashUsedConfirmOpen(false);
                  setTrashUsedDoc(null);
                }
              }}
            >
              {t.actions.trash}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LLM MISSING KEY (manual analyze) */}
      <Dialog
        open={llmMissingKeyOpen}
        onOpenChange={(open) => {
          // Закрывая диалог, очищаем "цель" — чтобы при следующем открытии не показывать устаревшее имя.
          if (!open) {
            setLlmMissingKeyOpen(false);
            setLlmMissingKeyDoc(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.dialogs.llmMissingKeyTitle}</DialogTitle>
            <DialogDescription>
              {t.dialogs.llmMissingKeyDesc.replace('{name}', String(llmMissingKeyDoc?.name || '—'))}
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm space-y-2">
            <div className="text-xs text-muted-foreground">
              {/* 
                Важно:
                - сейчас SettingsModal управляется внутри CanvasContent (локальное состояние),
                  а FileManagerSidebar не имеет "глобальной" команды открыть настройки.
                - поэтому мы даём пользователю ясную инструкцию, что нужно сделать вручную.
                
                Если в будущем мы захотим идеальный UX:
                - можно вынести флаг "isSettingsOpen" в отдельный store или event-bus,
                  и тогда кнопка "Открыть настройки" тут сможет реально открыть SettingsModal.
              */}
              {t.dialogs.llmMissingKeyHint}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLlmMissingKeyOpen(false);
                setLlmMissingKeyDoc(null);
              }}
            >
              {c.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PREVIEW MODAL */}
      <FilePreviewModal 
        isOpen={!!previewFile} 
        onClose={() => setPreviewFile(null)} 
        file={previewFile} 
      />
    </aside>
  );
}
