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
 * Получает путь к директории, где хранятся ВСЕ вложения приложения.
 *
 * Структура:
 * - data/attachments/<canvasId>/<attachmentId>
 *
 * Почему отдельная директория:
 * - canvas JSON остаётся компактным (не храним base64)
 * - проще отдавать файлы для превью
 * - проще чистить при удалении/дубликате холста
 */
export function getAttachmentsDirectory(): string {
  return path.join(getDataDirectory(), 'attachments');
}

/**
 * Получает путь к директории вложений конкретного холста.
 *
 * @param canvasId - ID холста
 * @returns Абсолютный путь к директории `data/attachments/<canvasId>`
 */
export function getCanvasAttachmentsDirectory(canvasId: string): string {
  return path.join(getAttachmentsDirectory(), canvasId);
}

/**
 * Получает путь к "корзине" вложений конкретного холста.
 *
 * Зачем нужна корзина (soft-delete):
 * - В UI есть undo/redo (zundo), которое откатывает JSON-состояние холста.
 * - Но файловая система НЕ откатывается автоматически.
 * - Если мы физически удалим файл при удалении последней ссылки,
 *   а затем пользователь сделает undo — ссылка вернётся, а файл уже исчез → ошибки.
 *
 * Поэтому:
 * - "Удаление" вложения на уровне карточек = удаление ссылок.
 * - Физическое удаление файла делаем отложенно (GC) или через будущий файловый менеджер.
 * - На первом этапе мы просто переносим файл в `.trash`.
 *
 * Структура:
 * - data/attachments/<canvasId>/.trash/<attachmentId>
 *
 * Важно:
 * - `.trash` лежит ВНУТРИ папки холста, поэтому rename/move обычно атомарны.
 * - Это позволяет быстро "восстановить" файл при необходимости.
 */
export function getCanvasAttachmentsTrashDirectory(canvasId: string): string {
  return path.join(getCanvasAttachmentsDirectory(canvasId), '.trash');
}

/**
 * Путь к файлу вложения внутри "корзины" холста.
 *
 * @param canvasId - ID холста
 * @param attachmentId - ID вложения (UUID + ext)
 */
export function getAttachmentTrashFilePath(canvasId: string, attachmentId: string): string {
  return path.join(getCanvasAttachmentsTrashDirectory(canvasId), attachmentId);
}

/**
 * Путь к индексному файлу вложений конкретного холста.
 *
 * Зачем он нужен:
 * - В будущем у холста появится полноценный файловый менеджер, а карточки будут хранить только ссылки.
 * - Уже сейчас нам нужно уметь:
 *   1) дедуплицировать файлы по имени (в пределах холста),
 *   2) "обновлять файл" при загрузке с тем же именем (upsert),
 *   3) быстро получать метаданные версии файла (updatedAt/fileHash) без сканирования диска.
 *
 * Формат хранения:
 * - data/attachments/<canvasId>/attachments-index.json
 *
 * Важно:
 * - Этот индекс НЕ используется для построения путей к файлам напрямую (пути строятся через attachmentId).
 * - Сам attachmentId остаётся "не угадываемым" (UUID + ext), чтобы не открывать путь для path traversal.
 */
export function getCanvasAttachmentsIndexPath(canvasId: string): string {
  return path.join(getCanvasAttachmentsDirectory(canvasId), 'attachments-index.json');
}

/**
 * Получает путь к файлу вложения по canvasId + attachmentId.
 *
 * ВАЖНО:
 * - Эта функция НЕ делает валидацию `attachmentId` на формат.
 *   Валидацию (regex) мы обязаны делать в API routes ДО вызова этой функции.
 * - Путь строится только через path.join — никаких “сырых” конкатенаций.
 *
 * @param canvasId - ID холста
 * @param attachmentId - ID вложения (UUID + ext)
 * @returns Абсолютный путь к файлу вложения
 */
export function getAttachmentFilePath(canvasId: string, attachmentId: string): string {
  return path.join(getCanvasAttachmentsDirectory(canvasId), attachmentId);
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

