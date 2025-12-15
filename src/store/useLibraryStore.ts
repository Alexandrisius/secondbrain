'use client';

/**
 * @file useLibraryStore.ts
 * @description Zustand store для "глобальной библиотеки документов".
 *
 * Зачем store:
 * - FileManagerSidebar — достаточно сложный UI (поиск, вкладки, выбор, действия),
 * - данные приходят из API (/api/library/*),
 * - удобнее держать это состояние централизованно, чтобы:
 *   - переиспользовать в разных компонентах,
 *   - не плодить prop-drilling,
 *   - иметь единый источник истины по выбранному документу.
 *
 * Важно:
 * - Этот store пока обслуживает только правый сайдбар.
 * - На следующих этапах его можно будет использовать для drag&drop в карточки и для деталей (links).
 */

import { create } from 'zustand';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import type { NodeAttachment, NeuroNodeData } from '@/types/canvas';

// =============================================================================
// TYPES (client-side)
// =============================================================================

/**
 * ============================================================================
 * Upload preflight: конфликты имён
 * ============================================================================
 *
 * Зачем это нужно:
 * - в глобальной библиотеке имя (`doc.name`) — это "display name", а ссылка в canvas хранится по `docId`.
 * - при загрузке файлов пользователь мыслит "именами", поэтому если в выбранной папке уже есть документ
 *   с таким же именем — мы должны явно спросить:
 *   - заменить существующий документ (docId сохранится),
 *   - загрузить как новый документ под новым именем (создастся новый docId),
 *   - пропустить.
 *
 * Важно:
 * - preflight — это только UX-слой. Сервер по умолчанию разрешает загрузить второй документ с тем же именем,
 *   но продуктово мы хотим "always-ask", чтобы не плодить дубликаты по ошибке.
 */

/**
 * Нормализованный ключ для сравнения имён файлов:
 * - lower-case
 * - trim
 *
 * Мы не делаем агрессивную нормализацию (например, NFC), потому что:
 * - это может неожиданно менять семантику для пользователя,
 * - а наша цель — найти очевидные конфликты "визуально одинаковых" имён.
 */
function normalizeNameKey(name: string): string {
  return String(name || '').trim().toLowerCase();
}

/**
 * Кандидат существующего документа, который конфликтует по имени.
 *
 * Мы храним здесь только "безопасный" snapshot, который нужен UI:
 * - docId (куда заменять)
 * - метаданные для отображения
 *
 * Важно:
 * - fileUpdatedAt — "версия файла" (для cache-bust и stale-логики)
 * - createdAt — fallback для отображения, если fileUpdatedAt отсутствует/сломано
 */
export type UploadConflictCandidate = Pick<
  LibraryDocDTO,
  'docId' | 'name' | 'folderId' | 'kind' | 'mime' | 'sizeBytes' | 'fileHash' | 'fileUpdatedAt' | 'createdAt'
>;

/**
 * Один конфликт: один загружаемый файл vs один или несколько документов в папке,
 * у которых совпало имя (по normalizeNameKey()).
 */
export type UploadConflict = {
  /**
   * Оригинальный File объект из input/drag&drop.
   *
   * Важно:
   * - мы храним ссылку на объект, чтобы потом:
   *   - заменить существующий docId (replace),
   *   - или сделать upload как новый документ (upload-as-new).
   */
  file: File;

  /** Нормализованное имя (ключ сравнения). */
  normalizedNameKey: string;

  /** Список кандидатов в выбранной папке, совпавших по имени. */
  candidates: UploadConflictCandidate[];
};

/**
 * Результат preflight проверки перед upload:
 * - safe: файлы, которые не конфликтуют и могут быть загружены "как есть"
 * - conflicts: файлы, которые требуют решения пользователя
 */
export type UploadPreflightResult = {
  conflicts: UploadConflict[];
  safe: File[];
};

/**
 * Сырые типы ответа API.
 *
 * Почему не импортируем из src/lib/libraryIndex.ts:
 * - Этот store — клиентский (use client),
 * - а src/lib/libraryIndex.ts использует Node.js fs и предназначен для сервера.
 *
 * Поэтому мы держим “shape” ответов как отдельные типы на клиенте.
 */
export type LibraryFolderDTO = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type LibraryDocDTO = {
  docId: string;
  name: string;
  folderId: string | null;
  kind: 'image' | 'text';
  mime: string;
  sizeBytes: number;
  fileHash: string;
  fileUpdatedAt: number;
  createdAt: number;
  trashedAt?: number;
  analysis?: {
    /**
     * “Дешёвое” превью для текста (без LLM).
     * Оно может существовать сразу после upload/replace и полезно как fallback.
     */
    excerpt?: string;

    /**
     * LLM-суммаризация для текстовых документов.
     *
     * Важно:
     * - актуальность summary определяется привязкой к fileHash:
     *   summaryForFileHash === doc.fileHash → summary актуален для текущей версии файла.
     * - если hash не совпадает → UI должен считать анализ устаревшим (stale).
     */
    summary?: string;
    summaryForFileHash?: string;

    image?: { description?: string; descriptionLanguage?: string };

    /**
     * LLM-описание изображения (caption-only).
     * Аналогично summary: привязано к fileHash.
     */
    imageForFileHash?: string;

    /**
     * Технические метаданные анализа (для отладки/аудита и будущего UI).
     */
    updatedAt?: number;
    model?: string;
  };
  usedInCanvasIds?: string[];
  /**
   * Детальные ссылки (canvasId + nodeIds).
   *
   * Это поле формируется сервером из `usage-index.json`.
   * UI использует его в панели Details → "Используется в", чтобы:
   * - показать список конкретных карточек
   * - и позволить "перепрыгнуть" к нужной ноде с центрированием/выделением.
   */
  usedIn?: Array<{ canvasId: string; nodeIds: string[] }>;
};

