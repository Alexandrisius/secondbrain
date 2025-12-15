export type FileType = 'image' | 'pdf' | 'doc' | 'other';
export type FileStatus = 'uploading' | 'processing' | 'ready' | 'stale' | 'error';

/**
 * Детализированная "обратная ссылка" из библиотеки:
 * документ используется на конкретном холсте в конкретных карточках.
 *
 * Почему это нужно на клиенте:
 * - в Details панели мы хотим показывать не просто “canvasId”,
 *   а список карточек (nodeId), чтобы можно было перейти и сфокусироваться.
 *
 * Важно:
 * - это UI-тип (DTO-ish), он не претендует на “единственный источник истины”;
 *   истинные данные живут в `data/library/usage-index.json` на сервере.
 */
export type FileUsageLink = {
  canvasId: string;
  nodeIds: string[];
};

export interface FileNode {
  id: string;
  name: string;
  type: FileType;
  isDirectory: boolean;
  parentId: string | null;
  size?: string;
  updatedAt: string;
  status?: FileStatus;
  /**
   * Подсказка для статуса (title/tooltip).
   *
   * Примеры:
   * - "Анализируется (LLM)..."
   * - "Нужен анализ: summary отсутствует или устарел"
   * - "Ошибка анализа: HTTP 401: API ключ не указан"
   *
   * Почему это поле здесь (а не вычислять в FileItem):
   * - источники данных (store, API) лучше знают причину статуса,
   * - UI-компоненту FileItem не нужно быть “умным” и тащить логику анализа.
   */
  statusHint?: string;
  progress?: number; // 0-100
  tags?: string[];
  canvasLinks?: string[]; // IDs of canvases using this file
  /**
   * Детальные ссылки (canvasId + nodeIds).
   *
   * Почему поле отдельно от canvasLinks:
   * - canvasLinks оставляем для старого/упрощённого UI (иконка "используется"),
   * - canvasNodeLinks нужен для панели “Links” (переход на карточку).
   *
   * Поле опционально, чтобы:
   * - не ломать существующие моки,
   * - позволить API отдавать только canvasIds там, где деталь не нужна.
   */
  canvasNodeLinks?: FileUsageLink[];
  previewUrl?: string;

  // ---------------------------------------------------------------------------
  // Доп. поля для "глобальной библиотеки документов"
  // ---------------------------------------------------------------------------
  //
  // Эти поля опциональны, чтобы:
  // - не ломать текущие компоненты/моки,
  // - постепенно подключать реальные данные из /api/library.
  //
  // Для файлов (isDirectory:false):
  docId?: string;
  mime?: string;
  sizeBytes?: number;
  /**
   * “Версия файла” (как в NodeAttachment):
   * - fileHash: SHA-256 содержимого
   * - fileUpdatedAt: epoch ms
   *
   * Эти поля мы кладём в drag&drop payload, чтобы карточка могла сохранить snapshot
   * даже без дополнительного запроса к API.
   */
  fileHash?: string;
  fileUpdatedAt?: number;
  updatedAtTs?: number;
  trashedAt?: number;
  summary?: string;
  excerpt?: string;
  /**
   * LLM-описание изображения (caption-only) для документов kind:image.
   *
   * Почему отдельное поле, а не `summary`:
   * - `summary` продуктово относится к текстам (2-3 предложения по содержимому текста),
   * - для изображений корректнее говорить “описание” (5-10 предложений по визуальному содержимому),
   * - UI (FileDetails) может по `isImage` выбирать, какое поле показывать пользователю.
   *
   * Важно:
   * - источник истины — `doc.analysis.image.description` на сервере,
   * - это поле здесь — UI-денормализация для удобства отображения.
   */
  imageDescription?: string;
}

export interface FolderNode extends FileNode {
  isDirectory: true;
  children?: string[]; // IDs of children
}
