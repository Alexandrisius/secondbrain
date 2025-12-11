/**
 * @file route.ts
 * @description API endpoints для работы с отдельными холстами
 * 
 * Эндпоинты:
 * - GET /api/canvas/[id] - загрузка данных холста (ноды, связи)
 * - POST /api/canvas/[id] - сохранение данных холста
 * - DELETE /api/canvas/[id] - удаление холста
 * 
 * Данные хранятся в пользовательской папке:
 * - Electron: %APPDATA%\NeuroCanvas\data\canvases\
 * - Dev режим: ./data/canvases/
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import type { WorkspaceIndex } from '@/types/workspace';
import { 
  getDataDirectory, 
  getCanvasesDirectory, 
  getCanvasFilePath,
  getIndexFilePath 
} from '@/lib/paths';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Структура данных холста (ноды, связи, системная инструкция)
 */
interface CanvasData {
  /** Массив нод */
  nodes: unknown[];
  /** Массив связей */
  edges: unknown[];
  /** Временная метка последнего сохранения */
  lastSaved: number;
  /** Системная инструкция для холста (опционально) */
  systemPrompt?: string | null;
}

/**
 * Параметры роута
 */
interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

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
    await fs.mkdir(dirPath, { recursive: true });
    console.log('[Canvas API] Создана директория:', dirPath);
  }
}

/**
 * Читает данные холста из файла
 * @param canvasId - ID холста
 * @returns Данные холста или null если файл не существует
 */
async function readCanvasData(canvasId: string): Promise<CanvasData | null> {
  const filePath = getCanvasFilePath(canvasId);
  
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as CanvasData;
  } catch {
    console.log('[Canvas API] Файл холста не найден:', filePath);
    return null;
  }
}

/**
 * Записывает данные холста в файл
 * @param canvasId - ID холста
 * @param data - данные для записи
 */
async function writeCanvasData(canvasId: string, data: CanvasData): Promise<void> {
  const canvasesDir = getCanvasesDirectory();
  await ensureDirectoryExists(canvasesDir);
  
  const filePath = getCanvasFilePath(canvasId);
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
  
  console.log('[Canvas API] Сохранён холст:', filePath);
}

/**
 * Удаляет файл холста
 * @param canvasId - ID холста
 */
async function deleteCanvasFile(canvasId: string): Promise<void> {
  const filePath = getCanvasFilePath(canvasId);
  
  try {
    await fs.access(filePath);
    await fs.unlink(filePath);
    console.log('[Canvas API] Удалён файл:', filePath);
  } catch {
    // Файл не существует - ничего не делаем
  }
}

/**
 * Читает индекс workspace
 * @returns Данные workspace
 */
async function readWorkspaceIndex(): Promise<WorkspaceIndex | null> {
  const indexFile = getIndexFilePath();
  
  try {
    await fs.access(indexFile);
    const content = await fs.readFile(indexFile, 'utf-8');
    return JSON.parse(content) as WorkspaceIndex;
  } catch {
    return null;
  }
}

/**
 * Записывает индекс workspace
 * @param data - данные для записи
 */
async function writeWorkspaceIndex(data: WorkspaceIndex): Promise<void> {
  const dataDir = getDataDirectory();
  await ensureDirectoryExists(dataDir);
  
  const indexFile = getIndexFilePath();
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(indexFile, content, 'utf-8');
}

/**
 * Копирует холст
 * @param sourceId - ID исходного холста
 * @param newId - ID копии
 */
async function copyCanvasFile(sourceId: string, newId: string): Promise<void> {
  const sourceData = await readCanvasData(sourceId);
  
  if (sourceData) {
    await writeCanvasData(newId, {
      ...sourceData,
      lastSaved: Date.now(),
    });
  } else {
    // Если исходный файл не найден - создаём пустой
    await writeCanvasData(newId, {
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
    });
  }
}

// =============================================================================
// GET - Загрузка холста
// =============================================================================

