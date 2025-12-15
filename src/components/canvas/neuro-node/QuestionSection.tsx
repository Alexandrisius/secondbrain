import React, { useState, useCallback, useEffect, useMemo } from 'react';
// ВАЖНО (Next.js):
// - ESLint правило @next/next/no-img-element рекомендует использовать next/image вместо <img>.
// - Мы отдаём файлы вложений через API библиотеки (`/api/library/file/[docId]`).
// - Для таких URL используем `unoptimized`, чтобы:
//   - избежать нюансов/кеширования оптимизатора изображений,
//   - оставить предсказуемую семантику отображения "как отдал сервер".
import Image from 'next/image';
import TextareaAutosize from 'react-textarea-autosize';
import { Handle, Position } from '@xyflow/react';
import {
  Zap,
  Square,
  AlertCircle,
  RefreshCw,
  Loader2,
  Quote,
  Pencil,
  Paperclip,
  X,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useTranslation, format } from '@/lib/i18n';
import type { NeuroNode, NodeAttachment } from '@/types/canvas';
import { NeuroSearchButton } from './NeuroSearchButton';
import { useNeuroSearchStore } from '@/store/useNeuroSearchStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import { searchSimilar } from '@/lib/search/semantic';
import {
  useSettingsStore,
  selectApiKey,
  selectEmbeddingsBaseUrl,
  selectCorporateMode,
  selectEmbeddingsModel,
  selectNeuroSearchMinSimilarity,
} from '@/store/useSettingsStore';
import { useLibraryStore, type UploadConflict, type LibraryDocDTO } from '@/store/useLibraryStore';
import { UploadConflictModal, ConflictAction } from '@/components/file-manager/UploadConflictModal';

// Пустой массив для предотвращения лишних ререндеров (типизированный)
const EMPTY_SEARCH_RESULTS: import('@/types/embeddings').SearchResult[] = [];
const EMPTY_STRING_ARRAY: string[] = [];
// Пустой объект для снимка
const EMPTY_SNAPSHOT: Record<string, number> = {};
// Пустой массив для вложений (важно: один и тот же reference)
const EMPTY_ATTACHMENTS: NodeAttachment[] = [];

// =============================================================================
// Drag & Drop: библиотечный docId → в attachments ноды
// =============================================================================
//
// Здесь мы реализуем "второй тип" DnD, помимо уже существующего DnD реальных файлов:
// - Реальные файлы (DataTransfer.files) → upload в глобальную библиотеку (/api/library/upload)
// - Ссылка на документ (docId) → node.data.attachments (attachmentId = docId) без загрузки файла
//
// Почему нужен кастомный MIME:
// - чтобы не конфликтовать со стандартными типами браузера (text/plain, Files и т.п.)
// - чтобы drop handler мог однозначно понять: это "ссылка на библиотеку", а не upload
const LIB_DOC_DND_MIME = 'application/x-secondbrain-doc';

/**
 * Regex, который “похож” на серверный формат docId (UUID + '.' + ext).
 *
 * Важно:
 * - Это НЕ security boundary. Истинная валидация делается на сервере.
 * - Здесь это нужно только для UX:
 *   - валидировать, что attachmentId “похож” на docId библиотеки (UUID + '.' + ext),
 *   - отсеять очевидный мусор до отправки в серверные API.
 */
const DOC_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,16}$/i;

const isLibraryDocIdLike = (id: string): boolean => DOC_ID_REGEX.test(String(id || '').trim());

/**
 * Payload, который мы кладём в DataTransfer при drag из FileManager.
 *
 * Почему он такой “похож на NodeAttachment”:
 * - нам удобно сразу создать NodeAttachment snapshot без доп. запросов к API,
 * - это помогает stale-логике (fileHash/fileUpdatedAt).
 */
type LibraryDocDragPayload = {
  docId: string;
  name?: string;
  kind?: 'image' | 'text';
  mime?: string;
  sizeBytes?: number;
  fileHash?: string;
  fileUpdatedAt?: number;
};

/**
 * Best-effort пытается прочитать docId payload из DataTransfer.
 *
 * Важно:
 * - Если payload невалиден/пустой — возвращаем null и позволяем существующему
 *   обработчику DnD файлов продолжить работу.
 */
function tryReadLibraryDocDragPayload(dt: DataTransfer | null): LibraryDocDragPayload | null {
  if (!dt) return null;
  const raw = dt.getData(LIB_DOC_DND_MIME);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LibraryDocDragPayload;
    const docId = String(parsed?.docId || '').trim();
    if (!docId) return null;
    if (!isLibraryDocIdLike(docId)) return null;
    return { ...parsed, docId };
  } catch {
    return null;
  }
}

/**
 * Ограничения для построения поискового запроса NeuroSearch.
 *
 * Почему вообще нужен лимит:
 * - Эмбеддинги считаются по тексту, и чем длиннее текст, тем:
 *   1) дороже запрос,
 *   2) выше риск упереться в лимиты модели эмбеддингов,
 *   3) больше «шума» в query (особенно если мы добавляем родительский контекст).
 *
 * Поэтому мы добавляем в query только “самое полезное”:
 * - вопрос ребёнка (обязательно)
 * - цитату (если она есть — это самый точный якорь)
 * - summary родителя (или короткий fallback из response, если summary отсутствует)
 */
const MAX_NEUROSEARCH_QUERY_CHARS = 4000;
const PARENT_CONTEXT_FALLBACK_CHARS = 900;

/**
 * Нормализует список ID для сравнения.
 *
 * ВАЖНО:
 * - Мы считаем `undefined` и `[]` эквивалентными состояниями ("нейропоиск не используется").
 * - Поэтому при пустом результате NeuroSearch мы предпочитаем сохранять `undefined`, чтобы:
 *   1) не плодить "пустые" массивы в data ноды,
 *   2) не триггерить ложную инвалидизацию `stale`,
 *   3) оставаться совместимыми с логикой `useCanvasStore.updateNodeData`,
 *      где переходы `undefined ↔ []` намеренно игнорируются.
 */
const normalizeIdList = (ids?: string[]): string[] => (ids ?? []).filter(Boolean);

/**
 * Сравнение двух списков ID.
 *
 * ВАЖНО:
 * - Сравниваем *в порядке*, т.к. порядок результатов NeuroSearch может влиять на
 *   порядок подмешивания "виртуального" контекста → а значит и на ответ LLM.
 * - Если нужно будет считать порядок неважным, здесь достаточно будет сортировки
 *   (но сейчас оставляем строгую проверку, чтобы не скрыть реальные изменения контекста).
 */
const areIdListsEqual = (a?: string[], b?: string[]): boolean => {
  const aa = normalizeIdList(a);
  const bb = normalizeIdList(b);
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
};

/**
 * "Красивые" подписи расширений для миниатюр документов.
 *
 * Зачем это нужно:
 * - На миниатюре (36x36) мало места → длинные расширения визуально “разъезжаются”.
 * - Пользователь чаще ориентируется на привычные короткие теги (MD, TXT, JSON, ...),
 *   чем на “полное” расширение (markdown).
 *
 * ВАЖНО:
 * - Это НЕ влияет на логику обработки файлов — только на UI.
 * - Если расширение неизвестно — покажем его как есть (в upper-case), но ограничим длину.
 */
const ATTACHMENT_EXTENSION_ALIASES: Record<string, string> = {
  // Текстовые форматы, которые мы явно поддерживаем в input.accept (см. ниже в файле)
  txt: 'TXT',
  md: 'MD',
  markdown: 'MD',
  json: 'JSON',
  csv: 'CSV',
  yaml: 'YAML',
  yml: 'YML',
};

/**
 * Возвращает короткую подпись расширения файла для миниатюры документа.
 *
 * UX требования (как в запросе):
 * - Подпись должна быть "очень маленькой" и располагаться ВНИЗУ кликабельного фона,
 *   не залезая на иконку "лист бумаги".
 * - Поэтому подпись должна быть максимально короткой и безопасной.
 *
 * Примеры:
 * - "Текстовый документ.txt" → "TXT"
 * - "readme.md" → "MD"
 * - "spec.markdown" → "MD"
 * - "noext" → null (не рисуем ничего)
 * - ".env" → "ENV" (показываем, потому что это удобно для навигации)
 *
 * ВАЖНО:
 * - Мы намеренно берём расширение из originalName (то, что видит пользователь),
 *   а не из mime, т.к. mime может быть слишком общим (например text/plain).
 * - Берём ПОСЛЕДНЮЮ точку: "archive.tar.gz" → "GZ".
 */
const getAttachmentExtensionLabel = (originalName?: string): string | null => {
  const name = (originalName || '').trim();
  if (!name) return null;

  const lastDot = name.lastIndexOf('.');
  // Нет точки или точка в конце (например "file.") → нет расширения
  if (lastDot === -1 || lastDot === name.length - 1) return null;

  // Берём часть после последней точки и нормализуем.
  const raw = name.slice(lastDot + 1).trim();
  if (!raw) return null;

  // Саницируем: оставляем только буквы/цифры, чтобы бейдж всегда был компактным.
  // (Вдруг пользователь назовёт файл "a.(draft).txt" — нам важно не сломать UI)
  const normalized = raw.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  if (!normalized) return null;

  // Сначала пробуем “красивые” алиасы, иначе показываем как есть (upper-case).
  const label = (ATTACHMENT_EXTENSION_ALIASES[normalized] || normalized.toUpperCase())
    // Ограничиваем длину: миниатюра 36px — слишком длинный текст не поместится.
    .slice(0, 8);

  return label || null;
};

interface QuestionSectionProps {
  id: string;
  data: NeuroNode['data'];
  isEditing: boolean;
  localPrompt: string;
  hasParentContext: boolean;
  directParents: NeuroNode[];
  isGenerating: boolean;
  hasContent: boolean;
  setIsEditing: (val: boolean) => void;
  handlePromptChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handlePromptBlur: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleGenerate: () => void;
  handleRegenerate: () => void;
  handleAbortGeneration: () => void;
  handleInitiateQuoteSelectionInParent: () => void;
  setIsContextModalOpen: (val: boolean) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  questionSectionRef: React.RefObject<HTMLDivElement>;
}

