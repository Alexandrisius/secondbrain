/**
 * @file electron/preload.js
 * @description Preload скрипт для безопасного взаимодействия между
 * рендер-процессом (React) и main-процессом (Node.js)
 * 
 * Этот скрипт выполняется ДО загрузки веб-страницы, но имеет доступ
 * к Node.js API. Через contextBridge мы экспортируем безопасный API
 * для использования в React компонентах.
 */

const { contextBridge, ipcRenderer } = require('electron');

// =============================================================================
// ELECTRON API ДЛЯ РЕНДЕРЕРА
// =============================================================================

/**
 * Экспортируем безопасный API в глобальный объект window.electronAPI
 * 
 * Этот API доступен в React компонентах через:
 * window.electronAPI.openExternal('https://example.com')
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Открывает URL во внешнем браузере
   * Используется для ссылок на донаты, документацию и т.д.
   * 
   * @param {string} url - URL для открытия
   * @returns {Promise<boolean>} - true если успешно открыто
   * 
   * @example
   * // В React компоненте:
   * await window.electronAPI.openExternal('https://boosty.to/username');
   */
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  /**
   * Получает версию приложения
   * Отображается в модальном окне "О программе" и в UI
   * 
   * @returns {Promise<string>} - версия приложения (например, "1.0.0")
   * 
   * @example
   * const version = await window.electronAPI.getAppVersion();
   * console.log(`NeuroCanvas v${version}`);
   */
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  /**
   * Проверяет, запущено ли приложение в Electron
   * Позволяет адаптировать UI для desktop версии
   * 
   * @returns {Promise<boolean>} - true если запущено в Electron
   * 
   * @example
   * const isDesktop = await window.electronAPI.isElectron();
   * if (isDesktop) {
   *   // Показываем кнопку донатов в меню
   * }
   */
  isElectron: () => ipcRenderer.invoke('is-electron'),
  
  /**
   * Проверяет наличие обновлений приложения
   * При наличии обновлений показывает диалог, при отсутствии - сообщение "Версия актуальная"
   * 
   * @returns {Promise<boolean>} - true если проверка запущена успешно
   * 
   * @example
   * const success = await window.electronAPI.checkForUpdates();
   * // Диалог покажется автоматически
   */
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  
  /**
   * Информация о платформе
   * Используется для адаптации горячих клавиш и UI
   * 
   * @returns {string} - 'win32' | 'darwin' | 'linux'
   */
  platform: process.platform,
  
  // ===========================================================================
  // МЕТОДЫ ДЛЯ ПРОВЕРКИ НЕСОХРАНЁННЫХ ИЗМЕНЕНИЙ ПРИ ЗАКРЫТИИ
  // ===========================================================================
  
  /**
   * Регистрирует callback для получения статуса несохранённых изменений
   * 
   * Вызывается из React-компонента для регистрации функции,
   * которая будет возвращать текущий статус hasUnsavedChanges.
   * Main процесс вызывает эту функцию через executeJavaScript
   * при попытке закрытия окна.
   * 
   * @param {() => boolean} callback - функция, возвращающая hasUnsavedChanges
   * 
   * @example
   * // В React компоненте:
   * useEffect(() => {
   *   window.electronAPI?.registerUnsavedChangesCallback(() => hasUnsavedChanges);
   *   return () => window.electronAPI?.unregisterUnsavedChangesCallback();
   * }, [hasUnsavedChanges]);
   */
  registerUnsavedChangesCallback: (callback) => {
    window.__getUnsavedChangesStatus = callback;
    console.log('[Electron Preload] Зарегистрирован callback для проверки несохранённых изменений');
  },
  
  /**
   * Удаляет зарегистрированный callback
   * Вызывается при размонтировании компонента
   */
  unregisterUnsavedChangesCallback: () => {
    window.__getUnsavedChangesStatus = null;
    console.log('[Electron Preload] Callback для проверки несохранённых изменений удалён');
  },
  
  /**
   * Регистрирует callback для сохранения холста
   * 
   * Вызывается из React-компонента для регистрации функции сохранения.
   * Main процесс вызывает эту функцию через executeJavaScript
   * когда пользователь выбирает "Сохранить и выйти".
   * 
   * @param {() => Promise<void>} callback - async функция сохранения холста
   * 
   * @example
   * // В React компоненте:
   * useEffect(() => {
   *   window.electronAPI?.registerSaveCallback(saveToFile);
   *   return () => window.electronAPI?.unregisterSaveCallback();
   * }, [saveToFile]);
   */
  registerSaveCallback: (callback) => {
    window.__saveCanvas = callback;
    console.log('[Electron Preload] Зарегистрирован callback для сохранения холста');
  },
  
  /**
   * Удаляет зарегистрированный callback сохранения
   * Вызывается при размонтировании компонента
   */
  unregisterSaveCallback: () => {
    window.__saveCanvas = null;
    console.log('[Electron Preload] Callback для сохранения холста удалён');
  },
});

// =============================================================================
// ТИПЫ ДЛЯ TYPESCRIPT
// =============================================================================

/**
 * Для TypeScript: добавьте этот тип в src/types/electron.d.ts:
 * 
 * declare global {
 *   interface Window {
 *     electronAPI?: {
 *       openExternal: (url: string) => Promise<boolean>;
 *       getAppVersion: () => Promise<string>;
 *       isElectron: () => Promise<boolean>;
 *       platform: string;
 *     };
 *   }
 * }
 */

console.log('[Electron Preload] API exposed to renderer');

