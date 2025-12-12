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
 * Поддерживаемые API провайдеры (OpenAI-совместимые)
 * 
 * - openai: Официальный OpenAI API
 * - openrouter: OpenRouter - агрегатор моделей
 * - vsellm: vsellm.ru - российский прокси
 * - groq: Groq - быстрый inference
 * - together: Together AI - много open-source моделей
 * - custom: Любой OpenAI-совместимый API (LM Studio, Ollama, etc.)
 */
export type ApiProvider = 'openai' | 'openrouter' | 'vsellm' | 'groq' | 'together' | 'custom';

/**
 * Информация о модели эмбеддингов
 */
export interface EmbeddingsModelInfo {
  /** ID модели для API запроса */
  id: string;
  /** Отображаемое имя */
  name: string;
  /** Размерность вектора */
  dimension: number;
  /** Описание модели */
  description: string;
}

/**
 * Конфигурация API провайдера
 */
export interface ApiProviderConfig {
  /** Отображаемое имя провайдера */
  name: string;
  /** Базовый URL для Chat API */
  baseUrl: string;
  /** Базовый URL для Embeddings API (пустая строка если не поддерживается) */
  embeddingsUrl: string;
  /** Поддерживает ли провайдер эмбеддинги */
  supportsEmbeddings: boolean;
  /** Описание провайдера */
  description: string;
  /** Модель эмбеддингов по умолчанию */
  defaultEmbeddingsModel: string;
  /** Доступные модели эмбеддингов для провайдера */
  embeddingsModels: EmbeddingsModelInfo[];
}

/**
 * Предустановленные конфигурации провайдеров
 * 
 * Все провайдеры используют OpenAI-совместимый API формат.
 */
export const API_PROVIDERS: Record<ApiProvider, ApiProviderConfig> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    embeddingsUrl: 'https://api.openai.com/v1',
    supportsEmbeddings: true,
    description: 'Официальный API OpenAI (GPT-4, GPT-3.5)',
    defaultEmbeddingsModel: 'text-embedding-3-small',
    embeddingsModels: [
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimension: 1536, description: 'Быстрая и экономичная (рекомендуется)' },
      { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', dimension: 3072, description: 'Высочайшее качество' },
      { id: 'text-embedding-ada-002', name: 'Ada 002', dimension: 1536, description: 'Предыдущее поколение' },
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    embeddingsUrl: 'https://openrouter.ai/api/v1',
    supportsEmbeddings: true,
    description: 'Агрегатор моделей (GPT, Claude, Llama и др.)',
    // Qwen3 Embedding 8B - мощная мультиязычная модель с высокой размерностью
    defaultEmbeddingsModel: 'qwen/qwen3-embedding-8b',
    embeddingsModels: [
      // Qwen3 - новейшая модель от Alibaba, отличное качество для русского и английского
      { id: 'qwen/qwen3-embedding-8b', name: 'Qwen3 Embedding 8B', dimension: 4096, description: 'Мощная мультиязычная (рекомендуется)' },
      // Multilingual E5 - хорошая альтернатива для 90+ языков
      { id: 'intfloat/multilingual-e5-large', name: 'Multilingual E5 Large', dimension: 1024, description: '90+ языков, компактная' },
      { id: 'intfloat/e5-large-v2', name: 'E5 Large v2', dimension: 1024, description: 'Высокое качество, английский' },
      { id: 'intfloat/e5-base-v2', name: 'E5 Base v2', dimension: 768, description: 'Баланс скорости и качества' },
      // BAAI BGE - качественные модели для английского
      { id: 'baai/bge-large-en-v1.5', name: 'BGE Large EN v1.5', dimension: 1024, description: 'BAAI, английский' },
      { id: 'baai/bge-base-en-v1.5', name: 'BGE Base EN v1.5', dimension: 768, description: 'BAAI, компактная' },
      // GTE - модели от Thenlper
      { id: 'thenlper/gte-large', name: 'GTE Large', dimension: 1024, description: 'Thenlper, 1024-dim' },
      { id: 'thenlper/gte-base', name: 'GTE Base', dimension: 768, description: 'Thenlper, компактная' },
    ],
  },
  vsellm: {
    name: 'vsellm.ru',
    baseUrl: 'https://api.vsellm.ru/v1',
    embeddingsUrl: 'https://api.vsellm.ru/v1',
    supportsEmbeddings: true,
    description: 'Российский прокси с оплатой в рублях',
    defaultEmbeddingsModel: 'text-embedding-3-small',
    embeddingsModels: [
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimension: 1536, description: 'Быстрая и экономичная (рекомендуется)' },
      { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', dimension: 3072, description: 'Высочайшее качество' },
      { id: 'text-embedding-ada-002', name: 'Ada 002', dimension: 1536, description: 'Предыдущее поколение' },
    ],
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    embeddingsUrl: '',
    supportsEmbeddings: false,
    description: 'Сверхбыстрый inference (Llama, Mixtral)',
    defaultEmbeddingsModel: '',
    embeddingsModels: [],
  },
  together: {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    embeddingsUrl: 'https://api.together.xyz/v1',
    supportsEmbeddings: true,
    description: 'Open-source модели (Llama, Mistral, Qwen)',
    defaultEmbeddingsModel: 'togethercomputer/m2-bert-80M-8k-retrieval',
    embeddingsModels: [
      { id: 'togethercomputer/m2-bert-80M-8k-retrieval', name: 'M2 BERT 80M Retrieval', dimension: 768, description: 'Оптимизирована для поиска' },
      { id: 'BAAI/bge-large-en-v1.5', name: 'BGE Large EN v1.5', dimension: 1024, description: 'BAAI, высокое качество' },
      { id: 'BAAI/bge-base-en-v1.5', name: 'BGE Base EN v1.5', dimension: 768, description: 'BAAI, компактная' },
    ],
  },
  custom: {
    name: 'Custom',
    baseUrl: '',
    embeddingsUrl: '',
    supportsEmbeddings: true,
    description: 'Любой OpenAI-совместимый API',
    defaultEmbeddingsModel: 'text-embedding-3-small',
    embeddingsModels: [
      { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimension: 1536, description: 'OpenAI стандарт' },
    ],
  },
};