export type LibraryListResponseDTO = {
  version: 1;
  folders: LibraryFolderDTO[];
  docs: Array<LibraryDocDTO & { usedInCanvasIds: string[]; usedIn?: Array<{ canvasId: string; nodeIds: string[] }> }>;
  meta: {
    totalDocs: number;
    totalFolders: number;
    trashedDocs: number;
    /**
     * Количество "живых" документов без ссылок (unlinked).
     *
     * Это поле специально добавлено для UI:
     * - показываем счётчик на кнопке "убрать файлы без ссылок"
     * - чтобы пользователь видел "сколько удалится" (точнее: сколько будет перемещено в корзину)
     *   до того, как нажмёт действие.
     *
     * Важно:
     * - число глобальное (по всей библиотеке), не зависит от текущих фильтров/поиска,
     * - вычисляется на сервере по usage-index.json.
     */
    unlinkedLiveDocs: number;
    updatedAt: number;
  };
};

// =============================================================================
// STORE STATE
// =============================================================================

export type LibraryTab = 'files' | 'trash';
export type LibraryViewMode = 'list' | 'grid';

export interface LibraryStoreState {
  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------
  folders: LibraryFolderDTO[];
  docs: LibraryDocDTO[];
  meta: LibraryListResponseDTO['meta'] | null;

  // ---------------------------------------------------------------------------
  // Background processing state (LLM analyze)
  // ---------------------------------------------------------------------------
  /**
   * docId → true пока мы выполняем /api/library/analyze в фоне.
   *
   * Почему не один общий флаг:
   * - анализ может идти батчами (несколько docIds за раз),
   * - UI должен показывать “processing” точечно, на уровне конкретного файла.
   */
  analysisInFlightDocIds: Record<string, true>;

  /**
   * docId → текст ошибки последнего запуска анализа (best-effort).
   *
   * Важно:
   * - это НЕ “источник истины” (сервер не хранит ошибки анализа в индексе),
   * - это UX-слой: показать пользователю, почему анализ не появился.
   */
  analysisErrorsByDocId: Record<string, string | undefined>;

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  activeTab: LibraryTab;
  viewMode: LibraryViewMode;
  searchQuery: string;
  selectedItemId: string | null; // docId или folderId

  // ---------------------------------------------------------------------------
  // Filters (server-side)
  // ---------------------------------------------------------------------------
  //
  // Эти фильтры напрямую мапятся в query params GET /api/library:
  // - canvasId
  // - ext
  //
  // Почему фильтры храним в store, а не локально в компоненте:
  // - фильтры должны переживать перерендеры и не сбрасываться при “silent refresh”,
  // - их удобно использовать как “источник истины” для формирования URL запроса,
  // - в будущем эти же фильтры могут понадобиться другим компонентам (например, глобальному поиску).
  //
  // Примечание:
  // - folderId фильтр в API уже есть, но в рамках текущего todo мы его UI не делаем.
  filterCanvasId: string | null;
  filterExts: string[];

  // ---------------------------------------------------------------------------
  // Loading / errors
  // ---------------------------------------------------------------------------
  isLoading: boolean;
  error: string | null;
}

export interface LibraryStoreActions {
  // UI setters
  setActiveTab: (tab: LibraryTab) => void;
  setViewMode: (mode: LibraryViewMode) => void;
  setSearchQuery: (q: string) => void;
  setSelectedItemId: (id: string | null) => void;

  // Filters setters
  //
  // Важно:
  // - сами setters НЕ вызывают load() автоматически — это сознательное решение:
  //   UI может хотеть “пачку” изменений применить одной перезагрузкой (например, canvas + ext),
  //   а автоперезагрузка на каждое изменение ухудшит UX (лишние запросы, мерцание isLoading).
  setFilterCanvasId: (canvasId: string | null) => void;
  setFilterExts: (exts: string[]) => void;

  // Data loaders
  load: (opts?: {
    trashed?: boolean;
    q?: string | null;
    canvasId?: string | null;
    exts?: string[] | null;
    /**
     * "Тихая" загрузка списка:
     * - не трогаем isLoading/error (чтобы UI не мигал),
     * - обновляем только folders/docs/meta.
     *
     * Используется для фоновой синхронизации (например, после сохранения холста),
     * когда пользователю важнее "мгновенная консистентность", чем явный индикатор загрузки.
     */
    silent?: boolean;
  }) => Promise<void>;

  /**
   * Проверяет файлы на конфликты имен в указанной папке.
   */
  checkUploadConflicts: (files: File[], folderId: string | null) => Promise<UploadPreflightResult>;

  /**
   * Запускает анализ документов (summary/vision) в фоне.
   *
   * Важно:
   * - этот метод НЕ блокирует UI и НЕ трогает общий isLoading,
   * - он предназначен в первую очередь для автоматического вызова после upload/replace,
   * - ошибки учитываются best-effort в analysisErrorsByDocId.
   */
  analyzeInBackground: (docIds: string[]) => Promise<void>;

  // Mutations
  upload: (files: File[], opts?: { folderId?: string | null }) => Promise<{ success: boolean; docs: LibraryDocDTO[] }>;
  replace: (docId: string, file: File) => Promise<{ success: boolean; doc?: LibraryDocDTO }>;
  rename: (docId: string, name: string) => Promise<void>;
  move: (docId: string, folderId: string | null) => Promise<void>;
  trash: (docId: string) => Promise<void>;
  restore: (docId: string) => Promise<void>;
  /**
   * Переместить в корзину ВСЕ документы без ссылок (unlinked) одним действием.
   *
   * Важно:
   * - Это НЕ "Очистить корзину" и НЕ удаление навсегда.
   * - Это мягкая операция: просто перенос в .trash + trashedAt в индексе.
   */
  trashUnlinked: () => Promise<void>;
  emptyTrash: () => Promise<void>;
  gc: (opts?: { includeLive?: boolean }) => Promise<void>;

  // ---------------------------------------------------------------------------
  // Folders CRUD (UI actions)
  // ---------------------------------------------------------------------------
  /**
   * Создать папку.
   *
   * Почему это в store:
   * - папки — часть "модели библиотеки" (server-side library-index.json),
   * - UI может создавать папки из разных мест (контекстное меню, верхняя панель),
   * - store даёт единый слой вызова API + reload.
   */
  createFolder: (name: string, parentId: string | null) => Promise<void>;

  /**
   * Переименовать папку.
   */
  renameFolder: (folderId: string, name: string) => Promise<void>;

  /**
   * Удалить папку (только если она пустая).
   *
   * Важно:
   * - API вернёт 409 если папка не пустая,
   * - UI должен показать понятную ошибку (мы прокидываем её как store.error).
   */
  deleteFolder: (folderId: string) => Promise<void>;
}

