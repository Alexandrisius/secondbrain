/**
 * @file route.ts
 * @description API endpoint для миграции старого формата canvas.json в новую структуру
 * 
 * Миграция:
 * 1. Читает старый файл data/canvas.json
 * 2. Создаёт index.json с метаданными
 * 3. Перемещает данные холста в data/canvases/[id].json
 * 4. Опционально удаляет старый файл
 * 
 * Эндпоинт:
 * POST /api/migrate - запускает миграцию
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import type { WorkspaceIndex, CanvasMeta } from '@/types/workspace';
import { WORKSPACE_VERSION } from '@/types/workspace';

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

const DATA_DIR = path.join(process.cwd(), 'data');
const CANVASES_DIR = path.join(DATA_DIR, 'canvases');
const OLD_CANVAS_FILE = path.join(DATA_DIR, 'canvas.json');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Проверяет существование файла
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Создаёт директорию если не существует
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

// =============================================================================
// POST - Запуск миграции
// =============================================================================

/**
 * POST /api/migrate
 * Мигрирует старый формат canvas.json в новую структуру workspace
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_request: NextRequest): Promise<NextResponse> {
  try {
    // =========================================================================
    // ШАГ 1: Проверяем существование старого файла
    // =========================================================================
    
    const oldFileExists = await fileExists(OLD_CANVAS_FILE);
    const indexExists = await fileExists(INDEX_FILE);
    
    // Если уже есть index.json и нет старого файла - миграция не нужна
    if (indexExists && !oldFileExists) {
      return NextResponse.json({
        success: true,
        message: 'Миграция не требуется - новая структура уже существует',
        migrated: false,
      });
    }
    
    // Если нет ни старого файла, ни index.json - создаём новый workspace
    if (!oldFileExists && !indexExists) {
      await ensureDirectoryExists(DATA_DIR);
      await ensureDirectoryExists(CANVASES_DIR);
      
      // Создаём начальный холст
      const initialCanvasId = `canvas-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      const initialCanvas: CanvasMeta = {
        id: initialCanvasId,
        name: 'Главный холст',
        folderId: null,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodesCount: 1,
      };
      
      const workspace: WorkspaceIndex = {
        folders: [],
        canvases: [initialCanvas],
        recent: [initialCanvasId],
        activeCanvasId: initialCanvasId,
        version: WORKSPACE_VERSION,
      };
      
      // Сохраняем index.json
      await fs.writeFile(INDEX_FILE, JSON.stringify(workspace, null, 2), 'utf-8');
      
      // Создаём файл холста
      const canvasData = {
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
      
      const canvasFilePath = path.join(CANVASES_DIR, `${initialCanvasId}.json`);
      await fs.writeFile(canvasFilePath, JSON.stringify(canvasData, null, 2), 'utf-8');
      
      return NextResponse.json({
        success: true,
        message: 'Создан новый workspace с начальным холстом',
        migrated: true,
        canvasId: initialCanvasId,
      });
    }
    
    // =========================================================================
    // ШАГ 2: Читаем старый файл
    // =========================================================================
    
    const oldContent = await fs.readFile(OLD_CANVAS_FILE, 'utf-8');
    const oldData = JSON.parse(oldContent);
    
    // =========================================================================
    // ШАГ 3: Создаём директории
    // =========================================================================
    
    await ensureDirectoryExists(CANVASES_DIR);
    
    // =========================================================================
    // ШАГ 4: Генерируем ID для мигрированного холста
    // =========================================================================
    
    const migratedCanvasId = `canvas-migrated-${Date.now()}`;
    
    // =========================================================================
    // ШАГ 5: Создаём файл холста в новом формате
    // =========================================================================
    
    const canvasData = {
      nodes: oldData.nodes || [],
      edges: oldData.edges || [],
      lastSaved: oldData.lastSaved || Date.now(),
    };
    
    const canvasFilePath = path.join(CANVASES_DIR, `${migratedCanvasId}.json`);
    await fs.writeFile(canvasFilePath, JSON.stringify(canvasData, null, 2), 'utf-8');
    
    // =========================================================================
    // ШАГ 6: Создаём или обновляем index.json
    // =========================================================================
    
    let workspace: WorkspaceIndex;
    
    if (indexExists) {
      // Читаем существующий index и добавляем мигрированный холст
      const indexContent = await fs.readFile(INDEX_FILE, 'utf-8');
      workspace = JSON.parse(indexContent) as WorkspaceIndex;
      
      // Добавляем мигрированный холст
      const migratedCanvas: CanvasMeta = {
        id: migratedCanvasId,
        name: 'Мигрированный холст',
        folderId: null,
        order: workspace.canvases.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodesCount: oldData.nodes?.length || 0,
      };
      
      workspace.canvases.push(migratedCanvas);
      
      // Если нет активного холста - устанавливаем мигрированный
      if (!workspace.activeCanvasId) {
        workspace.activeCanvasId = migratedCanvasId;
      }
      
      // Добавляем в recent
      workspace.recent = [migratedCanvasId, ...workspace.recent].slice(0, 5);
    } else {
      // Создаём новый index
      const migratedCanvas: CanvasMeta = {
        id: migratedCanvasId,
        name: 'Главный холст',
        folderId: null,
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        nodesCount: oldData.nodes?.length || 0,
      };
      
      workspace = {
        folders: [],
        canvases: [migratedCanvas],
        recent: [migratedCanvasId],
        activeCanvasId: migratedCanvasId,
        version: WORKSPACE_VERSION,
      };
    }
    
    // Сохраняем index.json
    await fs.writeFile(INDEX_FILE, JSON.stringify(workspace, null, 2), 'utf-8');
    
    // =========================================================================
    // ШАГ 7: Переименовываем старый файл (бэкап)
    // =========================================================================
    
    const backupPath = path.join(DATA_DIR, `canvas.backup-${Date.now()}.json`);
    await fs.rename(OLD_CANVAS_FILE, backupPath);
    
    console.log(`[Migration] Миграция завершена. Старый файл сохранён как ${backupPath}`);
    
    return NextResponse.json({
      success: true,
      message: 'Миграция успешно завершена',
      migrated: true,
      canvasId: migratedCanvasId,
      nodesCount: oldData.nodes?.length || 0,
      backupPath: path.basename(backupPath),
    });
    
  } catch (error) {
    console.error('[Migration] Ошибка миграции:', error);
    
    return NextResponse.json(
      { 
        error: 'Ошибка при миграции', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET - Проверка статуса миграции
// =============================================================================

/**
 * GET /api/migrate
 * Проверяет нужна ли миграция
 */
export async function GET(): Promise<NextResponse> {
  try {
    const oldFileExists = await fileExists(OLD_CANVAS_FILE);
    const indexExists = await fileExists(INDEX_FILE);
    
    return NextResponse.json({
      needsMigration: oldFileExists,
      hasNewStructure: indexExists,
      oldFilePath: oldFileExists ? 'data/canvas.json' : null,
    });
  } catch (error) {
    console.error('[Migration] Ошибка проверки:', error);
    
    return NextResponse.json(
      { error: 'Ошибка проверки статуса миграции' },
      { status: 500 }
    );
  }
}

