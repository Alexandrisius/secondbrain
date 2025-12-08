/**
 * @file route.ts
 * @description API endpoints для управления workspace (index.json)
 * 
 * Эндпоинты:
 * - GET /api/workspace - загрузка структуры workspace (папки, метаданные холстов)
 * - POST /api/workspace - сохранение структуры workspace
 * 
 * Данные хранятся в пользовательской папке:
 * - Electron: %APPDATA%\NeuroCanvas\data\index.json
 * - Dev режим: ./data/index.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import type { WorkspaceIndex, Folder, CanvasMeta } from '@/types/workspace';
import { WORKSPACE_VERSION } from '@/types/workspace';
import { 
  getDataDirectory, 
  getCanvasesDirectory, 
  getIndexFilePath,
  getCanvasFilePath,
  logPathsInfo 
} from '@/lib/paths';

// =============================================================================
// НАЧАЛЬНЫЕ ДАННЫЕ
// =============================================================================

/**
 * Создание начального холста для нового workspace
 */
const createInitialCanvas = (): CanvasMeta => ({
  id: `canvas-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
  name: 'Главный холст',
  folderId: null,
  order: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  nodesCount: 1,
});

/**
 * Начальные данные для нового workspace
 */
const createDefaultWorkspace = (): WorkspaceIndex => {
  const initialCanvas = createInitialCanvas();
  return {
    folders: [],
    canvases: [initialCanvas],
    recent: [initialCanvas.id],
    activeCanvasId: initialCanvas.id,
    version: WORKSPACE_VERSION,
  };
};

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Проверяет существование директории и создаёт её при необходимости
 * @param dirPath - путь к директории
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    // Директория не существует - создаём
    await fs.mkdir(dirPath, { recursive: true });
    console.log('[Workspace API] Создана директория:', dirPath);
  }
}

/**
 * Читает данные workspace из index.json
 * Если файл не существует - возвращает данные по умолчанию
 * @returns Данные workspace
 */
async function readWorkspaceIndex(): Promise<WorkspaceIndex> {
  const indexFile = getIndexFilePath();
  
  try {
    // Проверяем существование файла
    await fs.access(indexFile);
    
    // Читаем и парсим JSON
    const content = await fs.readFile(indexFile, 'utf-8');
    const data = JSON.parse(content) as WorkspaceIndex;
    
    return data;
  } catch {
    // Файл не существует или невалидный JSON
    console.log('[Workspace API] Индексный файл не найден, создаём новый workspace');
    console.log('[Workspace API] Ожидаемый путь:', indexFile);
    return createDefaultWorkspace();
  }
}

/**
 * Записывает данные workspace в index.json
 * @param data - данные для записи
 */
async function writeWorkspaceIndex(data: WorkspaceIndex): Promise<void> {
  const dataDir = getDataDirectory();
  const canvasesDir = getCanvasesDirectory();
  const indexFile = getIndexFilePath();
  
  // Убеждаемся что директории существуют
  await ensureDirectoryExists(dataDir);
  await ensureDirectoryExists(canvasesDir);
  
  // Записываем с форматированием для удобства отладки
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(indexFile, content, 'utf-8');
  
  console.log('[Workspace API] Сохранено в:', indexFile);
}

/**
 * Создаёт файл холста с начальными данными
 * @param canvasId - ID холста
 */
async function createCanvasFile(canvasId: string): Promise<void> {
  const canvasesDir = getCanvasesDirectory();
  await ensureDirectoryExists(canvasesDir);
  
  // Начальные данные для нового холста (одна пустая нода)
  const initialData = {
    nodes: [
      {
        id: 'node-initial',
        type: 'neuro',
        position: { x: 250, y: 200 },
        data: {
          prompt: '',
          response: null,
          summary: null,
          isGenerating: false,
          isSummarizing: false,
          isStale: false,
          isAnswerExpanded: false,
          mode: 'input',
          quote: null,
          quoteSourceNodeId: null,
          quoteOriginalResponse: null,
          isQuoteInvalidated: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    ],
    edges: [],
    lastSaved: Date.now(),
  };
  
  const filePath = getCanvasFilePath(canvasId);
  await fs.writeFile(filePath, JSON.stringify(initialData, null, 2), 'utf-8');
  
  console.log('[Workspace API] Создан файл холста:', filePath);
}

// =============================================================================
// GET - Загрузка workspace
// =============================================================================

/**
 * GET /api/workspace
 * Возвращает структуру workspace (папки и метаданные холстов)
 * 
 * @returns JSON с folders, canvases, recent, activeCanvasId
 */
export async function GET(): Promise<NextResponse> {
  try {
    // Логируем пути при первом запросе (для отладки)
    logPathsInfo();
    
    const data = await readWorkspaceIndex();
    
    console.log(
      `[Workspace API] Загружено: ${data.folders.length} папок, ${data.canvases.length} холстов`
    );
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Workspace API] Ошибка загрузки:', error);
    
    return NextResponse.json(
      { error: 'Не удалось загрузить workspace' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Сохранение workspace
// =============================================================================

/**
 * POST /api/workspace
 * Сохраняет структуру workspace
 * 
 * Поддерживает два режима:
 * 1. Полное сохранение - body содержит весь workspace
 * 2. Создание холста - body содержит { action: 'createCanvas', name, folderId }
 * 
 * @param request - входящий запрос с данными
 * @returns JSON с подтверждением или созданным холстом
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    
    // =========================================================================
    // РЕЖИМ: Создание нового холста
    // =========================================================================
    if (body.action === 'createCanvas') {
      const { name, folderId } = body;
      
      // Читаем текущий workspace
      const workspace = await readWorkspaceIndex();
      
      // Создаём метаданные нового холста
      const newCanvas: CanvasMeta = {
        id: `canvas-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: name || 'Новый холст',
        folderId: folderId || null,
        order: workspace.canvases.filter(c => c.folderId === (folderId || null)).length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodesCount: 1,
      };
      
      // Добавляем в workspace
      workspace.canvases.push(newCanvas);
      workspace.activeCanvasId = newCanvas.id;
      
      // Добавляем в recent (в начало)
      workspace.recent = [newCanvas.id, ...workspace.recent.filter(id => id !== newCanvas.id)].slice(0, 5);
      
      // Сохраняем workspace
      await writeWorkspaceIndex(workspace);
      
      // Создаём файл холста
      await createCanvasFile(newCanvas.id);
      
      console.log(`[Workspace API] Создан холст: ${newCanvas.name} (${newCanvas.id})`);
      
      return NextResponse.json({
        success: true,
        canvas: newCanvas,
      });
    }
    
    // =========================================================================
    // РЕЖИМ: Создание папки
    // =========================================================================
    if (body.action === 'createFolder') {
      const { name, parentId } = body;
      
      // Читаем текущий workspace
      const workspace = await readWorkspaceIndex();
      
      // Создаём новую папку
      const newFolder: Folder = {
        id: `folder-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: name || 'Новая папка',
        parentId: parentId || null,
        order: workspace.folders.filter(f => f.parentId === (parentId || null)).length,
        isExpanded: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      // Добавляем в workspace
      workspace.folders.push(newFolder);
      
      // Сохраняем
      await writeWorkspaceIndex(workspace);
      
      console.log(`[Workspace API] Создана папка: ${newFolder.name} (${newFolder.id})`);
      
      return NextResponse.json({
        success: true,
        folder: newFolder,
      });
    }
    
    // =========================================================================
    // РЕЖИМ: Полное сохранение workspace
    // =========================================================================
    
    // Валидация
    if (!body.folders || !Array.isArray(body.folders)) {
      return NextResponse.json(
        { error: 'Отсутствует или некорректное поле folders' },
        { status: 400 }
      );
    }
    
    if (!body.canvases || !Array.isArray(body.canvases)) {
      return NextResponse.json(
        { error: 'Отсутствует или некорректное поле canvases' },
        { status: 400 }
      );
    }
    
    // Формируем данные для записи
    const data: WorkspaceIndex = {
      folders: body.folders,
      canvases: body.canvases,
      recent: body.recent || [],
      activeCanvasId: body.activeCanvasId || null,
      version: WORKSPACE_VERSION,
    };
    
    // Сохраняем в файл
    await writeWorkspaceIndex(data);
    
    console.log(
      `[Workspace API] Сохранено: ${data.folders.length} папок, ${data.canvases.length} холстов`
    );
    
    return NextResponse.json({
      success: true,
      message: 'Workspace успешно сохранён',
    });
  } catch (error) {
    console.error('[Workspace API] Ошибка:', error);
    
    return NextResponse.json(
      { error: 'Не удалось выполнить операцию' },
      { status: 500 }
    );
  }
}