export type LibraryStore = LibraryStoreState & LibraryStoreActions;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Упрощённый helper для обработки HTTP ошибок.
 *
 * Почему так:
 * - fetch() не кидает exception на 4xx/5xx, поэтому нужно явно проверять res.ok.
 */
async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

// =============================================================================
// ACTIVE CANVAS SYNC (Todo D)
// =============================================================================
//
// Мы поддерживаем "мгновенную консистентность" активного холста:
// - server-side операции (rename/replace/analyze) могут пропатчить canvas.json на диске,
//   но открытый холст в UI (in-memory Zustand store) об этом не узнает сразу.
// - поэтому API возвращает `touched` (canvasId + nodeIds),
//   а клиент применяет in-memory патчи через useCanvasStore.updateNodeData().
//
// Важно:
// - Это best-effort: если что-то не совпало, при следующем load холста сработает reconcile.

type TouchedLink = { canvasId: string; nodeIds: string[] };

function getTouchedNodeIdsForActiveCanvas(touched: TouchedLink[] | undefined): string[] {
  const activeCanvasId = useCanvasStore.getState().currentCanvasId;
  if (!activeCanvasId) return [];
  const hit = (touched || []).find((x) => x.canvasId === activeCanvasId) || null;
  return Array.isArray(hit?.nodeIds) ? hit!.nodeIds : [];
}

/**
 * Fallback-поиск nodeIds в АКТИВНОМ холсте по списку docIds.
 *
 * Зачем это нужно (ключ к вашему багу “после upload нет описания изображения”):
 * - API `/api/library/analyze` возвращает `touched`, основываясь на `usage-index.json`.
 * - `usage-index.json` пересчитывается best-effort при сохранении холста на сервере.
 * - Но сценарий "только что загрузили документ и прикрепили его к ноде" ещё НЕ успел
 *   попасть в usage-index (пользователь мог ещё не нажимать Save).
 *
 * В итоге:
 * - анализ на сервере реально произошёл и вернулся в ответе (`docsSnapshot`),
 * - но `touched` пустой → клиент не знает, какие ноды патчить → UI “не показывает” результат.
 *
 * Решение:
 * - если `touched` для активного холста пустой, мы пробегаемся по in-memory `canvas.nodes`
 *   и ищем ноды, где attachments[].attachmentId совпадает с любым docId из batch.
 *
 * ВАЖНО:
 * - это чисто клиентский best-effort (не трогает диск),
 * - derived патч НЕ должен выставлять stale (см. patchDerivedAnalyzeInActiveCanvas),
 * - на следующем сохранении холста сервер всё равно пересчитает usage-index и всё станет консистентно.
 */
function findNodeIdsReferencingDocsInActiveCanvas(docIdsRaw: string[]): string[] {
  const docIds = Array.from(new Set((docIdsRaw || []).map((x) => String(x || '').trim()).filter(Boolean)));
  if (docIds.length === 0) return [];

  const canvas = useCanvasStore.getState();
  const activeCanvasId = canvas.currentCanvasId;
  if (!activeCanvasId) return [];

  const docIdSet = new Set(docIds);
  const out: string[] = [];

  for (const node of canvas.nodes || []) {
    const nodeId = String(node?.id || '').trim();
    if (!nodeId) continue;

    const atts = Array.isArray(node.data?.attachments) ? (node.data.attachments as NodeAttachment[]) : [];
    if (atts.length === 0) continue;

    const hasAny = atts.some((a) => a && docIdSet.has(String(a.attachmentId || '').trim()));
    if (!hasAny) continue;

    out.push(nodeId);
  }

  return out;
}

function patchAttachmentsRenameInActiveCanvas(params: { docId: string; newName: string; nodeIds: string[] }): void {
  const { docId, newName, nodeIds } = params;
  if (!docId || !newName || nodeIds.length === 0) return;

  const canvas = useCanvasStore.getState();
  const updateNodeData = canvas.updateNodeData;

  for (const nodeId of nodeIds) {
    const node = canvas.nodes.find((n) => n.id === nodeId) || null;
    if (!node) continue;

    const atts = Array.isArray(node.data.attachments) ? (node.data.attachments as NodeAttachment[]) : [];
    if (atts.length === 0) continue;

    let changed = false;
    const nextAtts = atts.map((a) => {
      if (!a || a.attachmentId !== docId) return a;
      changed = true;
      return { ...a, originalName: newName };
    });

    if (!changed) continue;
    // ВАЖНО:
    // - rename не должен делать node stale (см. логику сравнения attachments в updateNodeData),
    // - поэтому мы патчим attachments, но рассчитываем на то, что stale не выставится.
    updateNodeData(nodeId, { attachments: nextAtts, updatedAt: Date.now() });
  }
}

function patchAttachmentsReplaceInActiveCanvas(params: { doc: LibraryDocDTO; nodeIds: string[] }): void {
  const { doc, nodeIds } = params;
  const docId = String(doc?.docId || '').trim();
  if (!docId || nodeIds.length === 0) return;

  const canvas = useCanvasStore.getState();
  const updateNodeData = canvas.updateNodeData;

  for (const nodeId of nodeIds) {
    const node = canvas.nodes.find((n) => n.id === nodeId) || null;
    if (!node) continue;

    const atts = Array.isArray(node.data.attachments) ? (node.data.attachments as NodeAttachment[]) : [];
    if (atts.length === 0) continue;

    let changed = false;
    const nextAtts = atts.map((a) => {
      if (!a || a.attachmentId !== docId) return a;
      changed = true;
      return {
        ...a,
        kind: doc.kind,
        mime: doc.mime,
        sizeBytes: doc.sizeBytes,
        fileHash: doc.fileHash,
        fileUpdatedAt: doc.fileUpdatedAt,
        originalName: doc.name,
      };
    });

    if (!changed) continue;
    // Replace — это PRIMARY изменение контекста, поэтому updateNodeData:
    // - пометит владельца stale (если есть response),
    // - и (по существующей логике) сможет каскадить stale на детей.
    updateNodeData(nodeId, { attachments: nextAtts, updatedAt: Date.now() });
  }
}

