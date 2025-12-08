/**
 * @file electron.d.ts
 * @description TypeScript типы для Electron API
 * 
 * Этот файл объявляет типы для window.electronAPI,
 * который экспортируется из electron/preload.js
 */

// =============================================================================
// ТИПЫ ELECTRON API
// =============================================================================

/**
 * Интерфейс Electron API, доступного в рендерере
 * Используется для взаимодействия с desktop-функциями
 */
interface ElectronAPI {
  /**
   * Открывает URL во внешнем системном браузере
   * 
   * @param url - URL для открытия (должен начинаться с http:// или https://)
   * @returns Promise<boolean> - true если успешно открыто
   * 
   * @example
   * await window.electronAPI?.openExternal('https://boosty.to/neurocanvas');
   */
  openExternal: (url: string) => Promise<boolean>;
  
  /**
   * Получает версию приложения из package.json
   * 
   * @returns Promise<string> - версия (например, "1.0.0")
   * 
   * @example
   * const version = await window.electronAPI?.getAppVersion();
   */
  getAppVersion: () => Promise<string>;
  
  /**
   * Проверяет, запущено ли приложение в Electron
   * Полезно для условного рендеринга desktop-специфичных элементов
   * 
   * @returns Promise<boolean> - true если запущено в Electron
   * 
   * @example
   * const isDesktop = await window.electronAPI?.isElectron();
   * if (isDesktop) {
   *   // Показываем кнопку донатов
   * }
   */
  isElectron: () => Promise<boolean>;
  
  /**
   * Проверяет наличие обновлений приложения
   * При наличии обновлений показывает диалог с предложением скачать
   * При отсутствии обновлений показывает сообщение "Версия программы актуальная"
   * 
   * @returns Promise<boolean> - true если проверка запущена успешно
   * 
   * @example
   * const success = await window.electronAPI?.checkForUpdates();
   * // Диалог результата покажется автоматически
   */
  checkForUpdates: () => Promise<boolean>;
  
  /**
   * Текущая платформа операционной системы
   * 
   * @returns 'win32' | 'darwin' | 'linux'
   * 
   * @example
   * if (window.electronAPI?.platform === 'darwin') {
   *   // macOS-специфичная логика
   * }
   */
  platform: 'win32' | 'darwin' | 'linux';
}

// =============================================================================
// РАСШИРЕНИЕ ГЛОБАЛЬНЫХ ТИПОВ
// =============================================================================

/**
 * Расширяем глобальный интерфейс Window
 * Добавляем electronAPI как опциональное свойство
 * (будет undefined в браузере, определено в Electron)
 */
declare global {
  interface Window {
    /**
     * API для взаимодействия с Electron
     * undefined если запущено в обычном браузере
     */
    electronAPI?: ElectronAPI;
  }
}

// Экспортируем пустой объект для того, чтобы файл стал модулем
export {};

