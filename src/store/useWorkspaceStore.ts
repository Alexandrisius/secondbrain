/**
 * @file useWorkspaceStore.ts
 * @description Zustand store для управления workspace (папки, холсты, навигация)
 * 
 * Этот store отвечает за:
 * - Структуру папок и холстов
 * - UI состояние сайдбара (свёрнут/развёрнут, выбор, редактирование)
 * - CRUD операции над папками и холстами
 * - Синхронизацию с API
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  WorkspaceStore,
  WorkspaceIndex,
  Folder,
  CanvasMeta,
} from '@/types/workspace';
import {
  WORKSPACE_VERSION,
  MAX_RECENT_CANVASES,
  DEFAULT_CANVAS_NAME,
  DEFAULT_FOLDER_NAME,
} from '@/types/workspace';
import { deleteEmbeddingsByCanvas } from '@/lib/db/embeddings';
import { useNeuroSearchStore } from '@/store/useNeuroSearchStore';

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Генерация уникального ID для папки
 */
const generateFolderId = (): string => {
  return `folder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * Генерация уникального ID для холста
 */
const generateCanvasId = (): string => {
  return `canvas-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

// =============================================================================
// НАЧАЛЬНОЕ СОСТОЯНИЕ
// =============================================================================

/**
 * Начальное состояние workspace
 */
const initialState: Omit<WorkspaceStore, keyof import('@/types/workspace').WorkspaceActions> = {
  // Данные из index.json
  folders: [],
  canvases: [],
  recent: [],
  activeCanvasId: null,
  version: WORKSPACE_VERSION,
  
  // UI состояние
  isLoading: false,
  isSaving: false,
  error: null,
  isSidebarCollapsed: false,
  selectedIds: [],
  editingId: null,
  dragOverId: null,
  dragOverType: null,
};

// =============================================================================
// ZUSTAND STORE
// =============================================================================

/**
 * Основной store для управления workspace
 * 
 * ВАЖНО: При изменении folders/canvases автоматически вызывается saveWorkspace
 * через subscription (см. внизу файла)
 */
export const useWorkspaceStore = create<WorkspaceStore>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...initialState,
      
      // =========================================================================
      // ЗАГРУЗКА И СОХРАНЕНИЕ
      // =========================================================================
      
      /**
       * Загрузить workspace из API
       * Вызывается при старте приложения
       */
      loadWorkspace: async () => {
        // Устанавливаем флаг загрузки
        set((state) => {
          state.isLoading = true;
          state.error = null;
        });
        
        try {
          const response = await fetch('/api/workspace');
          
          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }
          
          const data: WorkspaceIndex = await response.json();
          
          // Обновляем состояние данными из API
          set((state) => {
            state.folders = data.folders || [];
            state.canvases = data.canvases || [];
            state.recent = data.recent || [];
            state.activeCanvasId = data.activeCanvasId;
            state.version = data.version || WORKSPACE_VERSION;
            state.isLoading = false;
          });
          
          console.log('[Workspace Store] Загружено:', data.folders?.length, 'папок,', data.canvases?.length, 'холстов');
        } catch (error) {
          console.error('[Workspace Store] Ошибка загрузки:', error);
          
          set((state) => {
            state.isLoading = false;
            state.error = 'Не удалось загрузить workspace';
          });
        }
      },
      
      /**
       * Сохранить workspace в API
       * Вызывается автоматически при изменениях
       */
      saveWorkspace: async () => {
        const { folders, canvases, recent, activeCanvasId, version, isSaving } = get();
        
        // Предотвращаем параллельные сохранения
        if (isSaving) return;
        
        set((state) => {
          state.isSaving = true;
          state.error = null;
        });
        
        try {
          const response = await fetch('/api/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folders,
              canvases,
              recent,
              activeCanvasId,
              version,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }
          
          set((state) => {
            state.isSaving = false;
          });
          
          console.log('[Workspace Store] Сохранено');
        } catch (error) {
          console.error('[Workspace Store] Ошибка сохранения:', error);
          
          set((state) => {
            state.isSaving = false;
            state.error = 'Не удалось сохранить workspace';
          });
        }
      },
      
      // =========================================================================
      // ОПЕРАЦИИ С ПАПКАМИ
      // =========================================================================
      
      /**
       * Создать новую папку
       */
      createFolder: (name: string, parentId: string | null = null): string => {
        const folderId = generateFolderId();
        const { folders } = get();
        
        // Вычисляем порядок (в конце списка)
        const siblingCount = folders.filter(f => f.parentId === parentId).length;
        
        const newFolder: Folder = {
          id: folderId,
          name: name || DEFAULT_FOLDER_NAME,
          parentId,
          order: siblingCount,
          isExpanded: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        
        set((state) => {
          state.folders.push(newFolder);
          // Сразу начинаем редактирование для переименования
          state.editingId = folderId;
        });
        
        console.log('[Workspace Store] Создана папка:', name);
        
        return folderId;
      },
      
      /**
       * Переименовать папку
       */
      renameFolder: (folderId: string, newName: string) => {
        set((state) => {
          const folder = state.folders.find(f => f.id === folderId);
          if (folder) {
            folder.name = newName || DEFAULT_FOLDER_NAME;
            folder.updatedAt = Date.now();
          }
          state.editingId = null;
        });
      },
      
      /**
       * Удалить папку
       * @param deleteContents - если true, удаляет содержимое, иначе перемещает в корень
       */
      deleteFolder: (folderId: string, deleteContents: boolean = false) => {
        set((state) => {
          if (deleteContents) {
            // Рекурсивно собираем все вложенные папки
            const getAllChildFolderIds = (parentId: string): string[] => {
              const children = state.folders.filter(f => f.parentId === parentId);
              return children.flatMap(c => [c.id, ...getAllChildFolderIds(c.id)]);
            };
            
            const folderIdsToDelete = [folderId, ...getAllChildFolderIds(folderId)];
            
            // Удаляем все холсты в этих папках
            state.canvases = state.canvases.filter(
              c => !c.folderId || !folderIdsToDelete.includes(c.folderId)
            );
            
            // Удаляем все папки
            state.folders = state.folders.filter(
              f => !folderIdsToDelete.includes(f.id)
            );
          } else {
            // Перемещаем содержимое в корень
            state.folders.forEach(f => {
              if (f.parentId === folderId) {
                f.parentId = null;
              }
            });
            
            state.canvases.forEach(c => {
              if (c.folderId === folderId) {
                c.folderId = null;
              }
            });
            
            // Удаляем только саму папку
            state.folders = state.folders.filter(f => f.id !== folderId);
          }
          
          // Очищаем выбор если удалённая папка была выбрана
          state.selectedIds = state.selectedIds.filter(id => id !== folderId);
        });
      },
      
      /**
       * Переместить папку в другую папку
       */
      moveFolder: (folderId: string, newParentId: string | null) => {
        set((state) => {
          const folder = state.folders.find(f => f.id === folderId);
          if (folder) {
            // Проверка на перемещение в себя или свои потомки
            const getAllChildFolderIds = (parentId: string): string[] => {
              const children = state.folders.filter(f => f.parentId === parentId);
              return children.flatMap(c => [c.id, ...getAllChildFolderIds(c.id)]);
            };
            
            if (newParentId && getAllChildFolderIds(folderId).includes(newParentId)) {
              console.warn('[Workspace Store] Нельзя переместить папку в свои потомки');
              return;
            }
            
            folder.parentId = newParentId;
            folder.updatedAt = Date.now();
          }
        });
      },
      
      /**
       * Переключить раскрытие папки
       */
      toggleFolderExpanded: (folderId: string) => {
        set((state) => {
          const folder = state.folders.find(f => f.id === folderId);
          if (folder) {
            folder.isExpanded = !folder.isExpanded;
          }
        });
      },
      
      // =========================================================================
      // ОПЕРАЦИИ С ХОЛСТАМИ
      // =========================================================================
      
      /**
       * Создать новый холст
       */
      createCanvas: async (name: string, folderId: string | null = null): Promise<string> => {
        set((state) => {
          state.isSaving = true;
        });
        
        try {
          const response = await fetch('/api/workspace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'createCanvas',
              name: name || DEFAULT_CANVAS_NAME,
              folderId,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }
          
          const { canvas } = await response.json();
          
          set((state) => {
            state.canvases.push(canvas);
            state.activeCanvasId = canvas.id;
            state.recent = [canvas.id, ...state.recent.filter(id => id !== canvas.id)].slice(0, MAX_RECENT_CANVASES);
            state.isSaving = false;
            // Начинаем редактирование для переименования
            state.editingId = canvas.id;
          });
          
          console.log('[Workspace Store] Создан холст:', canvas.name);
          
          return canvas.id;
        } catch (error) {
          console.error('[Workspace Store] Ошибка создания холста:', error);
          
          set((state) => {
            state.isSaving = false;
            state.error = 'Не удалось создать холст';
          });
          
          throw error;
        }
      },
      
      /**
       * Переименовать холст
       */
      renameCanvas: (canvasId: string, newName: string) => {
        set((state) => {
          const canvas = state.canvases.find(c => c.id === canvasId);
          if (canvas) {
            canvas.name = newName || DEFAULT_CANVAS_NAME;
            canvas.updatedAt = Date.now();
          }
          state.editingId = null;
        });
      },
      
      /**
       * Удалить холст
       */
      deleteCanvas: async (canvasId: string): Promise<void> => {
        set((state) => {
          state.isSaving = true;
        });
        
        try {
          const response = await fetch(`/api/canvas/${canvasId}`, {
            method: 'DELETE',
          });
          
          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }
          
          set((state) => {
            // Удаляем из списка
            state.canvases = state.canvases.filter(c => c.id !== canvasId);
            
            // Удаляем из recent
            state.recent = state.recent.filter(id => id !== canvasId);
            
            // Если удалённый холст был активным - выбираем другой
            if (state.activeCanvasId === canvasId) {
              state.activeCanvasId = state.canvases[0]?.id || null;
            }
            
            // Очищаем выбор
            state.selectedIds = state.selectedIds.filter(id => id !== canvasId);
            state.isSaving = false;
          });
          
          console.log('[Workspace Store] Удалён холст:', canvasId);
          
          // =========================================================================
          // ОЧИСТКА ЭМБЕДДИНГОВ
          // Удаляем все эмбеддинги удалённого холста из IndexedDB
          // Это предотвращает появление "призраков" в поиске
          // =========================================================================
          deleteEmbeddingsByCanvas(canvasId).catch((error) => {
            console.error('[Workspace Store] Ошибка удаления эмбеддингов холста:', error);
          });
          
          // =========================================================================
          // ОЧИСТКА КЭША РЕЗУЛЬТАТОВ ПОИСКА
          // Удаляем из NeuroSearchStore все закэшированные результаты,
          // которые ссылаются на удалённый холст
          // =========================================================================
          useNeuroSearchStore.getState().clearResultsForCanvas(canvasId);
        } catch (error) {
          console.error('[Workspace Store] Ошибка удаления холста:', error);
          
          set((state) => {
            state.isSaving = false;
            state.error = 'Не удалось удалить холст';
          });
          
          throw error;
        }
      },
      
      /**
       * Копировать холст
       */
      duplicateCanvas: async (canvasId: string): Promise<string> => {
        const { canvases } = get();
        const sourceCanvas = canvases.find(c => c.id === canvasId);
        
        if (!sourceCanvas) {
          throw new Error('Холст не найден');
        }
        
        set((state) => {
          state.isSaving = true;
        });
        
        try {
          const newId = generateCanvasId();
          const newName = `${sourceCanvas.name} (копия)`;
          
          const response = await fetch(`/api/canvas/${canvasId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'duplicate',
              newId,
              newName,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }
          
          // Добавляем новый холст в локальное состояние
          const newCanvas: CanvasMeta = {
            id: newId,
            name: newName,
            folderId: sourceCanvas.folderId,
            order: canvases.filter(c => c.folderId === sourceCanvas.folderId).length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nodesCount: sourceCanvas.nodesCount,
          };
          
          set((state) => {
            state.canvases.push(newCanvas);
            state.isSaving = false;
          });
          
          console.log('[Workspace Store] Скопирован холст:', newName);
          
          return newId;
        } catch (error) {
          console.error('[Workspace Store] Ошибка копирования холста:', error);
          
          set((state) => {
            state.isSaving = false;
            state.error = 'Не удалось скопировать холст';
          });
          
          throw error;
        }
      },
      
      /**
       * Переместить холст в папку
       */
      moveCanvas: (canvasId: string, folderId: string | null) => {
        set((state) => {
          const canvas = state.canvases.find(c => c.id === canvasId);
          if (canvas) {
            canvas.folderId = folderId;
            canvas.updatedAt = Date.now();
          }
        });
      },
      
      /**
       * Открыть холст (сделать активным)
       */
      openCanvas: async (canvasId: string): Promise<void> => {
        set((state) => {
          state.activeCanvasId = canvasId;
          // Добавляем в recent
          state.recent = [canvasId, ...state.recent.filter(id => id !== canvasId)].slice(0, MAX_RECENT_CANVASES);
        });
        
        console.log('[Workspace Store] Открыт холст:', canvasId);
      },
      
      /**
       * Обновить количество нод в холсте
       */
      updateCanvasNodesCount: (canvasId: string, count: number) => {
        set((state) => {
          const canvas = state.canvases.find(c => c.id === canvasId);
          if (canvas) {
            canvas.nodesCount = count;
          }
        });
      },
      
      // =========================================================================
      // UI ОПЕРАЦИИ
      // =========================================================================
      
      /**
       * Переключить состояние сайдбара
       */
      toggleSidebar: () => {
        set((state) => {
          state.isSidebarCollapsed = !state.isSidebarCollapsed;
        });
      },
      
      /**
       * Выбрать элемент
       */
      selectItem: (id: string, multiSelect: boolean = false) => {
        set((state) => {
          if (multiSelect) {
            // Добавляем/убираем из выбора
            if (state.selectedIds.includes(id)) {
              state.selectedIds = state.selectedIds.filter(i => i !== id);
            } else {
              state.selectedIds.push(id);
            }
          } else {
            // Заменяем выбор
            state.selectedIds = [id];
          }
        });
      },
      
      /**
       * Очистить выбор
       */
      clearSelection: () => {
        set((state) => {
          state.selectedIds = [];
        });
      },
      
      /**
       * Начать редактирование (переименование)
       */
      startEditing: (id: string) => {
        set((state) => {
          state.editingId = id;
        });
      },
      
      /**
       * Завершить редактирование
       */
      stopEditing: () => {
        set((state) => {
          state.editingId = null;
        });
      },
      
      /**
       * Установить drag over состояние
       */
      setDragOver: (id: string | null, type: 'folder' | 'canvas' | 'root' | null) => {
        set((state) => {
          state.dragOverId = id;
          state.dragOverType = type;
        });
      },
      
      /**
       * Очистить ошибку
       */
      clearError: () => {
        set((state) => {
          state.error = null;
        });
      },
      
      // =========================================================================
      // МАССОВЫЕ ОПЕРАЦИИ
      // =========================================================================
      
      /**
       * Удалить выбранные элементы
       */
      deleteSelected: async (): Promise<void> => {
        const { selectedIds, folders, canvases, deleteFolder, deleteCanvas } = get();
        
        // Разделяем на папки и холсты
        const folderIds = selectedIds.filter(id => folders.some(f => f.id === id));
        const canvasIds = selectedIds.filter(id => canvases.some(c => c.id === id));
        
        // Удаляем папки (с содержимым)
        for (const folderId of folderIds) {
          deleteFolder(folderId, true);
        }
        
        // Удаляем холсты
        for (const canvasId of canvasIds) {
          await deleteCanvas(canvasId);
        }
        
        set((state) => {
          state.selectedIds = [];
        });
      },
      
      /**
       * Переместить выбранные элементы в папку
       */
      moveSelectedTo: (folderId: string | null) => {
        const { selectedIds, folders, canvases, moveFolder, moveCanvas } = get();
        
        // Разделяем на папки и холсты
        const folderIds = selectedIds.filter(id => folders.some(f => f.id === id));
        const canvasIds = selectedIds.filter(id => canvases.some(c => c.id === id));
        
        // Перемещаем папки
        for (const id of folderIds) {
          moveFolder(id, folderId);
        }
        
        // Перемещаем холсты
        for (const id of canvasIds) {
          moveCanvas(id, folderId);
        }
        
        set((state) => {
          state.selectedIds = [];
        });
      },
    }))
  )
);

// =============================================================================
// АВТОСОХРАНЕНИЕ
// =============================================================================

/**
 * Таймер для debounce автосохранения
 */
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Задержка перед автосохранением (мс)
 */
const AUTOSAVE_DELAY = 500;

/**
 * Флаг: была ли выполнена первоначальная загрузка
 */
let hasLoadedInitialData = false;

/**
 * Подписка на изменения для автосохранения
 */
useWorkspaceStore.subscribe(
  // Селектор: отслеживаем изменения данных
  (state) => ({
    folders: state.folders,
    canvases: state.canvases,
    recent: state.recent,
    activeCanvasId: state.activeCanvasId,
  }),
  
  // Callback при изменениях
  (current, previous) => {
    // Пропускаем если данные не изменились
    if (
      current.folders === previous.folders &&
      current.canvases === previous.canvases &&
      current.recent === previous.recent &&
      current.activeCanvasId === previous.activeCanvasId
    ) {
      return;
    }
    
    // Пропускаем если ещё не загрузили начальные данные
    if (!hasLoadedInitialData) {
      return;
    }
    
    // Пропускаем если идёт загрузка или сохранение
    const state = useWorkspaceStore.getState();
    if (state.isLoading || state.isSaving) {
      return;
    }
    
    // Очищаем предыдущий таймер
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    // Устанавливаем новый таймер
    saveTimeout = setTimeout(() => {
      console.log('[Workspace Store] Автосохранение...');
      useWorkspaceStore.getState().saveWorkspace();
    }, AUTOSAVE_DELAY);
  },
  
  {
    equalityFn: (a, b) =>
      a.folders === b.folders &&
      a.canvases === b.canvases &&
      a.recent === b.recent &&
      a.activeCanvasId === b.activeCanvasId,
  }
);

/**
 * Функция для пометки что начальные данные загружены
 */
export const markWorkspaceLoaded = () => {
  hasLoadedInitialData = true;
};

/**
 * Функция для сброса флага (для тестов)
 */
export const resetWorkspaceLoadedFlag = () => {
  hasLoadedInitialData = false;
};

// =============================================================================
// СЕЛЕКТОРЫ
// =============================================================================

/**
 * Селектор: получить холсты в папке
 */
export const selectCanvasesInFolder = (folderId: string | null) => (state: WorkspaceStore) =>
  state.canvases
    .filter(c => c.folderId === folderId)
    .sort((a, b) => a.order - b.order);

/**
 * Селектор: получить подпапки
 */
export const selectSubfolders = (parentId: string | null) => (state: WorkspaceStore) =>
  state.folders
    .filter(f => f.parentId === parentId)
    .sort((a, b) => a.order - b.order);

/**
 * Селектор: получить недавние холсты
 */
export const selectRecentCanvases = (state: WorkspaceStore) =>
  state.recent
    .map(id => state.canvases.find(c => c.id === id))
    .filter((c): c is CanvasMeta => c !== undefined);

/**
 * Селектор: получить активный холст
 */
export const selectActiveCanvas = (state: WorkspaceStore) =>
  state.canvases.find(c => c.id === state.activeCanvasId) || null;

/**
 * Селектор: проверить выбран ли элемент
 */
export const selectIsSelected = (id: string) => (state: WorkspaceStore) =>
  state.selectedIds.includes(id);

/**
 * Селектор: проверить редактируется ли элемент
 */
export const selectIsEditing = (id: string) => (state: WorkspaceStore) =>
  state.editingId === id;