export const QuestionSection: React.FC<QuestionSectionProps> = ({
  id,
  data,
  isEditing,
  localPrompt,
  hasParentContext,
  directParents,
  isGenerating,
  hasContent,
  setIsEditing,
  handlePromptChange,
  handlePromptBlur,
  handleKeyDown,
  handleGenerate,
  handleRegenerate,
  handleAbortGeneration,
  handleInitiateQuoteSelectionInParent,
  setIsContextModalOpen,
  textareaRef,
  questionSectionRef,
}) => {
  const { t } = useTranslation();

  const { 
    checkUploadConflicts, 
    upload: uploadToLibrary, 
    replace: replaceInLibrary 
  } = useLibraryStore();
  
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [uploadConflicts, setUploadConflicts] = useState<UploadConflict[]>([]);
  const [safeFiles, setSafeFiles] = useState<File[]>([]);
  
  // === STORES ===
  
  // Settings Store
  const apiKey = useSettingsStore(selectApiKey);
  // NOTE:
  // apiBaseUrl/model в этом компоненте не используются напрямую:
  // - генерация/чатовые запросы делаются через другие слои (useNodeGeneration/aiService),
  // - но eslint ругается на "unused", поэтому не держим лишние переменные.
  const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
  const corporateMode = useSettingsStore(selectCorporateMode);
  const embeddingsModel = useSettingsStore(selectEmbeddingsModel);
  // Порог “чувствительности” NeuroSearch (настраивается в SettingsModal)
  const neuroSearchMinSimilarity = useSettingsStore(selectNeuroSearchMinSimilarity);
  
  // Canvas Store - для доступа к nodes и обновления data
  const nodes = useCanvasStore(state => state.nodes);
  // Edges нужны для вычисления “родословной” (предки/потомки),
  // чтобы NeuroSearch не подмешивал в контекст уже “родственные” карточки.
  const edges = useCanvasStore(state => state.edges);
  const updateNodeData = useCanvasStore(state => state.updateNodeData);

  /**
   * ВАЖНОЕ ИЗМЕНЕНИЕ:
   * - Раньше вложения были привязаны к активному холсту и лежали в отдельном дисковом слое.
   * - Теперь вложения — это документы глобальной библиотеки (docId), и для работы с файлами
   *   `activeCanvasId` больше не нужен.
   */
  
  // NeuroSearch Store
  const setNeuroSearchResults = useNeuroSearchStore(state => state.setResults);
  const clearNeuroSearchResults = useNeuroSearchStore(state => state.clearResults);
  const setIsNeuroSearching = useNeuroSearchStore(state => state.setIsSearching);
  const neuroSearchResults = useNeuroSearchStore(state => state.results[id] || EMPTY_SEARCH_RESULTS);
  const isNeuroSearching = useNeuroSearchStore(state => state.isSearching[id] || false);
  
  // Получаем снимок состояния подключённых карточек на момент поиска
  const sourceNodesSnapshot = useNeuroSearchStore(state => state.sourceNodesSnapshot[id] || EMPTY_SNAPSHOT);

  // === ВЫЧИСЛЕНИЕ STALE СТАТУСА ===
  // 
  // Результаты NeuroSearch устаревают когда:
  // - Любая из подключённых карточек была обновлена ПОСЛЕ момента поиска
  // 
  // Для этого сравниваем текущий updatedAt каждой подключённой карточки
  // с сохранённым снимком updatedAt на момент поиска.
  const isNeuroSearchStale = useMemo(() => {
    // Если нет результатов - нет устаревания
    if (neuroSearchResults.length === 0) return false;
    
    // Проверяем каждую подключённую карточку
    for (const result of neuroSearchResults) {
      // Находим карточку в текущем состоянии canvas
      const sourceNode = nodes.find(n => n.id === result.nodeId);

      // =========================================================================
      // ВАЖНО (продуктовая семантика stale для NeuroSearch):
      //
      // Мы различаем две вещи:
      // 1) `data.isStale` у карточки (это про "ответ этой карточки устарел и требует Regenerate")
      // 2) `isNeuroSearchStale` у кнопки мозга (это про "результаты NeuroSearch устарели и
      //    поиск нужно перезапустить", НО сама карточка ещё не обязана быть stale)
      //
      // Критичный кейс из бага:
      // - NeuroSearch нашёл карточку-предка
      // - пользователь удалил найденную карточку
      // - результаты NeuroSearch (и нейроконтекст) всё ещё могут существовать в store
      //   (например, в виде сохранённых `SearchResult`/preview)
      // - но источник на холсте пропал, и значит результаты надо пересчитать при следующем клике
      //
      // Поэтому:
      // - если нода-источник НЕ найдена в `nodes`, считаем NeuroSearch устаревшим (stale=true),
      //   и подсвечиваем ТОЛЬКО кнопку мозга, НЕ трогая `data.isStale` владельца.
      // =========================================================================
      if (!sourceNode) {
        return true;
      }

      // Получаем сохранённый updatedAt на момент поиска
      const savedUpdatedAt = sourceNodesSnapshot[result.nodeId];
      
      // Если карточка была обновлена позже снимка - NeuroSearch контекст устарел
      // Также считаем устаревшим если снимка нет (savedUpdatedAt === undefined)
      if (!savedUpdatedAt || sourceNode.data.updatedAt > savedUpdatedAt) {
        return true;
      }
    }
    
    return false;
  }, [neuroSearchResults, sourceNodesSnapshot, nodes]);

  // Local state for toggle button visual state
  const [isNeuroSearchEnabled, setIsNeuroSearchEnabled] = useState(false);

  // =============================================================================
  // ВЛОЖЕНИЯ (ATTACHMENTS) — UI + загрузка + превью
  // =============================================================================
  //
  // Цель MVP:
  // - прикреплять маленькие файлы (image + text)
  // - хранить их в глобальной библиотеке документов
  // - сохранять в node.data только метаданные + ссылку (attachmentId = docId)
  //
  // ВАЖНО:
  // - Мы не делаем progress bar в MVP (fetch не даёт простого прогресса).
  // - Мы делаем paste image, drag&drop, file picker — это “современный минимум”.

  // Лимиты (должны соответствовать серверным, чтобы UX был предсказуемым)
  const MAX_TEXT_BYTES = 1 * 1024 * 1024; // 1MB
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3MB
  const MAX_TOTAL_BYTES_PER_NODE = 8 * 1024 * 1024; // 8MB

  const allowedImageMimes = useMemo(
    () => new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    []
  );
  const allowedTextExts = useMemo(
    () => new Set(['txt', 'md', 'markdown', 'json', 'csv', 'yaml', 'yml']),
    []
  );

  // Локальное состояние UI для вложений
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const [isDragOverAttachments, setIsDragOverAttachments] = useState(false);

  // ===========================================================================
  // LEGACY UI: ЗАМЕНА ФАЙЛА ПО ИМЕНИ (в старом "файловом менеджере холста")
  // ===========================================================================
  //
  // После перехода на глобальную библиотеку этот диалог больше НЕ используется:
  // - upload всегда создаёт новый docId,
  // - replace выполняется отдельно и адресно по docId через FileManager.
  //
  // Оставлено временно, чтобы не делать большой рефактор UI в одном PR;
  // блок будет удалён/переработан в следующем шаге.
  const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);
  const [replaceConflicts, setReplaceConflicts] = useState<Array<{ originalName: string; attachmentId: string }>>([]);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  // Пользовательские "новые имена" для конфликтующих файлов (ключ = индекс файла в pendingUploadFiles).
  // Мы храним именно string→string, потому что React state удобнее сериализовать/мерджить.
  const [pendingRenameByIndex, setPendingRenameByIndex] = useState<Record<string, string>>({});
  const [pendingRenameError, setPendingRenameError] = useState<string | null>(null);

  // Превью (modal)
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<NodeAttachment | null>(null);
  const [previewText, setPreviewText] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Скрытый file input
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Текущие вложения ноды (в UI считаем undefined и [] эквивалентными)
  const attachments = useMemo(
    () => (Array.isArray(data.attachments) ? (data.attachments as NodeAttachment[]) : EMPTY_ATTACHMENTS),
    [data.attachments]
  );

  /**
   * ID вложений, которые пользователь ЯВНО выключил из контекста этой карточки.
   *
   * ВАЖНО (продуктовая логика):
   * - Выключенное вложение не удаляется из карточки и остаётся видимым в UI.
   * - Оно лишь исключается из контекста (используется в useNodeContext / useNodeGeneration).
   *
   * Зачем нам этот список в UI:
   * - Чтобы помечать миниатюры "выключено из контекста" (тонкая оранжевая рамка),
   *   и чтобы пользователь не терялся, почему ответ/контекст изменился.
   */
  const excludedAttachmentIds = useMemo(
    () =>
      Array.isArray(data.excludedAttachmentIds)
        ? (data.excludedAttachmentIds as string[])
        : EMPTY_STRING_ARRAY,
    [data.excludedAttachmentIds]
  );

  /**
   * ID контекстных НОД, которые пользователь выключил в ContextViewerModal.
   *
   * ВАЖНО:
   * - Это общий массив, который может содержать:
   *   1) выключенных родителей/предков (это "важное" изменение контекста),
   *   2) выключенные результаты NeuroSearch (часто используется как "очистить шум").
   */
  const excludedContextNodeIds = useMemo(
    () =>
      Array.isArray(data.excludedContextNodeIds)
        ? (data.excludedContextNodeIds as string[])
        : EMPTY_STRING_ARRAY,
    [data.excludedContextNodeIds]
  );

  /**
   * Множество nodeId, которые относятся к текущим результатам NeuroSearch.
   *
   * Зачем:
   * - В продукте есть правило-исключение: отключение "нейрокарточек" (NeuroSearch)
   *   НЕ должно красить кнопку контекста в оранжевый, потому что:
   *   - в большинстве случаев пользователь выключает там “лишнее”,
   *   - и мы не хотим, чтобы UI почти всегда выглядел как "изменённый".
   */
  const neuroSearchNodeIdSet = useMemo(
    () => new Set(neuroSearchResults.map((r) => r.nodeId)),
    [neuroSearchResults]
  );

  /**
   * Есть ли исключённые контекстные ноды, которые НЕ относятся к NeuroSearch.
   *
   * Это как раз "сильное" изменение контекста:
   * - выключили родителя/предка → контекст реально урезан → кнопку красим в оранжевый.
   */
  const hasExcludedNonNeuroSearchContextNodes = useMemo(() => {
    if (!excludedContextNodeIds.length) return false;
    for (const id of excludedContextNodeIds) {
      if (!neuroSearchNodeIdSet.has(id)) return true;
    }
    return false;
  }, [excludedContextNodeIds, neuroSearchNodeIdSet]);

  /**
   * Флаг: "кнопка контекста должна быть оранжевой, потому что часть контекста выключена".
   *
   * ВАЖНО:
   * - Сюда входят:
   *   1) выключенные вложения (excludedAttachmentIds),
   *   2) выключенные "обычные" контекстные ноды (родители/предки),
   * - НО НЕ входят выключения результатов NeuroSearch (см. правило выше).
   */
  const hasContextBlocksDisabled =
    excludedAttachmentIds.length > 0 || hasExcludedNonNeuroSearchContextNodes;

  /**
   * Флаг: "кнопка контекста должна быть оранжевой".
   *
   * Правила:
   * - Если карточка stale → оранжевый (как было).
   * - Если пользователь выключил значимый блок контекста → тоже оранжевый.
   */
  const isContextButtonOrange = data.isStale || hasContextBlocksDisabled;

  /**
   * Флаг "у карточки есть вложения".
   *
   * Важно:
   * - Даже если у карточки нет родителей/NeuroSearch, вложения всё равно являются контекстом
   *   для LLM (они подмешиваются сервером в /api/chat).
   * - Поэтому, если attachments.length > 0, мы должны:
   *   1) показывать кнопку "контекст" (чтобы можно было открыть ContextViewerModal),
   *   2) показывать компактные миниатюры рядом с этой кнопкой (как в чатах).
   */
  const hasAttachments = attachments.length > 0;

  /**
   * Единый флаг "есть хоть какой-то контекст", который стоит показать пользователю.
   *
   * Сейчас контекст может прийти из:
   * - родителей / предков (hasParentContext)
   * - NeuroSearch результатов
   * - вложений текущей карточки
   */
  const hasAnyContextBadge = hasParentContext || neuroSearchResults.length > 0 || hasAttachments;

  /**
   * Текст кнопки контекста.
   *
   * Мы стараемся быть честными:
   * - если есть родители — говорим про родителей
   * - если есть только NeuroSearch — говорим про NeuroSearch
   * - если есть только вложения — говорим про вложения
   *
   * Если "источников" несколько (например родители + вложения) —
   * добавляем короткий суффикс про вложения.
   */
  const contextBadgeText = useMemo(() => {
    let base =
      directParents.length > 1
        ? format(t.node.multipleParentContextUsed, { count: directParents.length })
        : (directParents.length > 0
          ? t.node.parentContextUsed
          : (neuroSearchResults.length > 0
            ? t.node.neuroSearchContext
            : t.node.attachmentsContextUsed));

    // Если вложения присутствуют И есть ещё какой-то контекст — показываем суффикс.
    if (hasAttachments && (directParents.length > 0 || neuroSearchResults.length > 0)) {
      base += t.node.attachmentsSuffix;
    }
    return base;
  }, [
    directParents.length,
    hasAttachments,
    neuroSearchResults.length,
    t.node.attachmentsContextUsed,
    t.node.attachmentsSuffix,
    t.node.multipleParentContextUsed,
    t.node.neuroSearchContext,
    t.node.parentContextUsed,
  ]);

  /**
   * Возвращает расширение файла (lowercase) или null.
   */
  const getFileExt = (name: string): string | null => {
    const idx = name.lastIndexOf('.');
    if (idx === -1) return null;
    const ext = name.slice(idx + 1).trim().toLowerCase();
    return ext ? ext : null;
  };

  /**
   * Нормализуем имя файла для сравнений в UI:
   * - trim
   * - удаление управляющих символов
   * - ограничение длины
   * - lower-case (важно для Windows)
   *
   * Исторически это использовалось для диалога "conflict/rename" в legacy слое вложений.
   * После перехода на библиотеку этот диалог почти не нужен, но helper остаётся
   * (он безвреден и может пригодиться в будущих UI-операциях).
   */
  const normalizeNameKey = (name: string): string => {
    const cleaned = (name || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
    const limited = cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
    return (limited || 'file').toLowerCase();
  };

  /**
   * Возвращает “безопасное” имя файла для отображения/отправки на сервер.
   *
   * Почему отдельная функция (а не reuse normalizeNameKey):
   * - `normalizeNameKey()` возвращает lower-case, что удобно для сравнения,
   *   но не всегда хорошо для UX, когда пользователь вводит имя вручную (переименование).
   * - На сервере используется похожая логика sanitize (trim + удаление управляющих символов + лимит длины),
   *   поэтому мы делаем то же самое на клиенте, чтобы:
   *   1) сразу показать пользователю «что реально будет отправлено»,
   *   2) избежать неприятных сюрпризов (например, пустое имя превращается в 'file').
   */
  const sanitizeOriginalName = (name: string): string => {
    const cleaned = (name || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
    const limited = cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
    return limited || 'file';
  };

  // NOTE:
  // - Раньше здесь были helper'ы для hash-aware preflight и инициализации rename-диалога.
  // - После перехода на глобальную библиотеку этот слой больше не используется,
  //   поэтому helper'ы удалены, чтобы не тащить legacy-логику и не путать читателя кода.

  /**
   * Определяем "это текстовый файл?" так же, как в клиентской валидации.
   *
   * Почему не используем только расширение:
   * - для изображений сервер доверяет magic-bytes и игнорирует расширение,
   * - а вот для текстов серверный upload в MVP проверяет allowlist расширений,
   *   поэтому именно здесь важен контроль расширения при переименовании.
   */
  const isTextFileByClientRules = (file: File): boolean => {
    const mime = (file?.type || '').toLowerCase();
    // Если браузер уверен, что это image/* — считаем это изображением (расширение не критично).
    if (mime && mime.startsWith('image/')) return false;
    // Иначе трактуем как текст (как и в validateFilesForUpload).
    return true;
  };

  /**
   * Валидирует "новое имя" для сценария "Загрузить под новым именем".
   *
   * Ключевая проблема, которую решаем:
   * - Пользователь может случайно убрать расширение (.md/.txt),
   *   и сервер отклонит загрузку (потому что для текстов мы проверяем allowlist расширений).
   *
   * Поведение:
   * - Для изображений мы НЕ требуем расширение (сервер определит тип по magic bytes),
   *   но всё равно не позволяем пустое имя.
   * - Для текстов расширение ОБЯЗАТЕЛЬНО и должно быть в allowedTextExts.
   */
  const validateRenamedFileName = (file: File, rawNewName: string): { ok: boolean; error?: string } => {
    const safeNewName = sanitizeOriginalName(rawNewName);
    if (!safeNewName || safeNewName === 'file') {
      return { ok: false, error: 'Имя файла не должно быть пустым.' };
    }

    // Для текстов — жёсткая проверка расширения.
    if (isTextFileByClientRules(file)) {
      const ext = getFileExt(safeNewName);
      if (!ext) {
        return {
          ok: false,
          error:
            'Для текстовых файлов нужно сохранить расширение (например: .txt, .md, .json, .csv, .yaml).',
        };
      }
      if (!allowedTextExts.has(ext)) {
        return {
          ok: false,
          error:
            `Недопустимое расширение ".${ext}". ` +
            `Разрешены: ${Array.from(allowedTextExts).map((x) => `.${x}`).join(', ')}.`,
        };
      }
    }

    return { ok: true };
  };

  /**
   * Валидация файлов на клиенте ДО отправки на сервер.
   *
   * Зачем:
   * - экономим трафик и время
   * - даём мгновенный фидбек пользователю
   *
   * ВАЖНО:
   * - сервер всё равно валидирует повторно (клиенту нельзя доверять).
   */
  const validateFilesForUpload = useCallback((files: File[]): { ok: boolean; error?: string } => {
    if (!files.length) {
      return { ok: false, error: 'Нет файлов для загрузки.' };
    }

    // Суммарный лимит “на ноду” включает уже прикреплённые вложения
    const existingBytes = attachments.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
    const newBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

    if (existingBytes + newBytes > MAX_TOTAL_BYTES_PER_NODE) {
      return {
        ok: false,
        error:
          `Превышен суммарный лимит вложений на карточку ` +
          `(≈ ${Math.round(MAX_TOTAL_BYTES_PER_NODE / 1024 / 1024)}MB).`,
      };
    }

    for (const f of files) {
      const mime = (f.type || '').toLowerCase();

      // 1) Изображения
      if (mime && mime.startsWith('image/')) {
        if (!allowedImageMimes.has(mime)) {
          return { ok: false, error: `Изображение "${f.name}" не поддерживается (mime=${mime}).` };
        }
        if (f.size > MAX_IMAGE_BYTES) {
          return {
            ok: false,
            error:
              `Изображение "${f.name}" слишком большое (≈ ${Math.round(f.size / 1024 / 1024)}MB). ` +
              `Максимум: ≈ ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.`,
          };
        }
        continue;
      }

      // 2) Текстовые файлы (по расширению)
      const ext = getFileExt(f.name);
      if (!ext || !allowedTextExts.has(ext)) {
        return {
          ok: false,
          error:
            `Файл "${f.name}" не поддерживается. ` +
            `Разрешены: изображения (png/jpg/webp/gif) и тексты (txt/md/json/csv/yaml).`,
        };
      }

      if (f.size > MAX_TEXT_BYTES) {
        return {
          ok: false,
          error:
            `Текстовый файл "${f.name}" слишком большой (≈ ${Math.round(f.size / 1024 / 1024)}MB). ` +
            `Максимум: ≈ ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)}MB.`,
        };
      }
    }

    return { ok: true };
  }, [
    // ВАЖНО:
    // - перечисляем ВСЕ значения, которые используются в callback через замыкание,
    //   чтобы `react-hooks/exhaustive-deps` не выдавал предупреждения.
    // - Даже “константы” MAX_* объявлены внутри компонента (пересоздаются на каждый render),
    //   поэтому eslint просит их явно указать.
    attachments,
    allowedImageMimes,
    allowedTextExts,
    MAX_TEXT_BYTES,
    MAX_IMAGE_BYTES,
    MAX_TOTAL_BYTES_PER_NODE,
  ]);

  const linkDocsToNode = useCallback((docs: LibraryDocDTO[]) => {
      // 1) Превращаем docs[] → NodeAttachment[]
      const incomingAttachments: NodeAttachment[] = docs.map((d) => ({
          attachmentId: d.docId,
          kind: d.kind,
          originalName: d.name || d.docId,
          mime: d.mime,
          sizeBytes: d.sizeBytes,
          fileHash: d.fileHash,
          fileUpdatedAt: d.fileUpdatedAt,
          createdAt: d.createdAt,
          ingestionMode: 'inline',
      }));

      // 2) MERGE без дублей
      const merged = (() => {
          const next = [...attachments];
          for (const inc of incomingAttachments) {
            if (next.some((a) => a.attachmentId === inc.attachmentId)) continue;
            next.push(inc);
          }
          return next;
      })();
      
      // 3) Update caches
      const existingExcerpts = (data.attachmentExcerpts as Record<string, string>) || {};
      const existingSummaries = (data.attachmentSummaries as Record<string, string>) || {};
      const existingImageDescriptions = (data.attachmentImageDescriptions as Record<string, string>) || {};
      
      const nextExcerpts = { ...existingExcerpts };
      const nextSummaries = { ...existingSummaries };
      const nextImages = { ...existingImageDescriptions };
      
      for (const d of docs) {
          const docId = d.docId;
          const analysis = d.analysis;
          if (d.kind === 'text') {
            if (analysis?.excerpt) nextExcerpts[docId] = analysis.excerpt;
            if (analysis?.summary) nextSummaries[docId] = analysis.summary;
            delete nextImages[docId];
          } else {
            delete nextExcerpts[docId];
            delete nextSummaries[docId];
            if (analysis?.image?.description) nextImages[docId] = analysis.image.description;
          }
      }
      
      updateNodeData(id, {
          attachments: merged.length > 0 ? merged : undefined,
          attachmentExcerpts: Object.keys(nextExcerpts).length > 0 ? nextExcerpts : undefined,
          attachmentSummaries: Object.keys(nextSummaries).length > 0 ? nextSummaries : undefined,
          attachmentImageDescriptions: Object.keys(nextImages).length > 0 ? nextImages : undefined,
          updatedAt: Date.now(),
      });
  }, [attachments, data, id, updateNodeData]);

  const handleApplyConflicts = useCallback(async (actions: ConflictAction[]) => {
      // Закрываем модалку сразу, чтобы:
      // - пользователь не мог случайно повторно нажать "Применить"
      // - не было ощущения, что UI "завис"
      //
      // Сам процесс загрузки/замены мы показываем через общий isUploadingAttachments.
      setConflictModalOpen(false);
      setIsUploadingAttachments(true);
      
      try {
          // 1) Replace: заменяем существующие документы (docId не меняется)
          for (const r of actions.filter(a => a.strategy === 'replace')) {
              const docId = String(r.existingDocId || '').trim();
              if (!docId) continue;
              const res = await replaceInLibrary(docId, r.file);
              if (res.success && res.doc) {
                  linkDocsToNode([res.doc]);
              }
          }
          
          // 2) Upload-as-new: переименовываем File и загружаем как новый документ (новый docId)
          const uploadAsNewFiles = actions
            .filter(a => a.strategy === 'uploadAsNew')
            .map((r) => new File([r.file], (r.newName || r.file.name).trim() || r.file.name, { type: r.file.type }));

          // 3) Добавляем safe файлы (без конфликтов) — одним батчем
          const toUpload = [...safeFiles, ...uploadAsNewFiles];
          
          if (toUpload.length > 0) {
              const res = await uploadToLibrary(toUpload, { folderId: null });
              if (res.success) {
                  linkDocsToNode(res.docs);
              }
          }
      } catch (err) {
          console.error('Conflict resolution error:', err);
          setAttachmentError('Ошибка при разрешении конфликтов.');
      } finally {
          // Чистим local state конфликта — иначе следующий upload может "подхватить" старые файлы.
          setUploadConflicts([]);
          setSafeFiles([]);
          setIsUploadingAttachments(false);
      }
  }, [replaceInLibrary, safeFiles, uploadToLibrary, linkDocsToNode]);

  /**
   * Загружает файлы в глобальную библиотеку (`/api/library/upload`)
   * и прикрепляет их к текущей карточке.
   * С поддержкой проверки конфликтов имен.
   */
  const uploadAttachments = useCallback(
    async (
      files: File[],
      _opts?: {
        replaceExisting?: boolean;
        skipPreflight?: boolean;
      }
    ) => {
      // eslint хочет, чтобы параметр был использован.
      // Нам важно сохранить совместимость со старым кодом, который передаёт opts,
      // поэтому просто "помечаем" параметр как использованный.
      void _opts;

      setAttachmentError(null);
      setReplaceConflicts([]);
      setPendingUploadFiles([]);
      setPendingRenameByIndex({});
      setPendingRenameError(null);
      setIsReplaceDialogOpen(false);

      const validation = validateFilesForUpload(files);
      if (!validation.ok) {
        setAttachmentError(validation.error || 'Невалидные файлы.');
        return;
      }

      setIsUploadingAttachments(true);
      try {
        const { conflicts, safe } = await checkUploadConflicts(files, null);
        
        if (conflicts.length > 0) {
            setUploadConflicts(conflicts);
            setSafeFiles(safe);
            setConflictModalOpen(true);
            return;
        }

        const res = await uploadToLibrary(files, { folderId: null });
        if (!res.success) throw new Error('Upload failed');
        
        linkDocsToNode(res.docs);
      } catch (err) {
        console.error('[QuestionSection] Upload to library failed:', err);
        setAttachmentError(err instanceof Error ? err.message : 'Не удалось загрузить файлы в библиотеку.');
      } finally {
        setIsUploadingAttachments(false);
      }
    },
    // validateFilesForUpload — это локальная функция, и eslint требует держать её в deps.
    // Это безопасно: функция детерминирована и использует только локальные константы.
    [checkUploadConflicts, uploadToLibrary, linkDocsToNode, validateFilesForUpload]
  );

  /**
   * Прикрепляет "ссылку на библиотечный документ" (docId) к текущей карточке.
   *
   * Что происходит:
   * - мы создаём NodeAttachment, где attachmentId == docId,
   * - добавляем его в node.data.attachments (без дублей),
   * - updateNodeData сам решит, надо ли помечать stale (если у карточки уже есть response).
   *
   * Важно:
   * - Здесь мы НЕ обращаемся к серверу.
   * - Мы используем snapshot метаданных из drag payload (mime/size/hash/updatedAt).
   * - Если каких-то полей нет — ставим best-effort значения, чтобы не ломать типы/UX.
   */
  const attachLibraryDoc = useCallback(
    (payload: LibraryDocDragPayload) => {
      setAttachmentError(null);

      const docId = String(payload?.docId || '').trim();
      if (!docId || !isLibraryDocIdLike(docId)) {
        setAttachmentError('Некорректный docId: невозможно прикрепить документ.');
        return;
      }

      // kind: предпочитаем payload.kind, но делаем fallback по mime.
      const mime = String(payload?.mime || '').trim() || 'application/octet-stream';
      const kind: NodeAttachment['kind'] =
        payload?.kind === 'image' || mime.startsWith('image/') ? 'image' : 'text';

      const nextAtt: NodeAttachment = {
        attachmentId: docId,
        kind,
        originalName: String(payload?.name || docId).trim() || docId,
        mime,
        // sizeBytes обязателен по типу NodeAttachment, поэтому если неизвестно — ставим 0.
        sizeBytes: typeof payload?.sizeBytes === 'number' && Number.isFinite(payload.sizeBytes) ? payload.sizeBytes : 0,
        // Версия файла (для stale):
        fileHash: typeof payload?.fileHash === 'string' ? payload.fileHash : undefined,
        fileUpdatedAt: typeof payload?.fileUpdatedAt === 'number' ? payload.fileUpdatedAt : undefined,
        createdAt: Date.now(),
        ingestionMode: 'inline',
      };

      // MERGE БЕЗ ДУБЛЕЙ (по attachmentId/docId)
      // - если документ уже прикреплён — ничего не делаем
      if (attachments.some((a) => a.attachmentId === nextAtt.attachmentId)) return;

      const merged = [...attachments, nextAtt];

      updateNodeData(id, {
        attachments: merged,
        updatedAt: Date.now(),
        // NOTE: isStale выставлять вручную не нужно — updateNodeData сделает это,
        // если у карточки уже есть response и поменялся primary контекст (attachments[]).
      });
    },
    [attachments, id, updateNodeData]
  );

  /**
   * Удаляет вложение ИЗ КАРТОЧКИ (удаляет ссылку).
   *
   * ВАЖНО (новая архитектура библиотеки):
   * - Вложения — это документы глобальной библиотеки (docId).
   * - Карточка хранит только ссылку (attachmentId=docId) и метаданные.
   * - Поэтому "удалить вложение" здесь означает:
   *   - убрать ссылку из `node.data.attachments`,
   *   - почистить связанные кеши (excerpt/summary/описание) в `node.data.*`.
   *
   * А вот физическое удаление файла документа (trash/gc) выполняется ТОЛЬКО в FileManager,
   * потому что документ может использоваться в других местах (другие карточки/холсты).
   */
  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      setAttachmentError(null);

      setDeletingAttachmentId(attachmentId);

      const next = attachments.filter((a) => a.attachmentId !== attachmentId);

      // Чистим также "связанные" данные:
      // - excludedAttachmentIds (иначе будут "мертвые" выключатели)
      // - attachmentExcerpts / attachmentSummaries (иначе мусор в JSON)
      const existingExcludedAtt = Array.isArray(data.excludedAttachmentIds) ? data.excludedAttachmentIds : [];
      const nextExcludedAtt = existingExcludedAtt.filter((id) => id !== attachmentId);

      const existingExcerpts =
        data.attachmentExcerpts && typeof data.attachmentExcerpts === 'object'
          ? (data.attachmentExcerpts as Record<string, string>)
          : null;
      const existingSummaries =
        data.attachmentSummaries && typeof data.attachmentSummaries === 'object'
          ? (data.attachmentSummaries as Record<string, string>)
          : null;
      const existingImageDescriptions =
        data.attachmentImageDescriptions && typeof data.attachmentImageDescriptions === 'object'
          ? (data.attachmentImageDescriptions as Record<string, string>)
          : null;

      const nextExcerpts = existingExcerpts
        ? Object.fromEntries(Object.entries(existingExcerpts).filter(([k]) => k !== attachmentId))
        : undefined;
      const nextSummaries = existingSummaries
        ? Object.fromEntries(Object.entries(existingSummaries).filter(([k]) => k !== attachmentId))
        : undefined;
      const nextImageDescriptions = existingImageDescriptions
        ? Object.fromEntries(Object.entries(existingImageDescriptions).filter(([k]) => k !== attachmentId))
        : undefined;

      updateNodeData(id, {
        attachments: next.length > 0 ? next : undefined,
        excludedAttachmentIds: nextExcludedAtt.length > 0 ? nextExcludedAtt : undefined,
        attachmentExcerpts: nextExcerpts && Object.keys(nextExcerpts).length > 0 ? nextExcerpts : undefined,
        attachmentSummaries: nextSummaries && Object.keys(nextSummaries).length > 0 ? nextSummaries : undefined,
        attachmentImageDescriptions:
          nextImageDescriptions && Object.keys(nextImageDescriptions).length > 0 ? nextImageDescriptions : undefined,
        updatedAt: Date.now(),
        ...(data.response ? { isStale: true } : {}),
      });

      // ВАЖНО (stale-логика):
      // - Раньше здесь вручную вызывался `markChildrenStale(id)`.
      // - Но это дублирует (и потенциально ломает) централизованную stale-логику в `updateNodeData`,
      //   которая:
      //   1) помечает текущую ноду stale (если уже был response),
      //   2) каскадирует stale на потомков,
      //   3) и сразу же делает reconcile по контекстным хэшам (auto-clear stale при возврате контекста).
      //
      // Поэтому здесь мы намеренно НЕ вызываем `markChildrenStale` вручную:
      // - чтобы избежать ситуации, когда stale "переставляется" потомкам после reconcile,
      // - и чтобы поведение add/delete вложений было симметричным и предсказуемым.

      setDeletingAttachmentId(null);
    },
    [
      attachments,
      data.response,
      data.excludedAttachmentIds,
      data.attachmentExcerpts,
      data.attachmentSummaries,
      data.attachmentImageDescriptions,
      id,
      updateNodeData,
    ]
  );

  /**
   * Открывает превью вложения (картинка или текст).
   *
   * ВАЖНО:
   * - для текста мы подгружаем содержимое только при открытии (лениво)
   * - для картинки браузер сам загрузит <img src=...>
   */
  const openPreview = useCallback(
    async (att: NodeAttachment) => {
      setPreviewAttachment(att);
      setPreviewText('');
      setPreviewOpen(true);

      // Текст — загружаем содержимое
      if (att.kind === 'text') {
        setIsPreviewLoading(true);
        try {
          /**
           * ВАЖНО:
           * - Мы удалили legacy слой вложений.
           * - Поэтому текстовое превью всегда читаем из библиотеки:
           *   GET /api/library/text/[docId]
           */
          const url = `/api/library/text/${att.attachmentId}`;

          const res = await fetch(url);
          if (!res.ok) {
            setPreviewText(`Не удалось загрузить файл (HTTP ${res.status}).`);
            return;
          }
          const txt = await res.text();
          setPreviewText(txt);
        } catch (err) {
          setPreviewText(err instanceof Error ? err.message : 'Не удалось загрузить текст.');
        } finally {
          setIsPreviewLoading(false);
        }
      }
    },
    []
  );

  // При монтировании проверяем, есть ли сохраненные результаты и включаем кнопку
  useEffect(() => {
    if (neuroSearchResults.length > 0 && !isNeuroSearchEnabled) {
      setIsNeuroSearchEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neuroSearchResults.length]);

  // === ВЫПОЛНЕНИЕ НЕЙРОПОИСКА ===
  // 
  // Выполняет семантический поиск похожих карточек и:
  // 1. Сохраняет результаты в store
  // 2. Создаёт снимок updatedAt подключённых карточек
  // 3. Обновляет neuroSearchNodeIds в data карточки
  // 4. Помечает потомков как stale (если у карточки есть ответ)
  const executeNeuroSearch = useCallback(async () => {
    if (!localPrompt.trim() || !apiKey) return;

    // =========================================================================
    // ВАЖНО (семантика stale для NeuroSearch vs stale для карточки):
    //
    // `isNeuroSearchStale` — это stale ИМЕННО кнопки мозга:
    // - означает: "результаты NeuroSearch устарели и их нужно пересчитать"
    // - причины:
    //   1) одна из найденных карточек обновилась (updatedAt > snapshot),
    //   2) одна из найденных карточек была удалена (nodeId отсутствует в nodes),
    //   3) по snapshot нет записи (битые/старые данные).
    //
    // Ключевое правило UX/продукта:
    // - Пока пользователь НЕ нажал на оранжевый stale‑мозг, мы НЕ должны красить
    //   карточку‑владельца `data.isStale` (иначе получается “самопроизвольное” stale).
    // - Но когда пользователь ОСОЗНАННО нажимает stale‑мозг и мы реально обновляем
    //   нейроконтекст — карточка должна стать stale, потому что контекст,
    //   который использовался при генерации ответа, изменился.
    //
    // Важный кейс (то самое “большое недопущение”):
    // - список `neuroSearchNodeIds` может НЕ измениться (те же ID),
    // - но контент этих карточек почти всегда изменился (response/summary и т.д.),
    // - значит LLM‑контекст владельца изменился → ответ владельца потенциально устарел.
    //
    // Поэтому мы запоминаем значение `isNeuroSearchStale` ДО запуска поиска.
    // =========================================================================
    const wasNeuroSearchStaleBeforeRun = isNeuroSearchStale;

    setIsNeuroSearching(id, true);
    try {
      /**
       * Строим “контекстный” поисковый запрос для эмбеддинга.
       *
       * Проблема текущего подхода (только localPrompt):
       * - вопросы часто бывают короткими/общими: “И что дальше?”, “Почему?”, “А как?”
       * - без контекста родителя эмбеддинг такого запроса не несёт смысла → поиск “слепой”
       *
       * Решение:
       * - добавляем summary прямых родителей (или короткий response, если summary нет)
       * - добавляем цитату (если карточка цитатная) как максимально точный контекст
       *
       * ВАЖНО:
       * - этот текст используется ТОЛЬКО для получения query embedding
       * - он НЕ подмешивается в LLM напрямую (LLM контекст строится отдельно)
       */
      const queryParts: string[] = [];

      // 1) База: вопрос ребёнка
      queryParts.push(`Вопрос (ребёнок): ${localPrompt}`);

      // 2) Цитата (если есть) — очень сильный “якорь” смысла
      if (data.quote) {
        queryParts.push(`Цитата (из родителя): "${data.quote}"`);
      }

      // 3) Контекст прямых родителей: summary → fallback на кусок response
      //    Мы делаем это явно, чтобы запросы типа “А как дальше?” начали работать.
      if (directParents.length > 0) {
        directParents.forEach((parent, index) => {
          const parentPrompt = parent.data.prompt || '';
          const parentSummary = parent.data.summary || '';
          const parentResponse = parent.data.response || '';

          // Берём summary, если оно есть (предпочтительно — меньше шума, быстрее, стабильнее).
          // Если summary нет — fallback на обрезанный response.
          const parentContext =
            parentSummary ||
            (parentResponse
              ? (parentResponse.length > PARENT_CONTEXT_FALLBACK_CHARS
                ? parentResponse.slice(0, PARENT_CONTEXT_FALLBACK_CHARS) + '...'
                : parentResponse)
              : '');

          // Если у родителя совсем нет текста — пропускаем (не добавляем пустой шум)
          if (!parentPrompt && !parentContext) return;

          queryParts.push(
            [
              `Родитель #${index + 1}:`,
              parentPrompt ? `Вопрос (родитель): ${parentPrompt}` : null,
              parentContext ? `Суть/контекст (родитель): ${parentContext}` : null,
            ].filter(Boolean).join('\n')
          );
        });
      }

      // 4) Финальная сборка с жёстким лимитом (чтобы не раздувать эмбеддинг-запрос)
      //    Мы режем по символам, сохраняя начало (там самая важная информация).
      //    Это простая и надёжная стратегия.
      const rawQueryText = queryParts.join('\n\n');
      const queryText =
        rawQueryText.length > MAX_NEUROSEARCH_QUERY_CHARS
          ? rawQueryText.slice(0, MAX_NEUROSEARCH_QUERY_CHARS)
          : rawQueryText;

      const results = await searchSimilar(
        {
          // ВАЖНО: queryText отличается от отображаемого вопроса.
          // localPrompt остаётся вопросом карточки, а queryText — это “упаковка” для эмбеддинга.
          query: queryText,
          canvasId: null, // Глобальный поиск
          limit: 10, // Запрашиваем больше, чтобы можно было отфильтровать
          // Пользовательская “чувствительность” NeuroSearch:
          // - меньше порог → больше кандидатов (выше recall, больше шума)
          // - больше порог → меньше кандидатов (выше precision)
          minSimilarity: neuroSearchMinSimilarity,
        },
        apiKey,
        embeddingsBaseUrl,
        corporateMode,
        embeddingsModel // Передаем модель
      );
      
      // Фильтрация результатов:
      // 1. Исключаем саму себя (id)
      // 2. Исключаем уже существующие родительские связи (directParents)
      // 3. КРИТИЧНО: исключаем “ветку родословной” текущей карточки:
      //    - всех предков (вверх по родителям)
      //    - всех потомков (вниз по детям)
      //
      // Почему это нужно:
      // - контекст предков и так доступен через стандартный механизм контекста
      // - контекст потомков мы формируем “снизу” сами и не должны подтягивать его в родителя
      // - иначе возможны:
      //   1) циклы “контекст сам себя подкрепляет”,
      //   2) утечки будущего контекста (потомок может содержать выводы, которые модель ещё “не должна знать”),
      //   3) деградация качества (много дублей в контексте)
      //
      // ВАЖНО:
      // - Мы исключаем именно ancestors + descendants относительно текущей ноды.
      // - “Боковые” ветки (например, siblings/кузены) НЕ исключаем,
      //   потому что они не являются предком/потомком и часто содержат полезный параллельный контекст.

      /**
       * Строим граф родословных связей в рамках текущего холста.
       *
       * Мы учитываем 2 источника правды:
       * 1) edges (source -> target), где source — родитель, target — ребёнок
       * 2) data.parentId / data.parentIds (на случай несовпадений/legacy)
       *
       * Результат:
       * - parentsOf(childId) -> Set(parentId)
       * - childrenOf(parentId) -> Set(childId)
       */
      const parentsOf = new Map<string, Set<string>>();
      const childrenOf = new Map<string, Set<string>>();

      const addLink = (parentId: string | undefined | null, childId: string | undefined | null) => {
        if (!parentId || !childId) return;
        if (parentId === childId) return;
        const pSet = parentsOf.get(childId) || new Set<string>();
        pSet.add(parentId);
        parentsOf.set(childId, pSet);

        const cSet = childrenOf.get(parentId) || new Set<string>();
        cSet.add(childId);
        childrenOf.set(parentId, cSet);
      };

      // 1) edges — основной источник для связей
      edges.forEach((e) => addLink(e.source, e.target));

      // 2) fallback на parentId / parentIds в data (чтобы не зависеть от того, где хранится связь)
      nodes.forEach((n) => {
        const pid = n.data.parentId;
        if (pid) addLink(pid, n.id);
        const pids = n.data.parentIds;
        if (pids && pids.length > 0) {
          pids.forEach((p) => addLink(p, n.id));
        }
      });

      /**
       * Собираем всех предков (ancestors): идём “вверх” по parentsOf.
       */
      const ancestorIds = new Set<string>();
      const ancestorQueue: string[] = Array.from(parentsOf.get(id) || []);
      const MAX_LINEAGE_WALK = 5000; // страховка от циклов/битых данных
      let lineageSteps = 0;

      while (ancestorQueue.length > 0 && lineageSteps < MAX_LINEAGE_WALK) {
        lineageSteps++;
        const curr = ancestorQueue.shift()!;
        if (ancestorIds.has(curr)) continue;
        ancestorIds.add(curr);

        const ps = parentsOf.get(curr);
        if (ps) {
          ps.forEach((p) => {
            if (!ancestorIds.has(p)) ancestorQueue.push(p);
          });
        }
      }

      /**
       * Собираем всех потомков (descendants): идём “вниз” по childrenOf.
       */
      const descendantIds = new Set<string>();
      const descendantQueue: string[] = Array.from(childrenOf.get(id) || []);
      lineageSteps = 0;

      while (descendantQueue.length > 0 && lineageSteps < MAX_LINEAGE_WALK) {
        lineageSteps++;
        const curr = descendantQueue.shift()!;
        if (descendantIds.has(curr)) continue;
        descendantIds.add(curr);

        const cs = childrenOf.get(curr);
        if (cs) {
          cs.forEach((c) => {
            if (!descendantIds.has(c)) descendantQueue.push(c);
          });
        }
      }

      const filteredResults = results.filter(result => {
        // Исключаем саму себя
        if (result.nodeId === id) return false;
        
        // Исключаем прямых родителей
        const isParent = directParents.some(parent => parent.id === result.nodeId);
        if (isParent) return false;

        // Исключаем предков (любого уровня)
        if (ancestorIds.has(result.nodeId)) return false;

        // Исключаем потомков (любого уровня)
        if (descendantIds.has(result.nodeId)) return false;
        
        return true;
      });

      // =========================================================================
      // ВАЖНО (устойчивость к "призракам" после удаления ноды):
      //
      // В момент удаления карточки мы:
      // - сразу убираем её из `nodes` на холсте,
      // - а чистка поисковых индексов (embeddings/hybrid) идёт асинхронно.
      //
      // Из-за этого возможен короткий период, когда `searchSimilar(...)` ещё возвращает
      // `nodeId` удалённой карточки.
      //
      // После наших правок `isNeuroSearchStale` честно считает такие результаты stale
      // (источника в `nodes` уже нет) — это правильно.
      //
      // Но чтобы повторный клик по stale-кнопке действительно "лечил" состояние и снимал stale,
      // мы обязаны выбросить из результата все `nodeId`, которых нет на текущем холсте.
      // =========================================================================
      const existingNodeIds = new Set(nodes.map(n => n.id));
      const existingOnlyResults = filteredResults.filter(r => existingNodeIds.has(r.nodeId));
      
      // Ограничиваем количество до 5 лучших после фильтрации
      const finalResults = existingOnlyResults.slice(0, 5);
      
      // === СОЗДАЁМ СНИМОК СОСТОЯНИЯ ПОДКЛЮЧЁННЫХ КАРТОЧЕК ===
      // Для каждой найденной карточки сохраняем её текущий updatedAt
      // Это позволит определить устаревание, если карточка будет изменена
      const snapshot: Record<string, number> = {};
      finalResults.forEach(result => {
        const sourceNode = nodes.find(n => n.id === result.nodeId);
        if (sourceNode) {
          snapshot[result.nodeId] = sourceNode.data.updatedAt;
        }
      });
      
      // Сохраняем результаты вместе со снимком
      setNeuroSearchResults(id, finalResults, snapshot);

      // Если результатов нет - сразу выключаем кнопку
      if (finalResults.length === 0) {
        setIsNeuroSearchEnabled(false);
      }
      
      // === СОХРАНЯЕМ neuroSearchNodeIds В DATA КАРТОЧКИ ===
      // Это нужно для:
      // 1. Вычисления хэша контекста (computeContextHash)
      // 2. Передачи контекста потомкам
      // 3. Персистентности при сохранении холста
      const nextNeuroSearchNodeIds = finalResults.map(r => r.nodeId);

      // =========================================================================
      // КЛЮЧЕВОЙ МОМЕНТ (фикс бага):
      //
      // Ранее код выставлял `isStale: true` просто по факту клика/запуска поиска,
      // если у карточки уже был ответ (`data.response`).
      //
      // Это приводило к ложному `stale` в ситуации:
      // - NeuroSearch ничего не нашёл (0 результатов)
      // - `neuroSearchNodeIds` как был пустым/undefined, так и остался
      // - контекст фактически НЕ менялся, но карточка окрашивалась как устаревшая
      //
      // Теперь мы помечаем `stale` (и потомков) ТОЛЬКО если список
      // `neuroSearchNodeIds` действительно изменился.
      // =========================================================================
      const prevNeuroSearchNodeIds = data.neuroSearchNodeIds;
      const neuroSearchContextChanged = !areIdListsEqual(prevNeuroSearchNodeIds, nextNeuroSearchNodeIds);

      // Если результатов нет — сохраняем `undefined` (см. normalizeIdList комментарий выше).
      const neuroSearchNodeIdsToPersist =
        nextNeuroSearchNodeIds.length > 0 ? nextNeuroSearchNodeIds : undefined;

      // =========================================================================
      // ВАЖНО (когда делать владельца stale):
      //
      // 1) Если изменился список `neuroSearchNodeIds` → primary‑контекст изменился → stale.
      // 2) Если список ID не изменился, но пользователь обновил stale‑NeuroSearch:
      //    - это означает, что “внутренний” контекст найденных карточек изменился
      //      (updatedAt/удаление) относительно snapshot,
      //    - значит LLM‑контекст владельца тоже изменился,
      //    - поэтому ответ владельца потенциально устарел → владелец stale.
      //
      // Ограничение:
      // - stale имеет смысл только если у карточки уже есть response (иначе “перегенерировать” нечего).
      // =========================================================================
      const shouldMarkOwnerStale =
        Boolean(data.response) && (neuroSearchContextChanged || wasNeuroSearchStaleBeforeRun);

      updateNodeData(id, {
        neuroSearchNodeIds: neuroSearchNodeIdsToPersist,
        // updatedAt внутри updateNodeData выставляется автоматически,
        // но оставляем явный timestamp, т.к. этот код уже рассчитывает
        // на "обновление" карточки при изменении настроек контекста.
        updatedAt: Date.now(),
        ...(shouldMarkOwnerStale ? { isStale: true } : {}),
      });
      
      // ВАЖНО (stale-логика NeuroSearch):
      //
      // Раньше здесь был ручной `markChildrenStale(id)`.
      // Это выглядело логично ("контекст изменился — потомки stale"), но на практике
      // ломало автоматическое снятие stale у потомков при откате контекста (выключение NeuroSearch).
      //
      // Почему:
      // - `updateNodeData(...)` уже делает централизованный stale-каскад при изменении
      //   PRIMARY-контекста (включая `neuroSearchNodeIds`).
      // - Если дополнительно вручную пометить потомков stale уже ПОСЛЕ `updateNodeData`,
      //   то они могут остаться stale до следующего глобального reconcile (например, drag).
      //
      // Поэтому мы намеренно НЕ каскадим stale здесь вручную.
      
      console.log('[NeuroSearch] Поиск завершён:', {
        nodeId: id,
        resultsCount: finalResults.length,
        snapshotKeys: Object.keys(snapshot),
      });
      
    } catch (error) {
      console.error('[NeuroSearch] Ошибка поиска:', error);
    } finally {
      setIsNeuroSearching(id, false);
    }
  }, [
    id, 
    localPrompt, 
    apiKey, 
    embeddingsBaseUrl, 
    corporateMode, 
    embeddingsModel, 
    neuroSearchMinSimilarity,
    directParents, 
    nodes,
    edges,
    data.response,
    data.quote,
    // ВАЖНО: используется для определения, изменился ли контекст NeuroSearch.
    // Если список ID меняется, callback должен видеть актуальное значение.
    data.neuroSearchNodeIds,
    // ВАЖНО: нужно для правильной семантики stale при "обновлении stale‑мозга".
    // Если stale‑состояние мозга изменилось, executeNeuroSearch должен видеть актуальное значение.
    isNeuroSearchStale,
    setIsNeuroSearching, 
    setNeuroSearchResults,
    updateNodeData,
  ]);

  // === ОБРАБОТЧИК ПЕРЕКЛЮЧЕНИЯ КНОПКИ НЕЙРОПОИСКА ===
  // 
  // Логика:
  // 1. Если кнопка stale (оранжевая) и включена - перезапускаем поиск
  // 2. Если кнопка выключена - включаем и запускаем поиск
  // 3. Если кнопка включена (не stale) - выключаем и очищаем результаты
  const handleToggleNeuroSearch = async () => {
    // Нельзя включить если нет промпта
    if (!isNeuroSearchEnabled && !localPrompt.trim()) return;

    // === ОБРАБОТКА STALE СОСТОЯНИЯ ===
    // Если кнопка уже включена И результаты устарели - перезапускаем поиск
    // Это позволяет обновить контекст при повторном клике на оранжевую кнопку
    //
    // ВАЖНО (устойчивость к ресету локального state):
    // - `isNeuroSearchEnabled` — локальный state компонента, он может быть false
    //   краткий момент после remount (до эффекта, который включает кнопку при наличии результатов).
    // - Но сама кнопка в UI остаётся активной, если `neuroSearchResults.length > 0`.
    //
    // Поэтому условие "перезапустить stale поиск" должно опираться не только на локальный state,
    // но и на факт наличия результатов в store.
    const hasStoredResults = neuroSearchResults.length > 0;
    if ((isNeuroSearchEnabled || hasStoredResults) && isNeuroSearchStale) {
      console.log('[NeuroSearch] Перезапуск поиска (stale)');
      await executeNeuroSearch();
      return;
    }

    const newState = !isNeuroSearchEnabled;
    setIsNeuroSearchEnabled(newState);
    
    if (newState) {
      // Активация: запускаем поиск
      await executeNeuroSearch();
    } else {
      // Деактивация: очищаем результаты и neuroSearchNodeIds
      clearNeuroSearchResults(id);
      
      // Также очищаем neuroSearchNodeIds в data карточки
      updateNodeData(id, { 
        neuroSearchNodeIds: undefined,
        updatedAt: Date.now(),
        // Если у карточки уже есть ответ, то отключение контекста делает его устаревшим
        ...(data.response ? { isStale: true } : {})
      });
      
      // Если у карточки есть ответ - помечаем потомков как stale
      // (контекст изменился - убран нейропоиск)
      //
      // ВАЖНО:
      // - не вызываем `markChildrenStale(id)` вручную;
      // - `updateNodeData` уже централизованно каскадит stale и корректно снимает stale
      //   у потомков, когда контекст вернулся к lastContextHash (без drag-пинка).
    }
  };

  // Горячая клавиша Alt+Enter для активации NeuroSearch
  // Оборачиваем handleKeyDown родителя
  const onKeyDownWrapper = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      
      if (localPrompt.trim()) {
        setIsNeuroSearchEnabled(true);
        executeNeuroSearch();
      }
      return;
    }
    
    // Вызываем стандартный обработчик
    handleKeyDown(e);
  };

  // Вычисляем количество активных (не исключённых) результатов поиска
  const activeResultsCount = useMemo(() => {
    if (!neuroSearchResults.length) return 0;
    const excludedIds = data.excludedContextNodeIds || EMPTY_STRING_ARRAY;
    return neuroSearchResults.filter(r => !excludedIds.includes(r.nodeId)).length;
  }, [neuroSearchResults, data.excludedContextNodeIds]);

  // Есть ли исключённые результаты (для отображения точки)
  const hasExcludedResults = useMemo(() => {
    return neuroSearchResults.length > activeResultsCount;
  }, [neuroSearchResults.length, activeResultsCount]);

  return (
    <div
      ref={questionSectionRef}
      className="neuro-question-section relative p-4"
    >
      {/* =====================================================================
          UPLOAD CONFLICTS MODAL (единый UX библиотеки)

          Важно:
          - Модалка живёт в Portal (Dialog), поэтому её можно рендерить прямо здесь.
          - Она используется только когда preflight обнаружил конфликты имён в root библиотеке.
          - По завершению (apply/close) мы чистим локальный state, чтобы не было "залипания".
         ===================================================================== */}
      <UploadConflictModal
        isOpen={conflictModalOpen}
        onClose={() => {
          setConflictModalOpen(false);
          setUploadConflicts([]);
          setSafeFiles([]);
        }}
        conflicts={uploadConflicts}
        onApply={handleApplyConflicts}
      />

      {/* --- HANDLES --- */}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          'neuro-handle',
          '!w-6 !h-6',
          '!bg-primary !border-2 !border-background',
          '!absolute !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2',
        )}
      />

      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          'neuro-handle',
          '!w-6 !h-6',
          '!bg-primary !border-2 !border-background',
          '!absolute !right-0 !top-1/2 !translate-x-1/2 !-translate-y-1/2',
        )}
      />

      {/* Контекст родителя badge - всегда видна при наличии родительского контекста */}
      {/* Убрано условие !data.isStale чтобы кнопка была доступна даже в stale состоянии */}
      {/* Это позволяет пользователю изменять настройки контекста без необходимости регенерации */}
      {hasAnyContextBadge && (
        <div className="flex items-start justify-between gap-2 mb-2">
          <button
            onClick={() => setIsContextModalOpen(true)}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'flex items-center gap-1 text-xs',
              // Оранжевый цвет:
              // - stale (контекст поменялся → нужна регенерация)
              // - либо пользователь выключил "значимый" блок контекста (родитель/вложение)
              isContextButtonOrange
                ? 'text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/30'
                : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30',
              'rounded-md px-2 py-1 -ml-2',
              'transition-colors duration-150',
              'cursor-pointer',
              'nodrag'
            )}
            title={t.node.viewFullContext}
          >
            <span className={cn(
              "w-2 h-2 rounded-full mt-[2px]",
              // Индикатор слева должен соответствовать цвету кнопки:
              // - оранжевый, если stale или часть контекста выключена
              // - синий, если контекст "обычный"
              isContextButtonOrange
                ? "bg-orange-500"
                : "bg-blue-500"
            )} />
            <span className={cn(
              "underline underline-offset-2",
              // Подчёркивание в том же цвете, что и кнопка:
              // - оранжевое при stale/выключенных блоках
              // - синее в обычном состоянии
              isContextButtonOrange
                ? "decoration-orange-400/50"
                : "decoration-blue-400/50"
            )}>
              {contextBadgeText}
              {/* Индикатор количества найденных карточек для NeuroSearch */}
              {directParents.length === 0 && neuroSearchResults.length > 0 && ` (${neuroSearchResults.length})`}
            </span>
          </button>
        </div>
      )}

      {/* Stale badge */}
      {data.isStale && !data.isQuoteInvalidated && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 mb-2 p-2 rounded-lg',
            'bg-orange-50 dark:bg-orange-950/30',
            'border border-orange-200 dark:border-orange-800'
          )}
        >
          <div className="flex items-center gap-1.5 text-xs text-orange-700 dark:text-orange-300 font-medium">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              {directParents.length > 0
                ? t.node.staleConnections
                : t.node.staleContext
              }
            </span>
          </div>
          {localPrompt.trim() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={isGenerating}
              className={cn(
                'h-6 px-2 text-xs',
                'text-orange-700 dark:text-orange-300',
                'hover:bg-orange-100 dark:hover:bg-orange-900/50',
                'nodrag'
              )}
              title={t.node.regenerateResponse}
            >
              {isGenerating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  {t.common.update}
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {/* СЕКЦИЯ ЦИТАТЫ - оранжевый цвет как у связи цитаты */}
      {data.quote && (
        <div
          className={cn(
            'quote-section mb-3 p-3 rounded-lg',
            'border-l-4',
            // Оранжевый фон и рамка для нормального состояния
            !data.isQuoteInvalidated && 'bg-orange-50/50 dark:bg-orange-950/20 border-orange-500',
            // Красный для инвалидированной цитаты
            data.isQuoteInvalidated && 'border-red-500 bg-red-50/10 dark:bg-red-950/20'
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Quote className="w-3.5 h-3.5" />
              <span>{t.node.quoteFromParent}</span>
            </div>

            {/* =====================================================================
                КНОПКА "ИЗМЕНИТЬ" (ручная корректировка цитаты пользователем)

                Зачем она нужна:
                - Ранее "обновление цитаты" было доступно пользователю в основном
                  через продуктовый сценарий инвалидации: когда родительская карточка
                  меняет ответ → цитата в дочерней становится invalid → показываем
                  красный блок с CTA "Выделить новую цитату".
                - Но пользователи также хотят менять цитату ПРОАКТИВНО, даже если
                  она ещё валидна (например, выбрали не тот фрагмент или хотят уточнить).

                Что делает клик:
                - Мы НЕ пытаемся "обновить" цитату прямо здесь, в дочерней карточке,
                  потому что выбор цитаты — это выделение текста в РОДИТЕЛЕ.
                - Поэтому мы переходим к карточке-источнику и активируем режим цитирования.

                Где реализована логика:
                - handleInitiateQuoteSelectionInParent() → useCanvasStore.initiateQuoteSelectionInParent()
                  Этот экшен:
                  1) выделяет родительскую ноду,
                  2) центрирует холст на ней,
                  3) разворачивает её ответ (чтобы был текст для выделения),
                  4) включает режим цитирования (isQuoteModeActive),
                  5) сохраняет quoteModeInitiatedByNodeId (ID этой дочерней карточки),
                     благодаря чему в тулбаре родителя появляется кнопка "Обновить".

                Почему НЕ показываем кнопку при invalidated:
                - В invalidated-сценарии уже есть яркий красный CTA "Выделить новую цитату".
                  Дублировать действия не нужно.

                Почему stopPropagation / nodrag:
                - .quote-section используется как "ручка" для перетаскивания карточки
                  (cursor: grab, user-select: none).
                - Нам нужно, чтобы клик по кнопке не инициировал drag ноды в ReactFlow.
               ===================================================================== */}
            {!data.isQuoteInvalidated && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleInitiateQuoteSelectionInParent}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  // Компактная кнопка в правом верхнем углу секции цитаты
                  'h-6 px-2 text-xs',
                  // Визуально делаем как заголовок секции цитаты (text-muted-foreground),
                  // чтобы кнопка смотрелась частью "шапки", а не отдельным CTA.
                  'text-muted-foreground',
                  'hover:text-foreground hover:bg-muted/40',
                  // Делаем расстояние между иконкой и текстом более плотным:
                  // у Button по умолчанию есть `gap-2`, нам здесь нужен компактнее.
                  'gap-1',
                  // Явно делаем её кликабельной внутри "grab" секции
                  'cursor-pointer',
                  // Запрещаем drag на кнопке (важно для ReactFlow)
                  'nodrag'
                )}
                // Тултип делаем "говорящим": это не просто "изменить текст",
                // а переход к источнику + активация режима выделения цитаты.
                title={t.node.selectTextForQuoteUpdate}
              >
                {/* Иконка слева — "карандаш" как привычная метафора редактирования */}
                <Pencil className="w-3 h-3" />
                {t.node.changeQuote}
              </Button>
            )}
          </div>

          <blockquote className={cn(
            'text-sm italic text-foreground/80',
            'pl-2 border-l-2 border-muted-foreground/30'
          )}>
            &ldquo;{data.quote}&rdquo;
          </blockquote>

          {data.isQuoteInvalidated && (
            <div className="mt-3 p-2 rounded bg-red-100/50 dark:bg-red-900/30">
              <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium mb-2">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{t.node.quoteInvalidated}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleInitiateQuoteSelectionInParent}
                onPointerDown={(e) => e.stopPropagation()}
                className="text-xs h-7 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950 nodrag"
              >
                <RefreshCw className="w-3 h-3 mr-1.5" />
                {t.node.selectNewQuote}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Поле ввода вопроса */}
      <div
        className={cn(
          "flex items-end gap-2",
          // Визуальный фидбек при drag&drop файлов
          isDragOverAttachments && "ring-2 ring-primary/30 rounded-lg"
        )}
        onDragEnter={(e) => {
          // ВАЖНО: предотвращаем “перетаскивание ноды” и даём возможность drop.
          e.preventDefault();
          e.stopPropagation();
          setIsDragOverAttachments(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOverAttachments(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOverAttachments(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragOverAttachments(false);

          const dt = e.dataTransfer;
          // 1) Сначала пробуем "библиотечный" drag payload (docId).
          //    Это важно, потому что при таком DnD dt.files обычно пустой.
          const libPayload = tryReadLibraryDocDragPayload(dt);
          if (libPayload) {
            attachLibraryDoc(libPayload);
            return;
          }

          // 2) Fallback: обычный drag&drop реальных файлов (legacy upload).
          const dropped = Array.from(dt?.files || []);
          if (dropped.length > 0) uploadAttachments(dropped);
        }}
      >
        {/* Кнопка NeuroSearch */}
        <NeuroSearchButton 
          isEnabled={isNeuroSearchEnabled || neuroSearchResults.length > 0} // Кнопка активна если есть результаты
          onToggle={handleToggleNeuroSearch}
          resultCount={activeResultsCount} // Передаем количество активных карточек
          isDeepThink={isNeuroSearching} // Используем пульсацию для индикации загрузки
          isStale={isNeuroSearchStale} // Передаем статус устаревания
          hasExcluded={hasExcludedResults} // Передаем наличие исключённых карточек
        />

        {/* Кнопка “прикрепить файлы” */}
        <button
          onClick={() => fileInputRef.current?.click()}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={isUploadingAttachments}
          className={cn(
            'flex-shrink-0 mb-2',
            'w-8 h-8 rounded-md',
            'flex items-center justify-center',
            'transition-all duration-150',
            'shadow-sm hover:shadow-md',
            'nodrag',
            isUploadingAttachments
              ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
              : 'bg-muted/40 text-foreground hover:bg-muted/60'
          )}
          title="Прикрепить файлы (картинки и текст)"
        >
          {isUploadingAttachments ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </button>

        {isEditing ? (
          <TextareaAutosize
            ref={textareaRef}
            value={localPrompt}
            onChange={handlePromptChange}
            onBlur={handlePromptBlur}
            onKeyDown={onKeyDownWrapper}
            onPaste={(e) => {
              // =========================================================================
              // PASTE IMAGE MVP
              //
              // Что поддерживаем:
              // - вставка изображения из буфера (Ctrl+V)
              //
              // Почему делаем здесь:
              // - это ожидаемое современное поведение
              // - ускоряет workflow (без “сохранить файл → выбрать файл”)
              // =========================================================================
              const items = e.clipboardData?.items;
              if (!items || items.length === 0) return;

              const imageFiles: File[] = [];
              for (const item of Array.from(items)) {
                if (item.kind === 'file') {
                  const f = item.getAsFile();
                  if (f && f.type && f.type.startsWith('image/')) {
                    imageFiles.push(f);
                  }
                }
              }

              if (imageFiles.length > 0) {
                // Предотвращаем вставку “текстового” представления картинки
                e.preventDefault();
                e.stopPropagation();
                uploadAttachments(imageFiles);
              }
            }}
            placeholder={hasParentContext ? t.node.promptPlaceholderWithContext : t.node.promptPlaceholder}
            minRows={1}
            autoFocus
            className={cn(
              'flex-1 min-w-0 resize-none overflow-hidden',
              'text-sm font-medium',
              'rounded-lg p-3',
              'bg-muted/30 border border-transparent',
              'focus:bg-muted/50 focus:border-primary/30',
              'focus:outline-none focus:ring-0',
              'placeholder:text-muted-foreground/50',
              'transition-all duration-200',
              'nodrag nopan',
              'neuro-textarea'
            )}
          />
        ) : (
          <div
            onDoubleClick={() => setIsEditing(true)}
            className={cn(
              'flex-1 min-w-0 min-h-[46px]',
              'text-sm font-medium',
              'rounded-lg p-3',
              'bg-muted/30 border border-transparent',
              'text-foreground',
              'cursor-grab active:cursor-grabbing',
              'whitespace-pre-wrap break-words',
              'overflow-hidden',
            )}
          >
            {localPrompt || (
              <span className="text-muted-foreground/50">
                {hasParentContext ? t.node.promptPlaceholderWithContext : t.node.promptPlaceholder}
              </span>
            )}
          </div>
        )}

        {/* Кнопка генерации / остановки */}
        <button
          onClick={isGenerating ? handleAbortGeneration : (hasContent ? handleRegenerate : handleGenerate)}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={!localPrompt.trim() && !isGenerating}
          className={cn(
            'flex-shrink-0 mb-2',
            'w-8 h-8 rounded-md',
            'flex items-center justify-center',
            'transition-all duration-150',
            'shadow-sm hover:shadow-md',
            'nodrag',
            isGenerating ? [
              'bg-red-500 text-white',
              'hover:bg-red-600',
            ] : [
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ]
          )}
          title={isGenerating ? t.node.stopGeneration : (hasContent ? t.node.regenerateResponse : t.node.generateResponse)}
        >
          {isGenerating ? (
            <Square className="w-4 h-4 fill-current" />
          ) : (
            <Zap className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* =======================================================================
          ПАНЕЛЬ ВЛОЖЕНИЙ (список + ошибки)
          ======================================================================= */}
      {(hasAttachments || attachmentError) && (
        <>
          {/* ===================================================================
              ВИЗУАЛЬНОЕ РАЗДЕЛЕНИЕ СЕКЦИЙ (UX):
              
              Проблема:
              - В строке ввода у нас есть “панель инструментов” (NeuroSearch + скрепка + генерация),
                а ниже — миниатюры вложений.
              - Когда вложений становится несколько, визуально кажется, что миниатюры относятся к
                “кнопкам” и это сливается в один блок.
              
              Решение:
              - Добавляем тонкую, почти незаметную серую линию (border-top) и небольшой отступ сверху.
              - Линию показываем ТОЛЬКО если есть миниатюры (hasAttachments === true),
                чтобы не появлялся “лишний” разделитель в ситуации, когда отображается только ошибка.
              
              Почему используем border-border/40:
              - Это theme-aware токен (светлая/тёмная темы),
                а /40 делает линию достаточно деликатной.
             =================================================================== */}
          <div
            className={cn(
              'mt-2 flex flex-col gap-2',
              // Разделитель между “панелью кнопок” и “панелью миниатюр”.
              // Показываем только при реальных вложениях (см. комментарий выше).
              hasAttachments && 'border-t border-border/40 pt-2'
            )}
          >
          {/* Ошибки вложений */}
          {attachmentError && (
            <div className="text-xs text-red-600 dark:text-red-400">
              {attachmentError}
            </div>
          )}

          {/* Миниатюры вложений (ниже строки ввода — как в чатах) */}
          {hasAttachments && (
            <div className="flex flex-wrap items-center gap-2">
              {attachments.map((att) => {
                const isDeleting = deletingAttachmentId === att.attachmentId;
                const isImage = att.kind === 'image';
                // ВАЖНО:
                // - После удаления legacy слоя вложений превью/контент берём только из библиотеки:
                //   /api/library/*
                // Флаг "это вложение выключено из контекста".
                // Важно: оно всё равно показывается в миниатюрах, но мы добавляем визуальный маркер.
                const isExcludedFromContext = excludedAttachmentIds.includes(att.attachmentId);
                // Подпись расширения показываем ТОЛЬКО для документов (не для изображений).
                // Для изображений это не нужно (и лишь перекрывает превью).
                const extensionLabel = !isImage ? getAttachmentExtensionLabel(att.originalName) : null;

                return (
                  <div
                    key={att.attachmentId}
                    className={cn(
                      'group relative',
                      // Миниатюры делаем меньше: раньше были слишком крупными и занимали много места.
                      // 36x36 (w-9/h-9) — ближе к привычным чатам/мессенджерам.
                      'w-9 h-9 rounded-lg',
                      // Делает контейнер опорным для next/image с fill (absolute внутри).
                      // Это не влияет на layout, но позволяет Image корректно растянуться на всю миниатюру.
                      'relative',
                      // Базовая "кнопка-миниатюра" как в чатах: мягкий фон + тонкая рамка.
                      'bg-muted/20 border',
                      // ВАЖНО (по требованию пользователя):
                      // - Если вложение ВЫКЛЮЧЕНО из контекста, вместо точки мы рисуем
                      //   тонкую оранжевую рамку вокруг миниатюры.
                      // - Это более заметно и выглядит аккуратнее, чем маленькая точка.
                      isExcludedFromContext
                        ? 'border-orange-400/70 dark:border-orange-500/60'
                        : 'border-muted/40',
                      'overflow-hidden',
                      'flex items-center justify-center',
                      'cursor-pointer',
                      // Hover рамки тоже должен быть контекстным:
                      // - если вложение исключено → усиливаем оранжевую рамку
                      // - иначе обычная muted рамка
                      isExcludedFromContext
                        ? 'hover:bg-muted/30 hover:border-orange-500/80 dark:hover:border-orange-400/70'
                        : 'hover:bg-muted/30 hover:border-muted/60',
                      'transition-colors',
                      'nodrag'
                    )}
                    // В title добавляем статус исключения, чтобы он был виден при hover
                    // (особенно полезно, если пользователь не заметил маленькую точку).
                    title={
                      `${att.originalName || att.attachmentId}\n` +
                      `${att.mime} • ${Math.round((att.sizeBytes || 0) / 1024)} KB` +
                      (isExcludedFromContext ? `\n${t.contextModal.excluded}` : '')
                    }
                    onClick={() => openPreview(att)}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {isImage ? (
                      <>
                        <Image
                          // Миниатюра изображения вложения.
                          // fill + object-cover: заполняем 36x36, обрезая по краям как превью в чатах.
                          //
                          // ВАЖНО:
                          // - Вложения теперь всегда являются документами библиотеки (docId),
                          //   поэтому URL выдачи изображения всегда один:
                          //   GET /api/library/file/[docId]
                          // Cache-busting (Todo E):
                          // - replace не меняет docId, но меняет контент,
                          // - поэтому добавляем ?v=fileHash|fileUpdatedAt, чтобы не показывать старую версию из кеша.
                          src={`/api/library/file/${att.attachmentId}${
                            att.fileHash || att.fileUpdatedAt
                              ? `?v=${encodeURIComponent(String(att.fileHash || att.fileUpdatedAt))}`
                              : ''
                          }`}
                          alt={att.originalName || att.attachmentId}
                          fill
                          sizes="36px"
                          className="object-cover"
                          draggable={false}
                          // См. комментарий у импорта: не прогоняем через оптимизатор.
                          unoptimized
                        />
                      </>
                    ) : (
                      <>
                        {/* ===================================================================
                            МИНИАТЮРА ДОКУМЕНТА (НЕ ИЗОБРАЖЕНИЕ)

                            Что хотим получить (по ТЗ пользователя):
                            - “лист бумаги” (иконка) остаётся читаемой
                            - в НИЖНЕЙ части кликабельного фона подписываем расширение
                              очень маленьким текстом (чтобы быстрее ориентироваться)

                            Почему absolute + pointer-events-none:
                            - Вся миниатюра — это кликабельная область (openPreview).
                            - Надпись не должна "воровать" клики/drag у ReactFlow.
                           =================================================================== */}

                        {/* Иконку слегка смещаем вверх, чтобы снизу осталось место под подпись. */}
                        <FileText
                          className={cn(
                            'absolute left-1/2',
                            // 36px контейнер: небольшой отступ сверху делает иконку “лист” визуально
                            // по центру, но при этом оставляет нижнюю полосу под расширение.
                            'top-[7px] -translate-x-1/2',
                            'w-4 h-4 text-muted-foreground'
                          )}
                        />

                        {/* Подпись расширения внизу “фона-кнопки”. */}
                        {extensionLabel && (
                          <div
                            className={cn(
                              'absolute left-0 right-0 bottom-0',
                              // Чуть-чуть "поднимаем" над нижней границей, чтобы текст не прилипал.
                              'pb-[1px]',
                              // Очень маленький текст, как просили. leading-none чтобы занимал минимум высоты.
                              'text-[8px] leading-none font-semibold',
                              // Центрируем, чтобы визуально было "как бейдж".
                              'text-center whitespace-nowrap',
                              // Цвет делаем приглушённым, чтобы не отвлекал от основной ноды.
                              'text-muted-foreground/80',
                              // КРИТИЧНО: подпись не должна перехватывать клики/drag.
                              'pointer-events-none select-none'
                            )}
                          >
                            {extensionLabel}
                          </div>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      className={cn(
                        'absolute top-0.5 right-0.5',
                        // Кнопку удаления тоже делаем компактнее, чтобы не перекрывала превью.
                        'w-4 h-4 rounded-md',
                        'bg-background/80 border border-border/50',
                        'flex items-center justify-center',
                        'opacity-0 group-hover:opacity-100',
                        'transition-opacity',
                        'hover:bg-background',
                        'nodrag'
                      )}
                      title="Удалить вложение"
                      disabled={isDeleting}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAttachment(att.attachmentId);
                      }}
                    >
                      {isDeleting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </>
      )}

      {/* =======================================================================
          HIDDEN FILE INPUT
          ======================================================================= */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept={[
          // Images (явно перечисляем, чтобы не было “всё image/*”)
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
          // Text (по расширениям)
          '.txt',
          '.md',
          '.markdown',
          '.json',
          '.csv',
          '.yaml',
          '.yml',
        ].join(',')}
        onChange={(e) => {
          const selected = Array.from(e.target.files || []);
          if (selected.length > 0) {
            uploadAttachments(selected);
          }
          // Сбрасываем value, чтобы можно было выбрать тот же файл ещё раз.
          e.currentTarget.value = '';
        }}
      />

      {/* =======================================================================
          REPLACE CONFIRM MODAL (имя файла уже существует на холсте)
          ======================================================================= */}
      <Dialog
        open={isReplaceDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsReplaceDialogOpen(false);
            setReplaceConflicts([]);
            setPendingUploadFiles([]);
            setPendingRenameByIndex({});
            setPendingRenameError(null);
            return;
          }
          setIsReplaceDialogOpen(true);
        }}
      >
        {isReplaceDialogOpen && (
          <DialogContent className="w-[min(720px,95vw)] max-w-none">
            <DialogHeader>
              <DialogTitle className="text-base">Файл с таким именем уже есть на холсте</DialogTitle>
              <div className="text-sm text-muted-foreground mt-1">
                <div>
                  На холсте уже есть файл(ы) с таким же именем, но <b>содержимое отличается</b>.
                </div>
                <div className="mt-2 space-y-1">
                  <div>
                    1) <b>Заменить</b> существующий файл (обновится «глобальный файл холста», все карточки-ссылки подтянут новую версию)
                  </div>
                  <div>
                    2) <b>Загрузить под новым именем</b> (оба файла будут существовать параллельно)
                  </div>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Конфликтующие файлы:</div>
              <div className="max-h-[240px] overflow-auto pr-2 custom-scrollbar rounded-md border border-border bg-muted/10 p-2">
                <div className="space-y-2">
                  {(() => {
                    // Собираем быстрые lookup структуры для UX:
                    // - conflictKeys: какие nameKey конфликтуют
                    // - attachmentIdByKey: какой attachmentId уже занят этим nameKey
                    const conflictKeys = new Set(replaceConflicts.map((c) => normalizeNameKey(c.originalName)));
                    const attachmentIdByKey = new Map<string, string>();
                    replaceConflicts.forEach((c) => attachmentIdByKey.set(normalizeNameKey(c.originalName), c.attachmentId));

                    // Показываем строки именно по `pendingUploadFiles`, чтобы:
                    // - можно было переименовать "конкретный выбранный файл" (даже если два одинаковых имени),
                    // - можно было видеть, что именно уйдёт на upload при выборе действия.
                    const rows = pendingUploadFiles
                      .map((f, idx) => {
                        const key = normalizeNameKey(f.name);
                        return {
                          idx,
                          file: f,
                          nameKey: key,
                          attachmentId: attachmentIdByKey.get(key) || '',
                        };
                      })
                      .filter((r) => conflictKeys.has(r.nameKey));

                    if (rows.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground">
                          Не удалось построить список конфликтов (возможно, файлы уже были отфильтрованы).
                        </div>
                      );
                    }

                    return (
                      <ul className="space-y-2">
                        {rows.map((r) => {
                          const idxKey = String(r.idx);
                          const value = pendingRenameByIndex[idxKey] ?? sanitizeOriginalName(r.file.name);
                          // Валидация прямо в UI, чтобы пользователь видел проблему до клика по кнопке.
                          const renameValidation = validateRenamedFileName(r.file, value);
                          return (
                            <li key={`${r.idx}:${r.file.name}`} className="rounded-md border border-border/50 bg-background/50 p-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium truncate">{sanitizeOriginalName(r.file.name)}</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    attachmentId: {r.attachmentId || '—'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2">
                                <div className="text-[11px] text-muted-foreground mb-1">Новое имя (если выбираешь «Загрузить под новым именем»):</div>
                                <input
                                  className={cn(
                                    'w-full h-8 px-2 rounded-md border bg-background text-sm',
                                    // Ошибка → подсветка красным (чтобы человек мгновенно понял, что нужно исправить).
                                    // Используем классы из shadcn/tailwind, которые уже применяются в проекте.
                                    renameValidation.ok ? 'border-border' : 'border-destructive',
                                    renameValidation.ok ? 'focus:ring-ring/40' : 'focus:ring-destructive/40',
                                    'focus:outline-none focus:ring-2'
                                  )}
                                  value={value}
                                  onChange={(e) => {
                                    setPendingRenameError(null);
                                    setPendingRenameByIndex((prev) => ({ ...prev, [idxKey]: e.target.value }));
                                  }}
                                  placeholder={sanitizeOriginalName(r.file.name)}
                                />
                                {renameValidation.ok ? (
                                  <div className="mt-1 text-[11px] text-muted-foreground">
                                    Совет: для текстовых файлов лучше сохранять расширение (например, <code>.md</code>), иначе сервер может отклонить формат.
                                  </div>
                                ) : (
                                  <div className="mt-1 text-[11px] text-destructive">
                                    {renameValidation.error}
                                  </div>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            </div>

            {pendingRenameError && (
              <div className="mt-3 text-sm text-destructive">
                {pendingRenameError}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsReplaceDialogOpen(false);
                  setReplaceConflicts([]);
                  setPendingUploadFiles([]);
                  setPendingRenameByIndex({});
                  setPendingRenameError(null);
                }}
              >
                Отмена
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const conflictKeys = new Set(replaceConflicts.map((c) => normalizeNameKey(c.originalName)));
                  const filtered = pendingUploadFiles.filter((f) => !conflictKeys.has(normalizeNameKey(f.name)));

                  setIsReplaceDialogOpen(false);
                  setReplaceConflicts([]);
                  setPendingUploadFiles([]);
                  setPendingRenameByIndex({});
                  setPendingRenameError(null);

                  if (filtered.length > 0) {
                    uploadAttachments(filtered, { skipPreflight: true });
                  }
                }}
              >
                Пропустить
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Кнопка «Загрузить под новым именем»:
                  // - берём выбранные файлы
                  // - для конфликтующих файлов создаём новые File с тем же содержимым, но другим name
                  // - запускаем upload заново (с preflight), чтобы:
                  //   1) проверились новые имена
                  //   2) отработало attach-only, если вдруг такой файл уже есть под тем же новым именем
                  const conflicts = replaceConflicts;
                  const filesToUpload = pendingUploadFiles;
                  const renameByIndex = pendingRenameByIndex;

                  const conflictKeys = new Set(conflicts.map((c) => normalizeNameKey(c.originalName)));
                  const usedNewNameKeys = new Set<string>();

                  const renamed: File[] = [];
                  for (let i = 0; i < filesToUpload.length; i++) {
                    const f = filesToUpload[i];
                    const isConflict = conflictKeys.has(normalizeNameKey(f.name));
                    if (!isConflict) {
                      // Даже "неконфликтующие" файлы должны иметь уникальные nameKey в рамках batch,
                      // иначе один из файлов может перезаписать другой в рамках одного запроса.
                      const k = normalizeNameKey(f.name);
                      if (usedNewNameKeys.has(k)) {
                        setPendingRenameError('В выбранных файлах есть одинаковые имена. Переименуй один из них, чтобы избежать перезаписи.');
                        return;
                      }
                      usedNewNameKeys.add(k);
                      renamed.push(f);
                      continue;
                    }

                    const rawNewName = renameByIndex[String(i)] ?? f.name;
                    const safeNewName = sanitizeOriginalName(rawNewName);

                    // Контроль расширения/валидности имени:
                    // - подсветку мы делаем в UI, но КРИТИЧНО также проверять при клике,
                    //   чтобы не отправить на сервер заведомо неподходящий текстовый файл.
                    const renameValidation = validateRenamedFileName(f, safeNewName);
                    if (!renameValidation.ok) {
                      setPendingRenameError(renameValidation.error || 'Некорректное имя файла.');
                      return;
                    }

                    const oldKey = normalizeNameKey(f.name);
                    const newKey = normalizeNameKey(safeNewName);

                    if (newKey === oldKey) {
                      setPendingRenameError(`Новое имя должно отличаться от конфликтующего («${sanitizeOriginalName(f.name)}»).`);
                      return;
                    }

                    if (usedNewNameKeys.has(newKey)) {
                      setPendingRenameError('Два конфликтующих файла получили одинаковое новое имя. Задай уникальные имена.');
                      return;
                    }
                    usedNewNameKeys.add(newKey);

                    // ВАЖНО:
                    // - File является Blob, поэтому можно создать новый File, не читая arrayBuffer вручную:
                    //   new File([oldFile], newName, { type: oldFile.type })
                    // - Это экономит память и время.
                    renamed.push(new File([f], safeNewName, { type: f.type }));
                  }

                  // Закрываем модалку и сбрасываем state.
                  setIsReplaceDialogOpen(false);
                  setReplaceConflicts([]);
                  setPendingUploadFiles([]);
                  setPendingRenameByIndex({});
                  setPendingRenameError(null);

                  if (renamed.length > 0) {
                    uploadAttachments(renamed, { skipPreflight: false });
                  }
                }}
              >
                Загрузить под новым именем
              </Button>
              <Button
                onClick={() => {
                  const filesToUpload = pendingUploadFiles;
                  setIsReplaceDialogOpen(false);
                  setReplaceConflicts([]);
                  setPendingUploadFiles([]);
                  setPendingRenameByIndex({});
                  setPendingRenameError(null);
                  if (filesToUpload.length > 0) {
                    uploadAttachments(filesToUpload, { replaceExisting: true, skipPreflight: true });
                  }
                }}
              >
                Заменить
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* =======================================================================
          PREVIEW MODAL
          ======================================================================= */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          // При закрытии чистим state, чтобы следующее открытие было "чистым".
          if (!open) {
            setPreviewOpen(false);
            setPreviewAttachment(null);
            setPreviewText('');
            setIsPreviewLoading(false);
            return;
          }
          setPreviewOpen(true);
        }}
      >
        {previewAttachment && (
          <DialogContent
            // ВАЖНО:
            // - DialogContent рендерится в Portal (body), поэтому не зависит от трансформов ReactFlow-ноды.
            // - Это решает баг: "окно превью ограничено размером карточки и нельзя нажать крестик".
            className="w-[min(1100px,95vw)] max-w-none max-h-[90vh] overflow-hidden flex flex-col"
          >
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="text-base">
                {previewAttachment.originalName || previewAttachment.attachmentId}
              </DialogTitle>
              <div className="text-xs text-muted-foreground truncate">
                {previewAttachment.mime} • {Math.round((previewAttachment.sizeBytes || 0) / 1024)} KB
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-auto pr-2 mt-3">
              {previewAttachment.kind === 'image' ? (
                <div className="rounded-md border border-border overflow-hidden bg-muted/10">
                  <Image
                    // Полноразмерное превью: растягиваем по ширине контейнера,
                    // высоту отдаём браузеру (h-auto) с сохранением пропорций.
                    //
                    // ВАЖНО:
                    // - Вложения теперь всегда документы библиотеки (docId),
                    //   поэтому изображение читаем из:
                    //   GET /api/library/file/[docId]
                    // Cache-busting (Todo E): см. комментарий выше.
                    src={`/api/library/file/${previewAttachment.attachmentId}${
                      previewAttachment.fileHash || previewAttachment.fileUpdatedAt
                        ? `?v=${encodeURIComponent(String(previewAttachment.fileHash || previewAttachment.fileUpdatedAt))}`
                        : ''
                    }`}
                    alt={previewAttachment.originalName || previewAttachment.attachmentId}
                    width={1600}
                    height={900}
                    sizes="(max-width: 1100px) 95vw, 1100px"
                    className="w-full h-auto"
                    // См. комментарий у импорта: не прогоняем через оптимизатор.
                    unoptimized
                  />
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/10 p-3">
                  {isPreviewLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Загружаю...
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                      {previewText}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};

