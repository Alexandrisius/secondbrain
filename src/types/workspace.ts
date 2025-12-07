/**
 * @file workspace.ts
 * @description TypeScript типы для модуля управления холстами (Workspace)
 * 
 * Этот модуль определяет структуру данных для:
 * - Папок (Folder) - организация холстов в иерархию
 * - Метаданных холстов (CanvasMeta) - информация о холстах без самих данных
 * - Состояния workspace (WorkspaceState) - глобальное состояние файлового менеджера
 */

// =============================================================================
// ПАПКИ
// =============================================================================

/**
 * Папка для организации холстов
 * Поддерживает вложенность через parentId
 */
export interface Folder {
  /** Уникальный идентификатор папки */
  id: string;
  
  /** Название папки (отображается в UI) */
  name: string;
  
  /** 
   * ID родительской папки для вложенности
   * null означает корневую папку
   */
  parentId: string | null;
  
  /** Порядок сортировки внутри родительской папки */
  order: number;
  
  /** Флаг: раскрыта ли папка в дереве */
  isExpanded: boolean;
  
  /** Временная метка создания */
  createdAt: number;
  
  /** Временная метка последнего обновления */
  updatedAt: number;
}

// =============================================================================
// МЕТАДАННЫЕ ХОЛСТА
// =============================================================================

/**
 * Метаданные холста (без содержимого нод и связей)
 * Используется для отображения в списке и управления
 */
export interface CanvasMeta {
  /** Уникальный идентификатор холста (соответствует имени файла) */
  id: string;
  
  /** Название холста (отображается в UI) */
  name: string;
  
  /** 
   * ID папки, в которой находится холст
   * null означает корневой уровень
   */
  folderId: string | null;
  
  /** Порядок сортировки внутри папки */
  order: number;
  
  /** Временная метка создания */
  createdAt: number;
  
  /** Временная метка последнего обновления */
  updatedAt: number;
  
  /** Количество нод в холсте (для отображения) */
  nodesCount?: number;
}

// =============================================================================
// СОСТОЯНИЕ WORKSPACE
// =============================================================================

/**
 * Полное состояние workspace (index.json)
 * Содержит структуру папок, метаданные холстов и UI-состояние
 */
export interface WorkspaceIndex {
  /** Массив всех папок */
  folders: Folder[];
  
  /** Массив метаданных всех холстов */
  canvases: CanvasMeta[];
  
  /** 
   * Массив ID недавно открытых холстов
   * Максимум 5 элементов, новейший первый
   */
  recent: string[];
  
  /** ID текущего активного (открытого) холста */
  activeCanvasId: string | null;
  
  /** Версия формата для миграций */
  version: number;
}

// =============================================================================
// СОСТОЯНИЕ ZUSTAND STORE
// =============================================================================

/**
 * UI-состояние для workspace (не сохраняется в файл)
 */
export interface WorkspaceUIState {
  /** Флаг: загружаются ли данные */
  isLoading: boolean;
  
  /** Флаг: сохраняются ли данные */
  isSaving: boolean;
  
  /** Ошибка при работе с данными */
  error: string | null;
  
  /** Флаг: свёрнут ли сайдбар */
  isSidebarCollapsed: boolean;
  
  /** 
   * Массив ID выбранных элементов (для мультиселекта)
   * Может содержать ID папок и холстов
   */
  selectedIds: string[];
  
  /** ID элемента, который сейчас редактируется (переименование) */
  editingId: string | null;
  
  /** ID папки/холста, над которым сейчас происходит drag */
  dragOverId: string | null;
  
  /** Тип элемента над которым drag: 'folder' | 'canvas' | 'root' */
  dragOverType: 'folder' | 'canvas' | 'root' | null;
}

/**
 * Полное состояние Zustand store для workspace
 */
export interface WorkspaceState extends WorkspaceIndex, WorkspaceUIState {}

// =============================================================================
// ЭКШЕНЫ WORKSPACE STORE
// =============================================================================

/**
 * Экшены для управления workspace
 */
export interface WorkspaceActions {
  // =========================================================================
  // ЗАГРУЗКА И СОХРАНЕНИЕ
  // =========================================================================
  
  /** Загрузить workspace из API */
  loadWorkspace: () => Promise<void>;
  
  /** Сохранить workspace в API */
  saveWorkspace: () => Promise<void>;
  
  // =========================================================================
  // ОПЕРАЦИИ С ПАПКАМИ
  // =========================================================================
  
  /** 
   * Создать новую папку
   * @param name - название папки
   * @param parentId - ID родительской папки (null для корня)
   * @returns ID созданной папки
   */
  createFolder: (name: string, parentId?: string | null) => string;
  
  /** 
   * Переименовать папку
   * @param folderId - ID папки
   * @param newName - новое название
   */
  renameFolder: (folderId: string, newName: string) => void;
  
  /** 
   * Удалить папку (с содержимым или перемещением в корень)
   * @param folderId - ID папки
   * @param deleteContents - удалить содержимое или переместить в корень
   */
  deleteFolder: (folderId: string, deleteContents?: boolean) => void;
  