/**
 * Патчер для УДАЛЕНИЯ вложений из активного холста (in-memory).
 *
 * Вызывается после trash/emptyTrash/gc, когда сервер вернул `touched`.
 *
 * Что делаем:
 * - Для каждого nodeId удаляем `attachments` с `attachmentId === docId`
 * - Чистим `excludedAttachmentIds`
 * - Чистим legacy-поля: `attachmentExcerpts`, `attachmentSummaries`, `attachmentImageDescriptions`
 * - Если у ноды есть `response` → выставляем `isStale = true`
 *
 * Важно:
 * - Это best-effort патч — сервер уже обновил canvas.json на диске,
 *   мы просто синхронизируем in-memory состояние.
 */
function patchAttachmentsRemovedInActiveCanvas(params: {
  docId: string;
  nodeIds: string[];
}): void {
  const { docId, nodeIds } = params;
  if (!docId || nodeIds.length === 0) return;

  const canvas = useCanvasStore.getState();
  const updateNodeData = canvas.updateNodeData;
  const ts = Date.now();

  for (const nodeId of nodeIds) {
    const node = canvas.nodes.find((n) => n.id === nodeId) || null;
    if (!node) continue;

    const patch: Partial<NeuroNodeData> = { updatedAt: ts };
    let changed = false;

    // 1) Удаляем из attachments[]
    const atts = Array.isArray(node.data.attachments)
      ? (node.data.attachments as NodeAttachment[])
      : [];
    if (atts.length > 0) {
      const filtered = atts.filter((a) => a && a.attachmentId !== docId);
      if (filtered.length !== atts.length) {
        patch.attachments = filtered.length > 0 ? filtered : undefined;
        changed = true;
      }
    }

    // 2) Удаляем из excludedAttachmentIds
    const excluded = Array.isArray(node.data.excludedAttachmentIds)
      ? (node.data.excludedAttachmentIds as string[])
      : [];
    if (excluded.length > 0) {
      const filtered = excluded.filter((id) => id !== docId);
      if (filtered.length !== excluded.length) {
        patch.excludedAttachmentIds = filtered.length > 0 ? filtered : undefined;
        changed = true;
      }
    }

    // 3) Чистим legacy-поля
    const safeStringMap = (v: unknown): Record<string, string> => {
      if (!v || typeof v !== 'object') return {};
      const obj = v as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(obj)) {
        if (typeof val === 'string') out[k] = val;
      }
      return out;
    };

    const excerpts = safeStringMap(node.data.attachmentExcerpts);
    const summaries = safeStringMap(node.data.attachmentSummaries);
    const imageDescs = safeStringMap(node.data.attachmentImageDescriptions);

    if (docId in excerpts) {
      delete excerpts[docId];
      patch.attachmentExcerpts = Object.keys(excerpts).length > 0 ? excerpts : undefined;
      changed = true;
    }
    if (docId in summaries) {
      delete summaries[docId];
      patch.attachmentSummaries = Object.keys(summaries).length > 0 ? summaries : undefined;
      changed = true;
    }
    if (docId in imageDescs) {
      delete imageDescs[docId];
      patch.attachmentImageDescriptions = Object.keys(imageDescs).length > 0 ? imageDescs : undefined;
      changed = true;
    }

    // 4) Если есть response — ставим stale
    if (changed && node.data.response) {
      patch.isStale = true;
    }

    if (changed) {
      updateNodeData(nodeId, patch);
    }
  }
}

/**
 * Применяет touched-патчи для удаления вложений в активном холсте.
 *
 * @param touched - массив {canvasId, nodeIds} из ответа API
 * @param docIds - массив docId, которые были удалены
 *
 * Важно:
 * - Если `touched` содержит активный холст, патчим его in-memory.
 * - Для batch операций (emptyTrash/gc) docIds может быть массивом.
 */
function applyTouchedPatchesForRemovedDocs(
  touched: Array<{ canvasId: string; nodeIds: string[] }>,
  docIds: string[]
): void {
  const activeCanvasId = useCanvasStore.getState().currentCanvasId;
  if (!activeCanvasId) return;

  const hit = (touched || []).find((x) => x.canvasId === activeCanvasId) || null;
  if (!hit || !Array.isArray(hit.nodeIds) || hit.nodeIds.length === 0) return;

  // Для каждого docId патчим ноды
  for (const docId of docIds) {
    patchAttachmentsRemovedInActiveCanvas({ docId, nodeIds: hit.nodeIds });
  }
}

function patchDerivedAnalyzeInActiveCanvas(params: {
  docs: Array<{ docId: string; kind: 'text' | 'image'; analysis?: { excerpt?: string; summary?: string; image?: { description?: string } } }>;
  nodeIds: string[];
}): void {
  const { docs, nodeIds } = params;
  if (!Array.isArray(docs) || docs.length === 0 || nodeIds.length === 0) return;

  const byDocId = new Map(docs.map((d) => [d.docId, d] as const));
  const canvas = useCanvasStore.getState();
  const updateNodeData = canvas.updateNodeData;

  for (const nodeId of nodeIds) {
    const node = canvas.nodes.find((n) => n.id === nodeId) || null;
    if (!node) continue;

    const atts = Array.isArray(node.data.attachments) ? (node.data.attachments as NodeAttachment[]) : [];
    if (atts.length === 0) continue;

    // existing maps (best-effort)
    const existingExcerpts =
      node.data.attachmentExcerpts && typeof node.data.attachmentExcerpts === 'object'
        ? (node.data.attachmentExcerpts as Record<string, string>)
        : {};
    const existingSummaries =
      node.data.attachmentSummaries && typeof node.data.attachmentSummaries === 'object'
        ? (node.data.attachmentSummaries as Record<string, string>)
        : {};
    const existingImages =
      node.data.attachmentImageDescriptions && typeof node.data.attachmentImageDescriptions === 'object'
        ? (node.data.attachmentImageDescriptions as Record<string, string>)
        : {};

    const nextExcerpts: Record<string, string> = { ...existingExcerpts };
    const nextSummaries: Record<string, string> = { ...existingSummaries };
    const nextImages: Record<string, string> = { ...existingImages };

    let changed = false;

    for (const a of atts) {
      const id = String(a?.attachmentId || '').trim();
      if (!id) continue;
      const d = byDocId.get(id);
      if (!d) continue;

      if (d.kind === 'text') {
        const ex = (d.analysis?.excerpt || '').trim();
        const sum = (d.analysis?.summary || '').trim();

        if (ex) {
          if (nextExcerpts[id] !== ex) {
            nextExcerpts[id] = ex;
            changed = true;
          }
        }
        if (sum) {
          if (nextSummaries[id] !== sum) {
            nextSummaries[id] = sum;
            changed = true;
          }
        }
        // Для текста image description не применим.
        if (id in nextImages) {
          delete nextImages[id];
          changed = true;
        }
      } else {
        // image
        const desc = (d.analysis?.image?.description || '').trim();
        if (desc) {
          if (nextImages[id] !== desc) {
            nextImages[id] = desc;
            changed = true;
          }
        }
        if (id in nextExcerpts) {
          delete nextExcerpts[id];
          changed = true;
        }
        if (id in nextSummaries) {
          delete nextSummaries[id];
          changed = true;
        }
      }
    }

    if (!changed) continue;
    const patch: Partial<NeuroNodeData> = {
      attachmentExcerpts: Object.keys(nextExcerpts).length > 0 ? nextExcerpts : undefined,
      attachmentSummaries: Object.keys(nextSummaries).length > 0 ? nextSummaries : undefined,
      attachmentImageDescriptions: Object.keys(nextImages).length > 0 ? nextImages : undefined,
      updatedAt: Date.now(),
    };

    // По текущей stale-логике derived изменения не должны делать владельца stale.
    updateNodeData(nodeId, patch);
  }
}