/**
 * Интерфейс настроек приложения
 * 
 * Содержит все глобальные настройки, которые пользователь может изменять.
 */
export interface AppSettings {
  /**
   * API ключ для внешнего LLM провайдера
   * 
   * Используется для авторизации запросов к API.
   * Хранится в localStorage на стороне клиента.
   */
  apiKey: string;
  
  /**
   * Выбранный API провайдер
   * 
   * Определяет базовый URL для запросов к API.
   * По умолчанию: 'vsellm' для обратной совместимости
   */
  apiProvider: ApiProvider;
  
  /**
   * Базовый URL для Chat/Completions API
   * 
   * Автоматически устанавливается при выборе провайдера.
   * Для 'custom' провайдера вводится вручную.
   * Формат: https://api.example.com/v1 (без /chat/completions)
   */
  apiBaseUrl: string;
  
  /**
   * Базовый URL для Embeddings API
   * 
   * Может отличаться от apiBaseUrl.
   * Пустая строка если провайдер не поддерживает эмбеддинги.
   */
  embeddingsBaseUrl: string;
  
  /**
   * Название модели для использования
   * 
   * Формат: "провайдер/модель", например "openai/gpt-4o"
   * или просто "gpt-4o" в зависимости от API провайдера
   * По умолчанию: "openai/chatgpt-4o-latest"
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
  
  /**
   * Корпоративный режим (отключение проверки SSL сертификатов)
   * 
   * Когда true:
   * - Отключается проверка SSL сертификатов для API запросов
   * - Позволяет работать в корпоративных сетях с SSL-инспекцией
   * - ВНИМАНИЕ: снижает безопасность, использовать только в доверенных сетях!
   * 
   * По умолчанию: false (полная проверка SSL)
   */
  corporateMode: boolean;
  
  /**
   * Модель эмбеддингов для семантического поиска
   * 
   * Разные провайдеры поддерживают разные модели.
   * При смене модели требуется переиндексация базы!
   */
  embeddingsModel: string;

  /**
   * Ширина карточек по умолчанию (в пикселях)
   * 
   * Используется при создании новых карточек.
   * По умолчанию: 400
   */
  defaultCardWidth: number;
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
   * Установить API провайдера
   * Автоматически обновляет apiBaseUrl и embeddingsBaseUrl
   * @param provider - Идентификатор провайдера
   */
  setApiProvider: (provider: ApiProvider) => void;
  
  /**
   * Установить базовый URL для API (только для custom провайдера)
   * @param url - Базовый URL (например "http://localhost:1234/v1")
   */
  setApiBaseUrl: (url: string) => void;
  
  /**
   * Установить базовый URL для Embeddings API
   * @param url - Базовый URL для эмбеддингов
   */
  setEmbeddingsBaseUrl: (url: string) => void;
  
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
   * Включить/выключить корпоративный режим
   * @param enabled - true для включения, false для выключения
   */
  setCorporateMode: (enabled: boolean) => void;
  
  /**
   * Установить модель эмбеддингов
   * ВАЖНО: При смене модели требуется переиндексация базы!
   * @param model - ID модели эмбеддингов
   */
  setEmbeddingsModel: (model: string) => void;

