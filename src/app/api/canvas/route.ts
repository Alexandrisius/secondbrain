/**
 * @file route.ts
 * @description API endpoints для сохранения и загрузки данных Canvas в JSON файл
 * 
 * Эндпоинты:
 * - GET /api/canvas - загрузка данных из файла
 * - POST /api/canvas - сохранение данных в файл
 * 
 * Данные хранятся в пользовательской папке:
 * - Electron: %APPDATA%\NeuroCanvas\data\
 * - Dev режим: ./data/
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getDataDirectory } from '@/lib/paths';

// =============================================================================
// ПУТИ К ДАННЫМ
// =============================================================================

/**
 * Получает путь к директории данных
 * Использует USER_DATA_PATH из Electron или fallback на локальную папку
 */
function getDataDir(): string {
  return getDataDirectory();
}

/**
 * Получает путь к файлу canvas.json (устаревший формат, для совместимости)
 */
function getCanvasFile(): string {
  return path.join(getDataDir(), 'canvas.json');
}

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Структура данных, хранящихся в файле
 */
interface CanvasData {
  /** Массив нод */
  nodes: unknown[];
  /** Массив связей */
  edges: unknown[];
  /** Временная метка последнего сохранения */
  lastSaved: number;
}

/**
 * Начальные данные для нового файла
 * Создаётся одна начальная нода по центру
 */
const DEFAULT_DATA: CanvasData = {
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
        mode: 'input',
        width: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  ],
  edges: [],
  lastSaved: Date.now(),
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
    console.log('[Canvas API] Создана директория:', dirPath);
  }
}

/**
 * Читает данные из JSON файла
 * Если файл не существует - возвращает данные по умолчанию
 * @returns Данные Canvas
 */
async function readCanvasData(): Promise<CanvasData> {
  const canvasFile = getCanvasFile();
  
  try {
    // Проверяем существование файла
    await fs.access(canvasFile);
    
    // Читаем и парсим JSON
    const content = await fs.readFile(canvasFile, 'utf-8');
    const data = JSON.parse(content) as CanvasData;
    
    return data;
  } catch {
    // Файл не существует или невалидный JSON - возвращаем дефолт
    console.log('[Canvas API] Файл не найден, используем данные по умолчанию');
    console.log('[Canvas API] Ожидаемый путь:', canvasFile);
    return { ...DEFAULT_DATA, lastSaved: Date.now() };
  }
}

/**
 * Записывает данные в JSON файл
 * Автоматически создаёт директорию если не существует
 * @param data - данные для записи
 */
async function writeCanvasData(data: CanvasData): Promise<void> {
  const dataDir = getDataDir();
  const canvasFile = getCanvasFile();
  
  // Убеждаемся что директория существует
  await ensureDirectoryExists(dataDir);
  
  // Записываем с красивым форматированием (для удобства отладки)
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(canvasFile, content, 'utf-8');
  
  console.log('[Canvas API] Сохранено в:', canvasFile);
}

// =============================================================================
// GET - Загрузка данных
// =============================================================================

/**
 * GET /api/canvas
 * Возвращает сохранённые данные Canvas из JSON файла
 * 
 * @returns JSON с nodes, edges и lastSaved
 */
export async function GET(): Promise<NextResponse> {
  try {
    const data = await readCanvasData();
    
    console.log(`[Canvas API] Загружено: ${data.nodes.length} нод, ${data.edges.length} связей`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('[Canvas API] Ошибка загрузки:', error);
    
    return NextResponse.json(
      { error: 'Не удалось загрузить данные' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Сохранение данных
// =============================================================================

/**
 * POST /api/canvas
 * Сохраняет данные Canvas в JSON файл
 * 
 * Тело запроса:
 * {
 *   nodes: NeuroNode[],
 *   edges: NeuroEdge[]
 * }
 * 
 * @param request - входящий запрос с данными
 * @returns JSON с подтверждением сохранения
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Парсим тело запроса
    const body = await request.json();
    
    // Валидация: проверяем наличие обязательных полей
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
    const data: CanvasData = {
      nodes: body.nodes,
      edges: body.edges,
      lastSaved: Date.now(),
    };
    
    // Сохраняем в файл
    await writeCanvasData(data);
    
    console.log(`[Canvas API] Сохранено: ${data.nodes.length} нод, ${data.edges.length} связей`);
    
    return NextResponse.json({
      success: true,
      message: 'Данные успешно сохранены',
      lastSaved: data.lastSaved,
    });
  } catch (error) {
    console.error('[Canvas API] Ошибка сохранения:', error);
    
    return NextResponse.json(
      { error: 'Не удалось сохранить данные' },
      { status: 500 }
    );
  }
}
