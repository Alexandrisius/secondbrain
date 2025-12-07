/**
 * Store для глобальных настроек приложения
 * 
 * Использует zustand с persist middleware для сохранения настроек
 * в localStorage. Настройки сохраняются между сессиями и перезапусками сервера.
 * 
 * @module useSettingsStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Поддерживаемые языки интерфейса
 */
export type Language = 'ru' | 'en';

/**
 * Интерфейс настроек приложения
 * 
 * Содержит все глобальные настройки, которые пользователь может изменять.
 */
export interface AppSettings {
  /**
   * API ключ для внешнего LLM провайдера (vsellm.ru)
   * 
   * Используется для авторизации запросов к API.
   * Хранится в localStorage на стороне клиента.
   */
  apiKey: string;
  
  /**
   * Название модели для использования
   * 
   * Формат: "провайдер/модель", например "openai/gpt-4o"
   * По умолчанию: "openai/gpt-4o"
   */
  model: string;
  
  /**
   * Флаг использования суммаризации контекста
   * 
   * Когда true (по умолчанию):
   * - Для дедушек и далее используется summary или сокращённый response
   * - После генерации ответа автоматически создаётся summary
   * 
   * Когда false:
   * - Для всех предков используется полный response
   * - Summary не генерируется
   * - Подходит для моделей с большим контекстным окном
   */
  useSummarization: boolean;
  
  /**
   * Язык интерфейса приложения
   * 
   * Поддерживаемые значения:
   * - 'ru' - Русский (по умолчанию)
   * - 'en' - English
   */
  language: Language;
}

/**
 * Интерфейс store настроек
 * 
 * Содержит текущие настройки и методы для их изменения.
 */
export interface SettingsStore extends AppSettings {
  /**
   * Установить API ключ
   * @param key - API ключ для внешнего провайдера
   */
  setApiKey: (key: string) => void;
  
  /**
   * Установить модель
   * @param model - Название модели (например "openai/gpt-4o")
   */
  setModel: (model: string) => void;
  
  /**
   * Включить/выключить суммаризацию контекста
   * @param enabled - true для включения, false для выключения
   */
  setUseSummarization: (enabled: boolean) => void;
  
  /**
   * Установить язык интерфейса
   * @param language - Код языка ('ru' или 'en')
   */
  setLanguage: (language: Language) => void;
  
  /**
   * Сбросить все настройки к значениям по умолчанию
   */
  resetSettings: () => void;
}

// =============================================================================
// ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ
// =============================================================================

/**
 * Модель по умолчанию
 * 
 * Используем chatgpt-4o-latest - актуальная версия GPT-4o
 */
const DEFAULT_MODEL = 'openai/chatgpt-4o-latest';

/**
 * Настройки по умолчанию
 * 
 * Используются при первом запуске или после сброса настроек.
 */
const DEFAULT_SETTINGS: AppSettings = {
  // API ключ пустой по умолчанию - пользователь должен его ввести
  apiKey: '',
  // Модель по умолчанию - GPT-4o через OpenAI
  model: DEFAULT_MODEL,
  // По умолчанию суммаризация включена для экономии токенов
  useSummarization: true,
  // Язык интерфейса по умолчанию - русский
  language: 'ru',
};

// =============================================================================
// STORE
// =============================================================================