  /**
   * Установить ширину карточек по умолчанию
   * @param width - Ширина в пикселях
   */
  setDefaultCardWidth: (width: number) => void;
  
  /**
   * Сбросить все настройки к значениям по умолчанию
   */
  resetSettings: () => void;
}

// =============================================================================
// ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ
// =============================================================================

/**
 * Провайдер по умолчанию
 * 
 * Используем vsellm для обратной совместимости с существующими пользователями
 */
const DEFAULT_PROVIDER: ApiProvider = 'vsellm';

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
  // Провайдер по умолчанию - vsellm.ru для обратной совместимости
  apiProvider: DEFAULT_PROVIDER,
  // Базовый URL берём из конфигурации провайдера
  apiBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
  // URL для эмбеддингов
  embeddingsBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].embeddingsUrl,
  // Модель по умолчанию - GPT-4o через OpenAI
  model: DEFAULT_MODEL,
  // По умолчанию суммаризация включена для экономии токенов
  useSummarization: true,
  // Язык интерфейса по умолчанию - русский
  language: 'ru',
  // Корпоративный режим по умолчанию выключен (полная проверка SSL)
  corporateMode: false,
  // Модель эмбеддингов по умолчанию из конфигурации провайдера
  embeddingsModel: API_PROVIDERS[DEFAULT_PROVIDER].defaultEmbeddingsModel,
  // Ширина карточек по умолчанию - 400px
  defaultCardWidth: 400,
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
       * Установить API провайдера
       * 
       * При смене провайдера автоматически обновляются URL адреса
       * и модель эмбеддингов на значения по умолчанию для нового провайдера.
       * Для custom провайдера URL остаются пустыми - пользователь должен ввести их вручную.
       * 
       * ВАЖНО: При смене провайдера может измениться модель эмбеддингов,
       * что требует переиндексации базы!
       * 
       * @param provider - Идентификатор провайдера
       */
      setApiProvider: (provider: ApiProvider) => {
        const config = API_PROVIDERS[provider];
        set({
          apiProvider: provider,
          // Для custom оставляем текущие URL или пустые
          apiBaseUrl: provider === 'custom' ? '' : config.baseUrl,
          embeddingsBaseUrl: provider === 'custom' ? '' : config.embeddingsUrl,
          // Устанавливаем модель эмбеддингов по умолчанию для провайдера
          embeddingsModel: config.defaultEmbeddingsModel,
        });
      },
      
      /**
       * Установить базовый URL для API
       * 
       * Обычно используется только для custom провайдера.
       * 
       * @param url - Базовый URL (например "http://localhost:1234/v1")
       */
      setApiBaseUrl: (url: string) => {
        set({ apiBaseUrl: url });
      },
      
      /**
       * Установить базовый URL для Embeddings API
       * 
       * @param url - Базовый URL для эмбеддингов
       */
      setEmbeddingsBaseUrl: (url: string) => {
        set({ embeddingsBaseUrl: url });
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
       * Установить корпоративный режим
       * 
       * Отключает проверку SSL сертификатов для работы в корпоративных сетях
       * с SSL-инспекцией (DLP, прокси и т.д.)
       * 
       * @param enabled - true для включения, false для выключения
       */
      setCorporateMode: (enabled: boolean) => {
        set({ corporateMode: enabled });
      },
      
      /**
       * Установить модель эмбеддингов
       * 
       * ВАЖНО: При смене модели требуется переиндексация базы!
       * Разные модели имеют разную размерность векторов,
       * поэтому старые эмбеддинги несовместимы с новой моделью.
       * 
       * @param model - ID модели эмбеддингов
       */
      setEmbeddingsModel: (model: string) => {
        set({ embeddingsModel: model });
      },

      /**
       * Установить ширину карточек по умолчанию
       * 
       * @param width - Ширина в пикселях
       */
      setDefaultCardWidth: (width: number) => {
        // Ограничиваем значение в допустимом диапазоне [300, 1200]
        // чтобы предотвратить поломку верстки при некорректных значениях
        const clampedWidth = Math.max(300, Math.min(width, 1200));
        set({ defaultCardWidth: clampedWidth });
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
      // ВАЖНО: увеличена с 6 до 7 при добавлении defaultCardWidth
      version: 7,
      
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
            apiProvider: DEFAULT_PROVIDER,
            apiBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
            embeddingsBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].embeddingsUrl,
            corporateMode: false,
            embeddingsModel: API_PROVIDERS[DEFAULT_PROVIDER].defaultEmbeddingsModel,
            defaultCardWidth: 400,
          };
        }
        
        // Миграция с версии 2 на версию 3: добавляем language
        if (version < 3) {
          return {
            ...state,
            language: 'ru',
            apiProvider: DEFAULT_PROVIDER,
            apiBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
            embeddingsBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].embeddingsUrl,
            corporateMode: false,
            embeddingsModel: API_PROVIDERS[DEFAULT_PROVIDER].defaultEmbeddingsModel,
            defaultCardWidth: 400,
          };
        }
        
        // Миграция с версии 3 на версию 4: добавляем поддержку провайдеров
        if (version < 4) {
          return {
            ...state,
            // Для существующих пользователей устанавливаем vsellm как провайдер
            // (это сохраняет обратную совместимость)
            apiProvider: DEFAULT_PROVIDER,
            apiBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
            embeddingsBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].embeddingsUrl,
            corporateMode: false,
            embeddingsModel: API_PROVIDERS[DEFAULT_PROVIDER].defaultEmbeddingsModel,
            defaultCardWidth: 400,
          };
        }
        
        // Миграция с версии 4 на версию 5: добавляем корпоративный режим
        if (version < 5) {
          const provider = (state.apiProvider || DEFAULT_PROVIDER) as ApiProvider;
          return {
            ...state,
            corporateMode: false,
            embeddingsModel: API_PROVIDERS[provider].defaultEmbeddingsModel,
            defaultCardWidth: 400,
          };
        }
        
        // Миграция с версии 5 на версию 6: добавляем выбор модели эмбеддингов
        if (version < 6) {
          // Определяем модель эмбеддингов на основе текущего провайдера
          const provider = state.apiProvider || DEFAULT_PROVIDER;
          const providerConfig = API_PROVIDERS[provider as ApiProvider];
          return {
            ...state,
            embeddingsModel: providerConfig?.defaultEmbeddingsModel || 'text-embedding-3-small',
            defaultCardWidth: 400,
          };
        }

        // Миграция с версии 6 на версию 7: добавляем defaultCardWidth
        if (version < 7) {
          return {
            ...state,
            defaultCardWidth: 400,
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
 * Селектор для получения API провайдера
 * 
 * @example
 * const apiProvider = useSettingsStore(selectApiProvider);
 */
export const selectApiProvider = (state: SettingsStore) => state.apiProvider;

/**
 * Селектор для получения функции изменения API провайдера
 */
export const selectSetApiProvider = (state: SettingsStore) => state.setApiProvider;

/**
 * Селектор для получения базового URL API
 * 
 * @example
 * const apiBaseUrl = useSettingsStore(selectApiBaseUrl);
 */
export const selectApiBaseUrl = (state: SettingsStore) => state.apiBaseUrl;

/**
 * Селектор для получения функции изменения базового URL
 */
export const selectSetApiBaseUrl = (state: SettingsStore) => state.setApiBaseUrl;

/**
 * Селектор для получения базового URL для эмбеддингов
 * 
 * @example
 * const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
 */
export const selectEmbeddingsBaseUrl = (state: SettingsStore) => state.embeddingsBaseUrl;

/**
 * Селектор для получения функции изменения URL эмбеддингов
 */
export const selectSetEmbeddingsBaseUrl = (state: SettingsStore) => state.setEmbeddingsBaseUrl;

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
 * Селектор для получения корпоративного режима
 * 
 * @example
 * const corporateMode = useSettingsStore(selectCorporateMode);
 */
export const selectCorporateMode = (state: SettingsStore) => state.corporateMode;

/**
 * Селектор для получения функции изменения корпоративного режима
 */
export const selectSetCorporateMode = (state: SettingsStore) => state.setCorporateMode;

/**
 * Селектор для получения модели эмбеддингов
 * 
 * @example
 * const embeddingsModel = useSettingsStore(selectEmbeddingsModel);
 */
export const selectEmbeddingsModel = (state: SettingsStore) => state.embeddingsModel;

/**
 * Селектор для получения функции изменения модели эмбеддингов
 */
export const selectSetEmbeddingsModel = (state: SettingsStore) => state.setEmbeddingsModel;

/**
 * Селектор для получения ширины карточек по умолчанию
 * 
 * @example
 * const defaultCardWidth = useSettingsStore(selectDefaultCardWidth);
 */
export const selectDefaultCardWidth = (state: SettingsStore) => state.defaultCardWidth;

/**
 * Селектор для получения функции изменения ширины карточек
 */
export const selectSetDefaultCardWidth = (state: SettingsStore) => state.setDefaultCardWidth;

/**
 * Селектор для получения функции сброса настроек
 */
export const selectResetSettings = (state: SettingsStore) => state.resetSettings;