/**
 * GET /api/canvas/[id]
 * Возвращает данные холста (ноды и связи)
 * 
 * @param request - входящий запрос
 * @param params - параметры роута (id холста)
 * @returns JSON с nodes, edges, lastSaved
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: canvasId } = await params;
    
    // Читаем данные холста
    const data = await readCanvasData(canvasId);
    
    if (!data) {
      // Холст не найден - возвращаем начальные данные
      console.log(`[Canvas API] Холст ${canvasId} не найден, возвращаем начальные данные`);
      
      return NextResponse.json({
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
      });
    }
    
    console.log(`[Canvas API] Загружен холст ${canvasId}: ${data.nodes.length} нод`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Canvas API] Ошибка загрузки:', error);
    
    return NextResponse.json(
      { error: 'Не удалось загрузить холст' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Сохранение холста
// =============================================================================

/**
 * POST /api/canvas/[id]
 * Сохраняет данные холста
 * 
 * Поддерживает режимы:
 * 1. Сохранение данных - body содержит nodes и edges
 * 2. Копирование - body содержит { action: 'duplicate', newId, newName }
 * 
 * @param request - входящий запрос
 * @param params - параметры роута (id холста)
 * @returns JSON с подтверждением
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: canvasId } = await params;
    const body = await request.json();
    
    // =========================================================================
    // РЕЖИМ: Копирование холста
    // =========================================================================
    if (body.action === 'duplicate') {
      const { newId, newName } = body;
      
      // Копируем файл холста
      await copyCanvasFile(canvasId, newId);
      
      // Обновляем workspace
      const workspace = await readWorkspaceIndex();
      if (workspace) {
        // Находим исходный холст для копирования метаданных
        const sourceCanvas = workspace.canvases.find(c => c.id === canvasId);
        
        if (sourceCanvas) {
          // Добавляем новый холст в workspace
          workspace.canvases.push({
            id: newId,
            name: newName || `${sourceCanvas.name} (копия)`,
            folderId: sourceCanvas.folderId,
            order: workspace.canvases.filter(c => c.folderId === sourceCanvas.folderId).length,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            nodesCount: sourceCanvas.nodesCount,
          });
          
          await writeWorkspaceIndex(workspace);
        }
      }
      
      console.log(`[Canvas API] Скопирован холст ${canvasId} -> ${newId}`);
      
      return NextResponse.json({
        success: true,
        message: 'Холст успешно скопирован',
      });
    }
    
    // =========================================================================
    // РЕЖИМ: Сохранение данных холста
    // =========================================================================
    
    // Валидация
    if (!body.nodes || !Array.isArray(body.nodes)) {
      return NextResponse.json(
        { error: 'Отсутствует или некорректное поле nodes' },
        { status: 400 }
      );
    }
    
    if (!body.edges || !Array.isArray(body.edges)) {
      return NextResponse.json(
        { error: 'Отсутствует или некорректное поле edges' },
        { status: 400 }
      );
    }
    
    // Формируем данные для записи
    // Включаем systemPrompt если он передан (может быть null или строка)
    const data: CanvasData = {
      nodes: body.nodes,
      edges: body.edges,
      lastSaved: Date.now(),
      // Сохраняем systemPrompt только если он передан в запросе
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
    };
    
    // Сохраняем в файл
    await writeCanvasData(canvasId, data);
    
    // Обновляем nodesCount в workspace
    const workspace = await readWorkspaceIndex();
    if (workspace) {
      const canvasIndex = workspace.canvases.findIndex(c => c.id === canvasId);
      if (canvasIndex !== -1) {
        workspace.canvases[canvasIndex].nodesCount = data.nodes.length;
        workspace.canvases[canvasIndex].updatedAt = Date.now();
        await writeWorkspaceIndex(workspace);
      }
    }
    
    console.log(`[Canvas API] Сохранён холст ${canvasId}: ${data.nodes.length} нод`);
    
    return NextResponse.json({
      success: true,
      message: 'Холст успешно сохранён',
      lastSaved: data.lastSaved,
    });
  } catch (error) {
    console.error('[Canvas API] Ошибка сохранения:', error);
    
    return NextResponse.json(
      { error: 'Не удалось сохранить холст' },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE - Удаление холста
// =============================================================================

/**
 * DELETE /api/canvas/[id]
 * Удаляет холст и его файл
 * 
 * @param request - входящий запрос
 * @param params - параметры роута (id холста)
 * @returns JSON с подтверждением
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: canvasId } = await params;
    
    // Удаляем файл холста
    await deleteCanvasFile(canvasId);
    
    // Обновляем workspace
    const workspace = await readWorkspaceIndex();
    if (workspace) {
      // Удаляем холст из списка
      workspace.canvases = workspace.canvases.filter(c => c.id !== canvasId);
      
      // Удаляем из recent
      workspace.recent = workspace.recent.filter(id => id !== canvasId);
      
      // Если удалённый холст был активным - выбираем другой
      if (workspace.activeCanvasId === canvasId) {
        workspace.activeCanvasId = workspace.canvases[0]?.id || null;
      }
      
      await writeWorkspaceIndex(workspace);
    }
    
    console.log(`[Canvas API] Удалён холст: ${canvasId}`);
    
    return NextResponse.json({
      success: true,
      message: 'Холст успешно удалён',
    });
  } catch (error) {
    console.error('[Canvas API] Ошибка удаления:', error);
    
    return NextResponse.json(
      { error: 'Не удалось удалить холст' },
      { status: 500 }
    );
  }
}
