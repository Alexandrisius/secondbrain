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

  // ===========================================================================
  // SECURE STORAGE (API KEY)
  // ===========================================================================

  /**
   * Проверяет, доступно ли шифрование/дешифрование (electron.safeStorage) на текущей системе.
   *
   * Если возвращает false:
   * - UI должен скрыть/задизейблить режим “Сохранять в хранилище ОС”.
   */
  isSecureApiKeyAvailable: () => Promise<boolean>;

  /**
   * Получить сохранённый API-ключ из защищённого хранилища ОС.
   *
   * @returns строку ключа или null если ключ отсутствует/недоступен
   */
  getSecureApiKey: () => Promise<string | null>;

  /**
   * Сохранить API-ключ в защищённом хранилище ОС.
   *
   * @returns true если сохранено успешно
   */
  setSecureApiKey: (key: string) => Promise<boolean>;

  /**
   * Удалить API-ключ из защищённого хранилища ОС.
   *
   * @returns true если удалено успешно (или ключа не было)
   */
  deleteSecureApiKey: () => Promise<boolean>;
  
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
  
  // ===========================================================================
  // МЕТОДЫ ДЛЯ ПРОВЕРКИ НЕСОХРАНЁННЫХ ИЗМЕНЕНИЙ ПРИ ЗАКРЫТИИ
  // ===========================================================================
  
  /**
   * Регистрирует callback для получения статуса несохранённых изменений
   * 
   * Main процесс вызывает эту функцию через executeJavaScript
   * при попытке закрытия окна для проверки наличия несохранённых изменений.
   * 
   * @param callback - функция, возвращающая текущий статус hasUnsavedChanges
   * 
   * @example
   * window.electronAPI?.registerUnsavedChangesCallback(() => hasUnsavedChanges);
   */
  registerUnsavedChangesCallback: (callback: () => boolean) => void;
  
  /**
   * Удаляет зарегистрированный callback для проверки несохранённых изменений
   * Вызывается при размонтировании компонента
   */
  unregisterUnsavedChangesCallback: () => void;
  
  /**
   * Регистрирует callback для сохранения холста
   * 
   * Main процесс вызывает эту функцию через executeJavaScript
   * когда пользователь выбирает "Сохранить и выйти" в диалоге закрытия.
   * 
   * @param callback - async функция сохранения холста
   * 
   * @example
   * window.electronAPI?.registerSaveCallback(saveToFile);
   */
  registerSaveCallback: (callback: () => Promise<void>) => void;
  
  /**
   * Удаляет зарегистрированный callback сохранения
   * Вызывается при размонтировании компонента
   */
  unregisterSaveCallback: () => void;
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