  /** 
   * Переместить папку
   * @param folderId - ID папки
   * @param newParentId - ID новой родительской папки (null для корня)
   */
  moveFolder: (folderId: string, newParentId: string | null) => void;
  
  /** 
   * Переключить раскрытие папки
   * @param folderId - ID папки
   */
  toggleFolderExpanded: (folderId: string) => void;
  
  // =========================================================================
  // ОПЕРАЦИИ С ХОЛСТАМИ
  // =========================================================================
  
  /** 
   * Создать новый холст
   * @param name - название холста
   * @param folderId - ID папки (null для корня)
   * @returns ID созданного холста
   */
  createCanvas: (name: string, folderId?: string | null) => Promise<string>;
  
  /** 
   * Переименовать холст
   * @param canvasId - ID холста
   * @param newName - новое название
   */
  renameCanvas: (canvasId: string, newName: string) => void;
  
  /** 
   * Удалить холст
   * @param canvasId - ID холста
   */
  deleteCanvas: (canvasId: string) => Promise<void>;
  
  /** 
   * Копировать холст
   * @param canvasId - ID исходного холста
   * @returns ID копии
   */
  duplicateCanvas: (canvasId: string) => Promise<string>;
  
  /** 
   * Переместить холст в папку
   * @param canvasId - ID холста
   * @param folderId - ID папки (null для корня)
   */
  moveCanvas: (canvasId: string, folderId: string | null) => void;
  
  /** 
   * Открыть холст (сделать активным)
   * @param canvasId - ID холста
   */
  openCanvas: (canvasId: string) => Promise<void>;
  
  /**
   * Обновить количество нод в холсте
   * @param canvasId - ID холста
   * @param count - количество нод
   */
  updateCanvasNodesCount: (canvasId: string, count: number) => void;
  
  // =========================================================================
  // UI ОПЕРАЦИИ
  // =========================================================================
  
  /** Переключить состояние сайдбара */
  toggleSidebar: () => void;
  
  /** 
   * Выбрать элемент (с поддержкой мультиселекта)
   * @param id - ID элемента
   * @param multiSelect - добавить к выбору или заменить
   */
  selectItem: (id: string, multiSelect?: boolean) => void;
  
  /** Очистить выбор */
  clearSelection: () => void;
  
  /** 
   * Начать редактирование (переименование)
   * @param id - ID элемента
   */
  startEditing: (id: string) => void;
  
  /** Завершить редактирование */
  stopEditing: () => void;
  
  /** 
   * Установить drag over состояние
   * @param id - ID элемента
   * @param type - тип элемента
   */
  setDragOver: (id: string | null, type: 'folder' | 'canvas' | 'root' | null) => void;
  
  /** Очистить ошибку */
  clearError: () => void;
  
  // =========================================================================
  // МАССОВЫЕ ОПЕРАЦИИ
  // =========================================================================
  
  /** 
   * Удалить выбранные элементы
   */
  deleteSelected: () => Promise<void>;
  
  /** 
   * Переместить выбранные элементы в папку
   * @param folderId - ID папки (null для корня)
   */
  moveSelectedTo: (folderId: string | null) => void;
}

/**
 * Полный тип Zustand store (состояние + экшены)
 */
export type WorkspaceStore = WorkspaceState & WorkspaceActions;

// =============================================================================
// ТИПЫ ДЛЯ DRAG AND DROP
// =============================================================================

/**
 * Данные, передаваемые при drag операции
 */
export interface DragItem {
  /** ID перетаскиваемого элемента */
  id: string;
  
  /** Тип элемента */
  type: 'folder' | 'canvas';
  
  /** Текущий parentId (для папок) или folderId (для холстов) */
  parentId: string | null;
}

/**
 * Результат drop операции
 */
export interface DropResult {
  /** ID целевой папки (null для корня) */
  targetFolderId: string | null;
  
  /** Позиция в списке (опционально) */
  targetIndex?: number;
}

// =============================================================================
// ТИПЫ ДЛЯ КОНТЕКСТНОГО МЕНЮ
// =============================================================================

/**
 * Действия контекстного меню
 */
export type ContextMenuAction = 
  | 'rename'
  | 'duplicate'
  | 'delete'
  | 'move'
  | 'newCanvas'
  | 'newFolder';

/**
 * Элемент контекстного меню
 */
export interface ContextMenuItem {
  /** ID действия */
  action: ContextMenuAction;
  
  /** Отображаемый текст */
  label: string;
  
  /** Иконка (название из lucide-react) */
  icon?: string;
  
  /** Разделитель перед элементом */
  dividerBefore?: boolean;
  
  /** Элемент опасный (удаление) */
  danger?: boolean;
  
  /** Элемент отключен */
  disabled?: boolean;
}

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Максимальное количество недавних холстов
 */
export const MAX_RECENT_CANVASES = 5;

/**
 * Текущая версия формата workspace
 */
export const WORKSPACE_VERSION = 1;

/**
 * Название файла для нового холста по умолчанию
 */
export const DEFAULT_CANVAS_NAME = 'Новый холст';

/**
 * Название папки по умолчанию
 */
export const DEFAULT_FOLDER_NAME = 'Новая папка';