/**
 * Нормализация списка расширений (для фильтра `ext`).
 *
 * Зачем это на уровне store, если UI тоже парсит:
 * - чтобы store оставался устойчивым к любым входам (в т.ч. программным),
 * - чтобы URL всегда формировался в “аккуратном” виде (lower-case, без точек),
 * - чтобы сравнения и отображение были стабильными.
 */
function normalizeExts(extsRaw: string[] | null | undefined): string[] {
  const raw = Array.isArray(extsRaw) ? extsRaw : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const x of raw) {
    const s0 = String(x || '').trim().toLowerCase();
    if (!s0) continue;
    // Удаляем ведущие точки: ".md" -> "md"
    const s = s0.replace(/^\.+/, '');
    if (!s) continue;
    // Отбрасываем очевидный мусор/опасные токены (слэши)
    if (s.includes('/') || s.includes('\\')) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

// =============================================================================
// STORE
// =============================================================================

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  // Data
  folders: [],
  docs: [],
  meta: null,

  // Background processing (LLM analyze)
  analysisInFlightDocIds: {},
  analysisErrorsByDocId: {},

  // UI
  activeTab: 'files',
  viewMode: 'list',
  searchQuery: '',
  selectedItemId: null,

  // Filters
  filterCanvasId: null,
  filterExts: [],

  // Loading
  isLoading: false,
  error: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  setSelectedItemId: (id) => set({ selectedItemId: id }),

  setFilterCanvasId: (canvasId) => set({ filterCanvasId: canvasId }),
  setFilterExts: (exts) => set({ filterExts: normalizeExts(exts) }),

  load: async (opts) => {
    /**
     * Loader списка библиотеки с поддержкой “тихого” refresh.
     *
     * Почему это важно:
     * - обычная загрузка (по клику/поиску) должна показывать isLoading,
     * - но после фоновых событий (например, сохранение холста → пересчитался usage-index)
     *   мы хотим просто подтянуть обновлённые `usedIn/usedInCanvasIds`, не мигнув UI.
     */
    const trashed = opts?.trashed ?? (get().activeTab === 'trash');
    const q = opts?.q ?? get().searchQuery;

    // -------------------------------------------------------------------------
    // IMPORTANT PRODUCT RULE: TRASH IS ALWAYS GLOBAL
    // -------------------------------------------------------------------------
    //
    // Требование пользователя:
    // - на вкладке "Корзина" НЕ должно быть фильтрации по холсту и по расширениям,
    // - пользователь всегда видит ВСЕ удалённые файлы всех холстов.
    //
    // Реализация:
    // - даже если UI/код передаст canvasId/exts в load(), при trashed=true мы их игнорируем.
    //
    // Почему это важно делать именно здесь (в store), а не только в UI:
    // - UI может вызывать load() из разных мест (search, refresh, background refresh),
    // - мы хотим гарантировать инвариант “trash is global” централизованно,
    // - и не зависеть от того, какие пропсы/эффекты забыли обновить в компонентах.
    let canvasId = (opts?.canvasId ?? get().filterCanvasId) || null;
    let exts = normalizeExts(opts?.exts ?? get().filterExts);
    if (trashed) {
      canvasId = null;
      exts = [];
    }
    const silent = Boolean(opts?.silent);

    if (!silent) set({ isLoading: true, error: null });

    try {
      const sp = new URLSearchParams();
      sp.set('trashed', trashed ? 'true' : 'false');
      if (q && q.trim()) sp.set('q', q.trim());
      if (canvasId) sp.set('canvasId', canvasId);
      // ext фильтр: используем multi-params (?ext=md&ext=pdf), чтобы:
      // - избежать проблем с экранированием запятых,
      // - и легко расширять в будущем (например, ext=md&ext=txt).
      for (const ext of exts) sp.append('ext', ext);

      const payload = await fetchJson<LibraryListResponseDTO>(`/api/library?${sp.toString()}`, { method: 'GET' });

      if (silent) {
        // Тихий refresh: не трогаем isLoading/error, только обновляем данные.
        set({
          folders: payload.folders,
          docs: payload.docs,
          meta: payload.meta,
        });
      } else {
        set({
          folders: payload.folders,
          docs: payload.docs,
          meta: payload.meta,
          isLoading: false,
          error: null,
        });
      }
    } catch (err) {
      if (silent) {
        // Best-effort: не показываем ошибку пользователю (чтобы не “мигало”),
        // но логируем в консоль для диагностики.
        console.warn('[LibraryStore] silent load failed:', err);
        return;
      }
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  checkUploadConflicts: async (files, folderId) => {
    // -------------------------------------------------------------------------
    // 0) Нормализация входа
    // -------------------------------------------------------------------------
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return { conflicts: [], safe: [] };

    // -------------------------------------------------------------------------
    // 1) Загружаем список документов в целевой папке (только "живые")
    // -------------------------------------------------------------------------
    //
    // Важно:
    // - нам нужно сравнить имена именно внутри папки (а не по всей библиотеке),
    // - для root папки важно ПРИНУДИТЕЛЬНО указать folderId параметр как пустую строку,
    //   потому что в API фильтр по folderId применяется только если параметр был передан.
    const sp = new URLSearchParams();
    sp.set('trashed', 'false');

    // Семантика API:
    // - folderId отсутствует → фильтра по папке нет (вся библиотека)
    // - folderId='' → root
    // - folderId='<uuid>' → конкретная папка
    if (folderId === null) sp.set('folderId', '');
    else sp.set('folderId', String(folderId || '').trim());

    const payload = await fetchJson<LibraryListResponseDTO>(`/api/library?${sp.toString()}`, { method: 'GET' });

    // -------------------------------------------------------------------------
    // 2) Строим lookup: normalizedNameKey -> candidates[]
    // -------------------------------------------------------------------------
    const byName = new Map<string, UploadConflictCandidate[]>();
    for (const d of payload.docs || []) {
      const key = normalizeNameKey(d.name);
      if (!key) continue;
      const arr = byName.get(key) || [];
      arr.push({
        docId: d.docId,
        name: d.name,
        folderId: d.folderId ?? null,
        kind: d.kind,
        mime: d.mime,
        sizeBytes: d.sizeBytes,
        fileHash: d.fileHash,
        fileUpdatedAt: d.fileUpdatedAt,
        createdAt: d.createdAt,
      });
      byName.set(key, arr);
    }

    // -------------------------------------------------------------------------
    // 3) Разделяем входные файлы на safe vs conflicts
    // -------------------------------------------------------------------------
    const conflicts: UploadConflict[] = [];
    const safe: File[] = [];

    for (const f of list) {
      const key = normalizeNameKey(f?.name);
      if (!key) {
        // Если имя пустое/сломано (очень редкий кейс), считаем это safe:
        // сервер всё равно нормализует имя на своей стороне.
        safe.push(f);
        continue;
      }

      const candidates = byName.get(key) || [];
      if (candidates.length > 0) {
        conflicts.push({ file: f, normalizedNameKey: key, candidates });
      } else {
        safe.push(f);
      }
    }

    return { conflicts, safe };
  },

  analyzeInBackground: async (docIdsRaw) => {
    // -------------------------------------------------------------------------
    // 0) Нормализация входа
    // -------------------------------------------------------------------------
    const docIds = Array.from(new Set((docIdsRaw || []).map((x) => String(x || '').trim()).filter(Boolean)));
    if (docIds.length === 0) return;

    // -------------------------------------------------------------------------
    // 1) Ставим “processing” статусы для UI
    // -------------------------------------------------------------------------
    set((s) => {
      // Добавляем docIds в in-flight map
      const nextInFlight: Record<string, true> = { ...s.analysisInFlightDocIds };
      for (const id of docIds) nextInFlight[id] = true;

      // При новом запуске анализа сбрасываем “старые” ошибки (best-effort)
      const nextErrors: Record<string, string | undefined> = { ...s.analysisErrorsByDocId };
      for (const id of docIds) delete nextErrors[id];

      return {
        analysisInFlightDocIds: nextInFlight,
        analysisErrorsByDocId: nextErrors,
      };
    });

    // -------------------------------------------------------------------------
    // 2) Берём настройки LLM из глобального Settings store
    // -------------------------------------------------------------------------
    //
    // Важно:
    // - /api/library/analyze требует apiKey (401, если пусто),
    // - поэтому если ключа нет — мы просто снимаем “processing” и выходим,
    //   а UI покажет “stale” + подсказку “нужен API ключ”.
    //
    // Это лучше, чем:
    // - бомбить сервер запросами, которые гарантированно вернут 401,
    // - и показывать пользователю красную “ошибку” вместо понятной подсказки.
    const settings = useSettingsStore.getState();
    const apiKey = String(settings.apiKey || '').trim();
    if (!apiKey) {
      set((s) => {
        const nextInFlight: Record<string, true> = { ...s.analysisInFlightDocIds };
        for (const id of docIds) delete nextInFlight[id];
        return { analysisInFlightDocIds: nextInFlight };
      });
      return;
    }

    const apiBaseUrl = String(settings.apiBaseUrl || '').trim();
    const model = String(settings.model || '').trim();
    const corporateMode = Boolean(settings.corporateMode);
    const languageHintText = String(settings.language || '').trim() || undefined;

    // -------------------------------------------------------------------------
    // 3) Вызываем /api/library/analyze (batch)
    // -------------------------------------------------------------------------
    type AnalyzeResponse = {
      success: boolean;
      updated: boolean;
      results: Array<
        | { docId: string; status: 'ok'; kind: 'text' | 'image'; didComputeSummary: boolean; didComputeImageDescription: boolean }
        | { docId: string; status: 'skipped'; reason: string }
        | { docId: string; status: 'error'; error: string; details?: string }
      >;
      /**
       * Todo D: список "затронутых" ссылок по usage-index:
       * - какие холсты/ноды используют анализируемые docIds.
       *
       * Клиент использует это, чтобы мгновенно пропатчить АКТИВНЫЙ холст в памяти.
       */
      touched?: TouchedLink[];
      /**
       * Мини-снимок документов по docIds запроса (только то, что нужно для патча в canvas):
       * - docId, kind
       * - analysis: excerpt/summary/image.description
       */
      docs?: Array<{ docId: string; kind: 'text' | 'image'; analysis?: { excerpt?: string; summary?: string; image?: { description?: string } } }>;
    };

    try {
      const payload = await fetchJson<AnalyzeResponse>(`/api/library/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docIds,
          apiKey,
          apiBaseUrl,
          model,
          corporateMode,
          languageHintText,
        }),
      });

      // -----------------------------------------------------------------------
      // 3.0) Todo D: патчим активный холст derived-метаданными (best-effort)
      // -----------------------------------------------------------------------
      //
      // Важно:
      // - патчим только ноды активного холста (если touched содержит active canvas),
      // - derived метаданные НЕ должны делать владельца stale.
      const touchedActiveNodeIds = getTouchedNodeIdsForActiveCanvas(payload.touched);
      const docsSnapshot = Array.isArray(payload.docs) ? payload.docs : [];
      // Если touched пустой (частый кейс “только что прикрепили docId и не сохраняли холст”),
      // делаем fallback поиск по attachments в in-memory состоянии активного холста.
      const fallbackNodeIds =
        touchedActiveNodeIds.length > 0 ? touchedActiveNodeIds : findNodeIdsReferencingDocsInActiveCanvas(docIds);

      if (fallbackNodeIds.length > 0 && docsSnapshot.length > 0) {
        patchDerivedAnalyzeInActiveCanvas({ docs: docsSnapshot, nodeIds: fallbackNodeIds });
      }

      // -----------------------------------------------------------------------
      // 3.1) Сохраняем ошибки по docId (если есть)
      // -----------------------------------------------------------------------
      set((s) => {
        const nextErrors: Record<string, string | undefined> = { ...s.analysisErrorsByDocId };

        for (const r of payload.results || []) {
          const id = String(r.docId || '').trim();
          if (!id) continue;

          if (r.status === 'error') {
            const code = String(r.error || 'UNKNOWN_ERROR');
            const details = r.details ? String(r.details) : '';
            nextErrors[id] = details ? `${code}: ${details}` : code;
            continue;
          }

          // ok/skipped → считаем, что “ошибка” для этого docId исчезла
          delete nextErrors[id];
        }

        return { analysisErrorsByDocId: nextErrors };
      });

      // -----------------------------------------------------------------------
      // 3.2) Тихо обновляем список, чтобы подтянуть analysis (summary/description)
      // -----------------------------------------------------------------------
      //
      // Важно:
      // - не делаем set({isLoading:true}) — это фон и UX не должен “мигать”.
      // - если refresh упадёт — это не критично: пользователь всё равно увидит, что processing закончился,
      //   а список обновится при следующем обычном load().
      try {
        // Важно:
        // - раньше здесь вручную строился URLSearchParams (q/canvas/ext),
        // - но теперь у нас есть дополнительное правило "trash is global",
        //   и проще/надёжнее делегировать сбор URL в единый loader.
        //
        // Это гарантирует:
        // - если активна вкладка trash → фильтры будут проигнорированы,
        // - silent=true → UI не "мигнёт" isLoading/error.
        await get().load({ silent: true });
      } catch (refreshErr) {
        // Best-effort: ошибка не критична (список всё равно обновится при следующем обычном load()).
        console.warn('[LibraryStore] silent refresh after analyze failed:', refreshErr);
      }
    } catch (err) {
      // -----------------------------------------------------------------------
      // 3.3) Ошибка всего batch — помечаем всем docId одинаковую ошибку (best-effort)
      // -----------------------------------------------------------------------
      const message = err instanceof Error ? err.message : String(err);
      set((s) => {
        const nextErrors: Record<string, string | undefined> = { ...s.analysisErrorsByDocId };
        for (const id of docIds) nextErrors[id] = message;
        return { analysisErrorsByDocId: nextErrors };
      });
    } finally {
      // -----------------------------------------------------------------------
      // 4) Снимаем “processing” статусы
      // -----------------------------------------------------------------------
      set((s) => {
        const nextInFlight: Record<string, true> = { ...s.analysisInFlightDocIds };
        for (const id of docIds) delete nextInFlight[id];
        return { analysisInFlightDocIds: nextInFlight };
      });
    }
  },

  upload: async (files, opts) => {
    if (!files || files.length === 0) return { success: true, docs: [] };

    set({ isLoading: true, error: null });
    try {
      const fd = new FormData();
      // Важно: если передан файл с изменённым именем (new File(...)), FormData возьмёт его name.
      // Это позволяет нам поддерживать "Rename" стратегию просто передавая переименованные File объекты.
      for (const f of files) fd.append('files', f);
      if (opts?.folderId) fd.set('folderId', opts.folderId);

      // Сервер возвращает созданные документы (docs[]), чтобы клиент мог:
      // - сразу знать docIds,
      // - запустить analyze в фоне для каждого docId,
      // - и при желании оптимистично обновлять UI.
      const res = await fetchJson<{ success: boolean; docs?: LibraryDocDTO[] }>(`/api/library/upload`, {
        method: 'POST',
        body: fd,
      });

      const docs = res.docs || [];
      const createdDocIds = docs.map((d) => String(d.docId || '').trim()).filter(Boolean);

      // Fire-and-forget анализ (НЕ await), чтобы UI не “висел” на LLM.
      // Важно: analyze сам выставит processing статусы и снимет их по завершению.
      void get().analyzeInBackground(createdDocIds);

      await get().load();

      return { success: true, docs };
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
      return { success: false, docs: [] };
    }
  },

  replace: async (docId, file) => {
    set({ isLoading: true, error: null });
    try {
      const fd = new FormData();
      fd.set('docId', docId);
      fd.set('file', file);
      const res = await fetchJson<{ success: boolean; updated?: boolean; doc?: LibraryDocDTO; touched?: TouchedLink[] }>(
        `/api/library/replace`,
        {
        method: 'POST',
        body: fd,
        }
      );

      // Если replace реально изменил контент — запускаем анализ в фоне.
      // (Если updated:false, значит контент не изменился и анализ актуален.)
      if (res.updated) {
        const id = String(res.doc?.docId || docId || '').trim();
        if (id) void get().analyzeInBackground([id]);
      }

      // Todo D: мгновенно синхронизируем активный холст (in-memory), если нужно.
      if (res.updated && res.doc) {
        const nodeIds = getTouchedNodeIdsForActiveCanvas(res.touched);
        if (nodeIds.length > 0) {
          patchAttachmentsReplaceInActiveCanvas({ doc: res.doc, nodeIds });
        }
      }

      await get().load();
      return { success: true, doc: res.doc };
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
      return { success: false };
    }
  },

  rename: async (docId, name) => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetchJson<{ success: boolean; doc?: LibraryDocDTO; touched?: TouchedLink[] }>(`/api/library/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, name }),
      });

      // Todo D: мгновенно синхронизируем активный холст (in-memory), если нужно.
      const nodeIds = getTouchedNodeIdsForActiveCanvas(res.touched);
      if (nodeIds.length > 0) {
        // На сервере rename нормализуется, поэтому предпочитаем `res.doc.name`.
        const finalName = String(res.doc?.name || name || '').trim();
        if (finalName) {
          patchAttachmentsRenameInActiveCanvas({ docId, newName: finalName, nodeIds });
        }
      }

      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  move: async (docId, folderId) => {
    set({ isLoading: true, error: null });
    try {
      await fetchJson<{ success: boolean }>(`/api/library/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, folderId }),
      });
      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  trash: async (docId) => {
    set({ isLoading: true, error: null });
    try {
      // API теперь возвращает touched — какие холсты/ноды были изменены (ссылки удалены)
      const res = await fetchJson<{
        success: boolean;
        touched?: Array<{ canvasId: string; nodeIds: string[] }>;
      }>(`/api/library/trash/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });

      // Применяем touched-патчи к активному холсту (in-memory)
      // Это даёт мгновенную консистентность: пользователь сразу видит, что ссылки удалены
      if (res.touched && res.touched.length > 0) {
        applyTouchedPatchesForRemovedDocs(res.touched, [docId]);
      }

      // После перемещения в корзину мы остаёмся на текущей вкладке.
      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  restore: async (docId) => {
    set({ isLoading: true, error: null });
    try {
      await fetchJson<{ success: boolean }>(`/api/library/trash/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });
      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  trashUnlinked: async () => {
    /**
     * "Убрать файлы без ссылок" (переместить в корзину).
     *
     * Почему это в store:
     * - UI (Toolbar) должен быть тонким: он только открывает confirm dialog,
     *   а сама логика — здесь (как у trash/restore/emptyTrash).
     */
    set({ isLoading: true, error: null });
    try {
      await fetchJson<{ success: boolean; movedCount: number; movedDocIds?: string[] }>(`/api/library/trash/move-unlinked`, {
        method: 'POST',
      });
      // Обновляем текущий список (с учётом активной вкладки и фильтров).
      // Это также подтянет новые meta.trashedDocs / meta.unlinkedLiveDocs.
      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  emptyTrash: async () => {
    set({ isLoading: true, error: null });
    try {
      // API теперь возвращает touched и deletedDocIds
      const res = await fetchJson<{
        success: boolean;
        deletedDocIds?: string[];
        touched?: Array<{ canvasId: string; nodeIds: string[] }>;
      }>(`/api/library/trash/empty`, { method: 'POST' });

      // Применяем touched-патчи к активному холсту (in-memory)
      // Это даёт мгновенную консистентность: пользователь сразу видит, что ссылки удалены
      if (res.touched && res.touched.length > 0 && res.deletedDocIds && res.deletedDocIds.length > 0) {
        applyTouchedPatchesForRemovedDocs(res.touched, res.deletedDocIds);
      }

      await get().load({ trashed: true });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  gc: async (opts) => {
    set({ isLoading: true, error: null });
    try {
      // API теперь возвращает touched и deletedDocIds
      const res = await fetchJson<{
        success: boolean;
        deletedDocIds?: string[];
        touched?: Array<{ canvasId: string; nodeIds: string[] }>;
      }>(`/api/library/gc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeLive: Boolean(opts?.includeLive) }),
      });

      // Применяем touched-патчи к активному холсту (in-memory)
      // Это даёт мгновенную консистентность: пользователь сразу видит, что ссылки удалены
      if (res.touched && res.touched.length > 0 && res.deletedDocIds && res.deletedDocIds.length > 0) {
        applyTouchedPatchesForRemovedDocs(res.touched, res.deletedDocIds);
      }

      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  // ---------------------------------------------------------------------------
  // FOLDERS CRUD
  // ---------------------------------------------------------------------------
  createFolder: async (nameRaw, parentId) => {
    /**
     * Создание папки.
     *
     * Примечание:
     * - имя нормализуется на сервере (normalizeDocDisplayName),
     * - но мы всё равно делаем trim на клиенте для удобства UX.
     */
    const name = String(nameRaw || '').trim();
    if (!name) return;

    set({ isLoading: true, error: null });
    try {
      await fetchJson<{ success: boolean }>(`/api/library/folders/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId: parentId || null }),
      });
      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  renameFolder: async (folderIdRaw, nameRaw) => {
    const folderId = String(folderIdRaw || '').trim();
    const name = String(nameRaw || '').trim();
    if (!folderId || !name) return;

    set({ isLoading: true, error: null });
    try {
      await fetchJson<{ success: boolean }>(`/api/library/folders/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, name }),
      });
      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  deleteFolder: async (folderIdRaw) => {
    /**
     * Удаление папки.
     *
     * Важно:
     * - сервер может вернуть 409 (папка не пустая),
     * - fetchJson() по умолчанию бросает исключение на non-2xx,
     *   но нам хочется извлечь "разумное" сообщение об ошибке.
     *
     * Поэтому здесь используем ручной fetch(), читаем JSON и формируем message.
     */
    const folderId = String(folderIdRaw || '').trim();
    if (!folderId) return;

    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`/api/library/folders/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });

      // JSON ответа может отсутствовать (например, если сервер вернул пустое тело),
      // поэтому работаем через unknown + безопасное "сужение" типов.
      const jsonUnknown = (await res.json().catch(() => null)) as unknown;
      const jsonObj: Record<string, unknown> | null =
        jsonUnknown && typeof jsonUnknown === 'object' ? (jsonUnknown as Record<string, unknown>) : null;

      const errorField = jsonObj && typeof jsonObj.error === 'string' ? jsonObj.error : '';
      const reasonField = jsonObj && typeof jsonObj.reason === 'string' ? jsonObj.reason : '';
      if (!res.ok) {
        // Формируем "человеческую" ошибку. На сервере:
        // - 404: folder not found
        // - 409: folder not empty
        const reason = reasonField ? String(reasonField) : '';
        const msg =
          errorField
            ? String(errorField)
            : reason === 'FOLDER_NOT_EMPTY'
              ? 'Папка не пустая: сначала переместите/удалите документы и подпапки.'
              : reason === 'FOLDER_NOT_FOUND'
                ? 'Папка не найдена.'
                : `HTTP ${res.status}: ${res.statusText}`;
        throw new Error(msg);
      }

      await get().load();
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
}));

