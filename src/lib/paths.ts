/**
 * @file paths.ts
 * @description Утилиты для определения путей к данным приложения
 * 
 * В Electron приложении данные должны храниться в пользовательской папке:
 * - Windows: %APPDATA%\NeuroCanvas\data\
 * - macOS: ~/Library/Application Support/NeuroCanvas/data/
 * - Linux: ~/.config/NeuroCanvas/data/
 * 
 * В dev режиме (без Electron) данные хранятся в ./data/ относительно проекта.
 * 
 * Путь к userData передаётся из Electron через переменную окружения USER_DATA_PATH.
 */

import path from 'path';

// =============================================================================
// ОПРЕДЕЛЕНИЕ ПУТЕЙ
// =============================================================================

/**
 * Получает базовую директорию для хранения данных приложения
 * 
 * @returns Абсолютный путь к директории данных
 * 
 * @example
 * // В Electron (Windows):
 * getDataDirectory() // => "C:\Users\username\AppData\Roaming\NeuroCanvas\data"
 * 
 * // В dev режиме:
 * getDataDirectory() // => "D:\Project\AI\secondbrain\data"
 */
export function getDataDirectory(): string {
  // Проверяем наличие USER_DATA_PATH от Electron
  const userDataPath = process.env.USER_DATA_PATH;
  
  if (userDataPath) {
    // Electron режим: данные в пользовательской папке
    // Добавляем подпапку 'data' для организации
    return path.join(userDataPath, 'data');
  }
  
  // Dev режим или запуск без Electron: данные рядом с проектом
  return path.join(process.cwd(), 'data');
}

/**
 * Получает путь к директории с файлами холстов
 * 
 * @returns Абсолютный путь к директории canvases
 */
export function getCanvasesDirectory(): string {
  return path.join(getDataDirectory(), 'canvases');
}

/**
 * Получает путь к индексному файлу workspace
 * 
 * @returns Абсолютный путь к index.json
 */
export function getIndexFilePath(): string {
  return path.join(getDataDirectory(), 'index.json');
}

/**
 * Получает путь к файлу конкретного холста
 * 
 * @param canvasId - ID холста
 * @returns Абсолютный путь к JSON файлу холста
 */
export function getCanvasFilePath(canvasId: string): string {
  return path.join(getCanvasesDirectory(), `${canvasId}.json`);
}

/**
 * Логирует текущие настройки путей (для отладки)
 */
export function logPathsInfo(): void {
  console.log('[Paths] Конфигурация путей:');
  console.log('  USER_DATA_PATH:', process.env.USER_DATA_PATH || '(не установлено)');
  console.log('  Data directory:', getDataDirectory());
  console.log('  Canvases directory:', getCanvasesDirectory());
  console.log('  Index file:', getIndexFilePath());
}