/**
 * Zustand store для управления настройками приложения
 * 
 * Особенности:
 * - Автоматическое сохранение в localStorage через persist middleware
 * - Восстановление настроек при загрузке страницы
 * - Типобезопасность через TypeScript
 * 
 * @example
 * // Получение текущего значения настройки
 * const useSummarization = useSettingsStore((state) => state.useSummarization);
 * 
 * @example
 * // Изменение настройки
 * const setUseSummarization = useSettingsStore((state) => state.setUseSummarization);
 * setUseSummarization(false); // Отключить суммаризацию
 * 
 * @example
 * // Сброс к настройкам по умолчанию
 * const resetSettings = useSettingsStore((state) => state.resetSettings);
 * resetSettings();
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      // =========================================================================
      // НАЧАЛЬНЫЕ ЗНАЧЕНИЯ
      // =========================================================================
      
      ...DEFAULT_SETTINGS,
      
      // =========================================================================
      // МЕТОДЫ
      // =========================================================================
      
      /**
       * Установить API ключ
       * 
       * @param key - API ключ для внешнего провайдера
       */
      setApiKey: (key: string) => {
        set({ apiKey: key });
      },
      
      /**
       * Установить модель
       * 
       * @param model - Название модели (например "openai/gpt-4o")
       */
      setModel: (model: string) => {
        set({ model });
      },
      
      /**
       * Установить флаг суммаризации
       * 
       * @param enabled - новое значение флага
       */
      setUseSummarization: (enabled: boolean) => {
        set({ useSummarization: enabled });
      },
      
      /**
       * Установить язык интерфейса
       * 
       * @param language - код языка ('ru' или 'en')
       */
      setLanguage: (language: Language) => {
        set({ language });
      },
      
      /**
       * Сбросить все настройки к значениям по умолчанию
       * 
       * Полезно если пользователь хочет вернуться к исходным настройкам.
       * Внимание: сбрасывает и API ключ!
       */
      resetSettings: () => {
        set(DEFAULT_SETTINGS);
      },
    }),
    {
      // Имя ключа в localStorage
      name: 'secondbrain-settings',
      
      // Версия для миграции при изменении структуры
      // ВАЖНО: увеличена с 2 до 3 при добавлении language
      version: 3,
      
      // Миграция со старой версии
      migrate: (persistedState, version) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const state = persistedState as any;
        
        // Миграция с версии 1 на версию 2: добавляем apiKey и model
        if (version < 2) {
          return {
            ...state,
            apiKey: '',
            model: DEFAULT_MODEL,
            language: 'ru',
          };
        }
        
        // Миграция с версии 2 на версию 3: добавляем language
        if (version < 3) {
          return {
            ...state,
            language: 'ru',
          };
        }
        
        return state as SettingsStore;
      },
    }
  )
);

// =============================================================================
// СЕЛЕКТОРЫ
// =============================================================================

/**
 * Селектор для получения API ключа
 * 
 * @example
 * const apiKey = useSettingsStore(selectApiKey);
 */
export const selectApiKey = (state: SettingsStore) => state.apiKey;

/**
 * Селектор для получения функции изменения API ключа
 */
export const selectSetApiKey = (state: SettingsStore) => state.setApiKey;

/**
 * Селектор для получения модели
 * 
 * @example
 * const model = useSettingsStore(selectModel);
 */
export const selectModel = (state: SettingsStore) => state.model;

/**
 * Селектор для получения функции изменения модели
 */
export const selectSetModel = (state: SettingsStore) => state.setModel;

/**
 * Селектор для получения флага суммаризации
 * 
 * Использование селекторов позволяет избежать лишних ре-рендеров,
 * так как компонент перерисуется только при изменении конкретного значения.
 * 
 * @example
 * const useSummarization = useSettingsStore(selectUseSummarization);
 */
export const selectUseSummarization = (state: SettingsStore) => state.useSummarization;

/**
 * Селектор для получения функции изменения суммаризации
 */
export const selectSetUseSummarization = (state: SettingsStore) => state.setUseSummarization;

/**
 * Селектор для получения языка интерфейса
 * 
 * @example
 * const language = useSettingsStore(selectLanguage);
 */
export const selectLanguage = (state: SettingsStore) => state.language;

/**
 * Селектор для получения функции изменения языка
 */
export const selectSetLanguage = (state: SettingsStore) => state.setLanguage;

/**
 * Селектор для получения функции сброса настроек
 */
export const selectResetSettings = (state: SettingsStore) => state.resetSettings;

