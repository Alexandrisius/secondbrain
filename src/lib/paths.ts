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

// =============================================================================
// ГЛОБАЛЬНАЯ БИБЛИОТЕКА ДОКУМЕНТОВ (data/library)
// =============================================================================
//
// Новый слой хранения (по согласованной архитектуре):
// - Мы используем глобальную библиотеку документов, доступную с любого холста по `docId`.
//
// Почему библиотека — это отдельная директория:
// - У документов появляется собственный жизненный цикл (rename/move/trash/gc),
// - Ссылки на документ живут в разных холстах (usage-index),
// - Один и тот же файл может быть привязан к разным карточкам/холстам.
//
// Структура на диске:
// - data/library/files/<docId>       — "живой" файл (имя = docId, без дополнительных поддиректорий)
// - data/library/.trash/<docId>      — корзина (soft-delete)
// - data/library/library-index.json  — основной индекс (папки + метаданные документов)
// - data/library/usage-index.json    — обратные ссылки (какие холсты/ноды используют docId)
//
// ВАЖНО (безопасность):
// - Эти функции ТОЛЬКО строят пути.
// - Валидация docId (формат UUID+ext) должна выполняться в API routes
//   ДО вызова getLibraryFilePath()/getLibraryTrashFilePath(), чтобы исключить path traversal.

/**
 * Получает путь к корневой директории глобальной библиотеки документов.
 *
 * @returns Абсолютный путь к `data/library`
 */
export function getLibraryDirectory(): string {
  return path.join(getDataDirectory(), 'library');
}

/**
 * Получает путь к директории, где лежат "живые" файлы документов библиотеки.
 *
 * Структура:
 * - data/library/files/<docId>
 */
export function getLibraryFilesDirectory(): string {
  return path.join(getLibraryDirectory(), 'files');
}

/**
 * Получает путь к директории "корзины" библиотеки.
 *
 * Зачем нужна корзина (soft-delete):
 * - UI/undo/redo может временно вернуть ссылку на документ,
 * - пользователь может передумать и "восстановить",
 * - GC (удаление навсегда) делаем отдельно и только если нет ссылок.
 *
 * Структура:
 * - data/library/.trash/<docId>
 */
export function getLibraryTrashDirectory(): string {
  return path.join(getLibraryDirectory(), '.trash');
}

/**
 * Путь к основному индексному файлу библиотеки.
 *
 * Структура:
 * - data/library/library-index.json
 */
export function getLibraryIndexPath(): string {
  return path.join(getLibraryDirectory(), 'library-index.json');
}

/**
 * Путь к файлу индекса "использований" (обратных ссылок).
 *
 * Структура:
 * - data/library/usage-index.json
 */
export function getLibraryUsageIndexPath(): string {
  return path.join(getLibraryDirectory(), 'usage-index.json');
}

/**
 * Получает путь к файлу документа (живой файл) по docId.
 *
 * ВАЖНО:
 * - Эта функция НЕ валидирует docId.
 * - docId должен быть проверен в API route на соответствие ожидаемому формату
 *   (UUID + '.' + ext), чтобы исключить path traversal.
 */
export function getLibraryFilePath(docId: string): string {
  return path.join(getLibraryFilesDirectory(), docId);
}

/**
 * Получает путь к файлу документа внутри корзины по docId.
 *
 * ВАЖНО:
 * - Эта функция НЕ валидирует docId.
 * - docId должен быть проверен в API route на соответствие ожидаемому формату.
 */
export function getLibraryTrashFilePath(docId: string): string {
  return path.join(getLibraryTrashDirectory(), docId);
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
  console.log('  Library directory:', getLibraryDirectory());
  console.log('  Library files directory:', getLibraryFilesDirectory());
  console.log('  Library trash directory:', getLibraryTrashDirectory());
  console.log('  Library index:', getLibraryIndexPath());
  console.log('  Library usage index:', getLibraryUsageIndexPath());
  console.log('  Index file:', getIndexFilePath());
}

