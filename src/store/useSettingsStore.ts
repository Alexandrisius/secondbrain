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
// КАТАЛОГ МОДЕЛЕЙ (ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ)
// =============================================================================
//
// ВАЖНО:
// - Список chat-моделей и их maxContextTokens хранится в src/lib/aiCatalog.ts
// - Это позволяет:
//   - отображать модели в UI с контекстом,
//   - в будущем использовать maxContextTokens в логике приложения,
//   - быстро обновлять список моделей одним файлом.
//
// Здесь мы берём только те значения, которые нужны “на уровне настроек”:
// - дефолтная chat-модель
// - дефолтная embedding-модель OpenRouter
// - список embedding-моделей OpenRouter (с размерностями)
import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_OPENROUTER_EMBEDDING_MODEL_ID,
  EMBEDDING_MODELS,
  type ModelDeveloper,
} from '@/lib/aiCatalog';

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
 * ВАЖНО: мы оставляем только два режима работы:
 * - openrouter: OpenRouter — агрегатор моделей (vendor/model)
 * - custom: Любой OpenAI-совместимый API (пользователь вводит URL)
 *
 * При этом для обратной совместимости “custom” по умолчанию предзаполнен
 * значениями VSELLM, потому что исторически большинство пользователей
 * использовали именно его.
 */
export type ApiProvider = 'openrouter' | 'custom';

/**
 * Режим хранения API-ключа.
 *
 * ВАЖНО (про безопасность):
 * - `memory` (по умолчанию) означает: ключ НИКОГДА не пишется в localStorage/IndexedDB,
 *   он живёт только в памяти процесса/вкладки. Это самый безопасный режим для клиента.
 * - `osVault` означает: ключ хранится в защищённом хранилище ОС через Electron main-process
 *   (Windows Credential/DPAPI, macOS Keychain, Linux Secret Service — через electron.safeStorage).
 *
 * Почему мы вообще делаем `osVault`:
 * - В desktop-приложении пользователь ожидает поведение “как у нормальных приложений”:
 *   ключ сохраняется безопасно и подхватывается при старте.
 *
 * Ограничения (важно понимать и явно документируем):
 * - Никакой клиентский способ НЕ защищает от вредоносных расширений/малвари на машине.
 * - Но мы устраняем базовую уязвимость “ключ лежит в localStorage в открытом виде”.
 */
export type ApiKeyStorageMode = 'memory' | 'osVault';

// =============================================================================
// URL ПО УМОЛЧАНИЮ ДЛЯ CUSTOM (VSELLM)
// =============================================================================
//
// ВАЖНО:
// - Пользователь всегда может заменить эти URL на свои.
// - Но для миграции и “из коробки” мы подставляем VSELLM,
//   чтобы существующие пользователи ничего не потеряли.
const DEFAULT_CUSTOM_BASE_URL = 'https://api.vsellm.ru/v1';

/**
 * Информация о модели эмбеддингов
 */
export interface EmbeddingsModelInfo {
  /** ID модели для API запроса */
  id: string;
  /**
   * Разработчик модели (для группировки в UI).
   *
   * ВАЖНО:
   * - Это поле нужно не только “для красоты”.
   * - Оно позволяет в будущем строить логику по вендорам (например, фильтры/подсказки).
   */
  developer: ModelDeveloper;
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
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    embeddingsUrl: 'https://openrouter.ai/api/v1',
    supportsEmbeddings: true,
    description: 'Агрегатор моделей (GPT, Claude, Llama и др.)',
    // ВАЖНО: список embedding-моделей берём из src/lib/aiCatalog.ts
    // чтобы UI и данные были синхронизированы.
    defaultEmbeddingsModel: DEFAULT_OPENROUTER_EMBEDDING_MODEL_ID,
    embeddingsModels: EMBEDDING_MODELS.map((m) => ({
      id: m.id,
      developer: m.developer,
      name: m.displayName,
      dimension: m.dimension,
      description: m.description,
    })),
  },
  custom: {
    name: 'Custom',
    // ВАЖНО:
    // - custom означает “любой OpenAI-compatible”.
    // - Но чтобы старые пользователи не потеряли работоспособность,
    //   мы предзаполняем сюда VSELLM URL.
    baseUrl: DEFAULT_CUSTOM_BASE_URL,
    embeddingsUrl: DEFAULT_CUSTOM_BASE_URL,
    supportsEmbeddings: true,
    description: 'Любой OpenAI-совместимый API (по умолчанию: VSELLM)',
    // Для custom (VSELLM) оставляем “классическое” имя без префикса,
    // потому что многие OpenAI-compatible провайдеры ожидают именно его.
    defaultEmbeddingsModel: 'text-embedding-3-small',
    embeddingsModels: [
      // Минимально безопасный набор для OpenAI-compatible API.
      // Если понадобится — список можно расширить или сделать ручной ввод в UI.
      { id: 'text-embedding-3-small', developer: 'OpenAI', name: 'Text Embedding 3 Small', dimension: 1536, description: 'Стандартный вариант (рекомендуется)' },
      { id: 'text-embedding-3-large', developer: 'OpenAI', name: 'Text Embedding 3 Large', dimension: 3072, description: 'Более высокое качество (если поддерживается)' },
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
   *
   * ВАЖНО (безопасность):
   * - Начиная с версии v11 настроек, мы БОЛЬШЕ НЕ сохраняем ключ в localStorage.
   * - Значение живёт только в памяти (режим `apiKeyStorageMode: 'memory'`)
   *   либо хранится в OS vault (режим `apiKeyStorageMode: 'osVault'`, desktop/Electron).
   *
   * Почему так:
   * - localStorage доступен любому JS на странице → при XSS ключ утекает мгновенно.
   */
  apiKey: string;

  /**
   * Режим хранения API-ключа (см. `ApiKeyStorageMode`).
   *
   * ВАЖНО:
   * - Этот флаг МОЖНО persist'ить (он не секретный).
   * - Сам `apiKey` persist'ить НЕЛЬЗЯ.
   */
  apiKeyStorageMode: ApiKeyStorageMode;
  
  /**
   * Выбранный API провайдер
   * 
   * Определяет базовый URL для запросов к API.
   * По умолчанию: 'custom' (с предзаполненным URL VSELLM) для обратной совместимости
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
   * По умолчанию: "google/gemini-2.5-flash"
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
   * Чувствительность NeuroSearch (порог минимальной семантической близости).
   *
   * Как это работает:
   * - NeuroSearch строит embedding запроса и ищет похожие карточки по cosine similarity.
   * - `neuroSearchMinSimilarity` — это “нижний порог” (0..1), ниже которого карточки
   *   считаются недостаточно похожими и не попадают в результаты.
   *
   * Интерпретация:
   * - МЕНЬШЕ значение → поиск БОЛЕЕ чувствительный (больше результатов, больше шума).
   * - БОЛЬШЕ значение → поиск БОЛЕЕ строгий (меньше результатов, выше точность).
   *
   * Дефолт: 0.5 (как было захардкожено ранее в NeuroSearch).
   */
  neuroSearchMinSimilarity: number;

  /**
   * Ширина карточек по умолчанию (в пикселях)
   * 
   * Используется при создании новых карточек.
   * По умолчанию: 400
   */
  defaultCardWidth: number;

  /**
   * Высота “контентной” части карточки по умолчанию (в пикселях)
   *
   * Что это означает в UI:
   * - Для AI-карточек: максимальная высота раскрытого блока ответа (скролл внутри).
   * - Для NoteNode: максимальная высота скроллируемой области заметки.
   *
   * Зачем это нужно:
   * - Сейчас эти высоты были захардкожены (обычно 400px).
   * - Пользователи хотят подстроить плотность интерфейса под свой экран/привычки.
   *
   * По умолчанию: 400
   */
  defaultCardContentHeight: number;
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
   * Установить режим хранения API-ключа.
   *
   * ВАЖНО:
   * - Этот метод меняет ТОЛЬКО флаг режима.
   * - Реальные операции “сохранить в OS vault / удалить из OS vault / загрузить из OS vault”
   *   выполняются отдельными методами ниже, потому что:
   *   - они асинхронные,
   *   - они доступны только в Electron,
   *   - они могут завершиться ошибкой (например, если шифрование недоступно).
   */
  setApiKeyStorageMode: (mode: ApiKeyStorageMode) => void;

  /**
   * Загрузить API-ключ из защищённого хранилища ОС (если доступно).
   *
   * Поведение:
   * - Если ключ найден → кладём его в `state.apiKey` (только в памяти) и возвращаем строку.
   * - Если ключ отсутствует / недоступно / ошибка → возвращаем null и НЕ падаем.
   */
  loadApiKeyFromSecureStore: () => Promise<string | null>;

  /**
   * Сохранить API-ключ в защищённом хранилище ОС (Electron).
   *
   * ВАЖНО:
   * - В localStorage ключ не пишется даже в этом режиме.
   * - Возвращаем boolean, чтобы UI мог показать “сохранено/ошибка”.
   */
  persistApiKeyToSecureStore: (key: string) => Promise<boolean>;

  /**
   * Удалить API-ключ из защищённого хранилища ОС (Electron).
   *
   * Используем при переключении режима обратно на `memory`,
   * чтобы на диске не оставалось “следов” ключа.
   */
  deleteApiKeyFromSecureStore: () => Promise<boolean>;
  
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
   * Установить чувствительность NeuroSearch (порог minSimilarity).
   *
   * Мы всегда clamp'им в диапазон [0, 1], чтобы:
   * - UI не мог записать некорректные значения,
   * - searchSimilar() не получал “мусор” в параметрах.
   */
  setNeuroSearchMinSimilarity: (value: number) => void;

  /**
   * Установить ширину карточек по умолчанию
   * @param width - Ширина в пикселях
   */
  setDefaultCardWidth: (width: number) => void;

  /**
   * Установить высоту “контентной” части карточек по умолчанию
   *
   * ВАЖНО:
   * - Это “максимальная” высота: контент внутри прокручивается.
   * - Clamp нужен, чтобы некорректные значения не ломали верстку
   *   (например, слишком маленькие или слишком большие).
   *
   * @param height - Высота в пикселях
   */
  setDefaultCardContentHeight: (height: number) => void;
  
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
 * ВАЖНО:
 * - Мы оставили только openrouter + custom.
 * - По умолчанию ставим custom, но с URL VSELLM внутри (см. DEFAULT_CUSTOM_BASE_URL),
 *   потому что существующие пользователи исторически использовали VSELLM.
 */
const DEFAULT_PROVIDER: ApiProvider = 'custom';

/**
 * Модель по умолчанию
 * 
 * По вашему требованию: google/gemini-2.5-flash
 *
 * ВАЖНО:
 * - Это значение синхронизировано с каталогом моделей (src/lib/aiCatalog.ts),
 *   чтобы “дефолт” был единым во всём приложении.
 */
const DEFAULT_MODEL = DEFAULT_CHAT_MODEL_ID;

/**
 * Настройки по умолчанию
 * 
 * Используются при первом запуске или после сброса настроек.
 */
const DEFAULT_SETTINGS: AppSettings = {
  // API ключ пустой по умолчанию - пользователь должен его ввести
  apiKey: '',
  // По умолчанию: НЕ сохраняем ключ вообще (самый безопасный режим на клиенте)
  apiKeyStorageMode: 'memory',
  // Провайдер по умолчанию - custom (с URL VSELLM внутри)
  apiProvider: DEFAULT_PROVIDER,
  // Базовый URL берём из конфигурации провайдера
  apiBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].baseUrl,
  // URL для эмбеддингов
  embeddingsBaseUrl: API_PROVIDERS[DEFAULT_PROVIDER].embeddingsUrl,
  // Модель по умолчанию - Gemini 2.5 Flash (как вы указали)
  model: DEFAULT_MODEL,
  // По умолчанию суммаризация включена для экономии токенов
  useSummarization: true,
  // Язык интерфейса по умолчанию - русский
  language: 'ru',
  // Корпоративный режим по умолчанию выключен (полная проверка SSL)
  corporateMode: false,
  // Модель эмбеддингов по умолчанию из конфигурации провайдера
  embeddingsModel: API_PROVIDERS[DEFAULT_PROVIDER].defaultEmbeddingsModel,
  // Чувствительность NeuroSearch по умолчанию — как было раньше (hardcode 0.5)
  neuroSearchMinSimilarity: 0.5,
  // Ширина карточек по умолчанию - 400px
  defaultCardWidth: 400,
  // Высота контентной части карточек по умолчанию - 400px
  // (применяется и к ответам AI-карточек, и к области заметок NoteNode)
  defaultCardContentHeight: 400,
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
  // ---------------------------------------------------------------------------
  // ВАЖНО ПРО PERSIST И ТИПЫ (критично для Next.js build)
  // ---------------------------------------------------------------------------
  //
  // Zustand persist сохраняет состояние в localStorage через JSON.stringify.
  // Это означает, что:
  // - поля-методы (function) НЕ сериализуются и НЕ попадают в persistedState,
  // - в persistedState остаются только “данные” (наши настройки: AppSettings).
  //
  // Раньше migrate() пытался собрать объект типа SettingsStore (который включает
  // обязательные методы setApiKey/setApiProvider/...), объединяя DEFAULT_SETTINGS
  // и persisted-данные. TypeScript справедливо ругался: persistedState не может
  // гарантировать наличие методов (они там физически отсутствуют).
  //
  // Поэтому мы:
  // - в migrate() возвращаем AppSettings, а не SettingsStore,
  // - методы остаются “живыми” из initializer’а ниже и не участвуют в миграции.
  //
  // Примечание про generics:
  // - В разных версиях Zustand сигнатура persist<> отличается.
  // - В вашей версии второй generic НЕ означает “persisted state slice”,
  //   поэтому мы не задаём его здесь, чтобы не ломать типы StateCreator.
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
       * Установить режим хранения API-ключа (см. комментарии в типах выше).
       */
      setApiKeyStorageMode: (mode: ApiKeyStorageMode) => {
        set({ apiKeyStorageMode: mode });
      },

      /**
       * Загрузить API-ключ из OS vault (Electron).
       *
       * ВАЖНО:
       * - Мы делаем этот метод максимально “мягким”: он НИКОГДА не бросает исключение наружу,
       *   потому что UI не должен ломаться из-за проблем с хранилищем.
       * - В браузерном режиме (не Electron) метод просто возвращает null.
       */
      loadApiKeyFromSecureStore: async () => {
        // Защита от SSR/Next.js server context
        if (typeof window === 'undefined') return null;

        // В браузере window.electronAPI отсутствует
        const api = window.electronAPI;
        if (!api?.getSecureApiKey) return null;

        try {
          const value = await api.getSecureApiKey();
          const key = typeof value === 'string' ? value : '';
          if (key.trim().length === 0) return null;
          // Кладём ключ ТОЛЬКО в память (store state), не persist'им его.
          set({ apiKey: key });
          return key;
        } catch {
          // Никаких подробностей здесь: не логируем ошибки с потенциальными секретами.
          return null;
        }
      },

      /**
       * Сохранить ключ в OS vault (Electron).
       */
      persistApiKeyToSecureStore: async (key: string) => {
        if (typeof window === 'undefined') return false;
        const api = window.electronAPI;
        if (!api?.setSecureApiKey) return false;

        try {
          // ВАЖНО: мы специально не тримим ключ — некоторые провайдеры могут иметь значимые пробелы.
          return await api.setSecureApiKey(key);
        } catch {
          return false;
        }
      },

      /**
       * Удалить ключ из OS vault (Electron).
       */
      deleteApiKeyFromSecureStore: async () => {
        if (typeof window === 'undefined') return false;
        const api = window.electronAPI;
        if (!api?.deleteSecureApiKey) return false;

        try {
          return await api.deleteSecureApiKey();
        } catch {
          return false;
        }
      },
      
      /**
       * Установить API провайдера
       * 
       * При смене провайдера автоматически обновляются URL адреса
       * и модель эмбеддингов на значения по умолчанию для нового провайдера.
       *
       * ВАЖНО (по требованию проекта):
       * - custom провайдер по умолчанию НЕ пустой.
       * - Мы предзаполняем его URL значениями VSELLM, чтобы существующие пользователи
       *   “после чистки провайдеров” продолжили работать без ручной настройки.
       * - При этом пользователь всё равно может отредактировать URL вручную.
       * 
       * ВАЖНО: При смене провайдера может измениться модель эмбеддингов,
       * что требует переиндексации базы!
       * 
       * @param provider - Идентификатор провайдера
       */
      setApiProvider: (provider: ApiProvider) => {
        const config = API_PROVIDERS[provider];
        set((state) => {
          // Общее для обоих провайдеров: всегда обновляем provider и дефолтную модель эмбеддингов.
          // Это важно, потому что разные провайдеры/модели эмбеддингов могут иметь разную
          // размерность векторов и требуют переиндексации.
          const next: Partial<SettingsStore> = {
            apiProvider: provider,
            embeddingsModel: config.defaultEmbeddingsModel,
          };

          // -------------------------------------------------------------------
          // openrouter: URL жёстко фиксирован (пользователь не редактирует)
          // -------------------------------------------------------------------
          if (provider === 'openrouter') {
            next.apiBaseUrl = config.baseUrl;
            next.embeddingsBaseUrl = config.embeddingsUrl;
            return next;
          }

          // -------------------------------------------------------------------
          // custom: URL можно редактировать, но мы хотим:
          // - при первой смене на custom предзаполнить VSELLM (config.baseUrl),
          // - НЕ затирать уже введённые пользователем URL, если он уже был на custom.
          // -------------------------------------------------------------------
          const hasApiUrl = typeof state.apiBaseUrl === 'string' && state.apiBaseUrl.trim().length > 0;
          const hasEmbeddingsUrl = typeof state.embeddingsBaseUrl === 'string' && state.embeddingsBaseUrl.trim().length > 0;

          const wasCustom = state.apiProvider === 'custom';

          next.apiBaseUrl = wasCustom && hasApiUrl ? state.apiBaseUrl : config.baseUrl;
          next.embeddingsBaseUrl = wasCustom && hasEmbeddingsUrl ? state.embeddingsBaseUrl : config.embeddingsUrl;

          return next;
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
       * Установить порог для NeuroSearch.
       *
       * ВАЖНО:
       * - Делаем clamp в [0, 1]
       * - Округление НЕ делаем намеренно:
       *   пусть UI решает step, а store хранит точное число.
       */
      setNeuroSearchMinSimilarity: (value: number) => {
        const clamped = Math.max(0, Math.min(value, 1));
        set({ neuroSearchMinSimilarity: clamped });
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
       * Установить высоту контентной части карточек по умолчанию
       *
       * Почему clamp именно такой:
       * - ниже 150px карточка становится слишком “низкой”, скролл превращается в мучение
       * - выше 1200px карточка начинает занимать слишком много экрана и ухудшает навигацию
       *
       * Диапазон можно расширить в будущем, если появится запрос.
       *
       * @param height - Высота в пикселях
       */
      setDefaultCardContentHeight: (height: number) => {
        // Ограничиваем значение в допустимом диапазоне [150, 1200]
        // чтобы предотвратить поломку верстки при некорректных значениях
        const clampedHeight = Math.max(150, Math.min(height, 1200));
        set({ defaultCardContentHeight: clampedHeight });
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
      // ВАЖНО: увеличена с 7 до 8 при добавлении neuroSearchMinSimilarity
      // ВАЖНО: увеличена с 8 до 9 при добавлении defaultCardContentHeight
      // ВАЖНО: увеличена с 9 до 10 при чистке провайдеров (оставили openrouter+custom)
      // и миграции пользователей на custom с URL VSELLM.
      //
      // ВАЖНО: увеличена с 10 до 11 при внедрении безопасного хранения API-ключа:
      // - apiKey больше НЕ persist'ится
      // - добавлено поле apiKeyStorageMode (persist'ится)
      // - миграция гарантированно очищает старый apiKey из localStorage
      version: 11,

      /**
       * Ограничиваем persisted-state до “не секретных” настроек.
       *
       * Почему это критично:
       * - persist middleware по умолчанию сохраняет ВСЕ сериализуемые поля стора.
       * - Если оставить `apiKey` внутри стора, он уедет в localStorage как обычная строка.
       * - localStorage читается любым JS на странице (XSS/вредные расширения/инъекции).
       *
       * Поэтому мы делаем allow-list полей, которые МОЖНО хранить:
       * - все UI-настройки (модель, язык, URL, флаги, размеры)
       * - режим хранения ключа (apiKeyStorageMode) — это НЕ секрет
       * - и НИКОГДА не сохраняем `apiKey`.
       */
      partialize: (state) => ({
        apiProvider: state.apiProvider,
        apiBaseUrl: state.apiBaseUrl,
        embeddingsBaseUrl: state.embeddingsBaseUrl,
        model: state.model,
        useSummarization: state.useSummarization,
        language: state.language,
        corporateMode: state.corporateMode,
        embeddingsModel: state.embeddingsModel,
        neuroSearchMinSimilarity: state.neuroSearchMinSimilarity,
        defaultCardWidth: state.defaultCardWidth,
        defaultCardContentHeight: state.defaultCardContentHeight,
        apiKeyStorageMode: state.apiKeyStorageMode,
      }),
      
      // Миграция со старой версии
      migrate: (persistedState, version) => {
        // ---------------------------------------------------------------------
        // ВАЖНО ПРО ТИПЫ:
        // ---------------------------------------------------------------------
        // persist middleware типизирует persistedState довольно слабо (как unknown),
        // а по факту localStorage может содержать “грязные” данные:
        // - значения не того типа,
        // - поля из старых версий,
        // - провайдеры, которые мы удалили и больше не поддерживаем.
        //
        // Поэтому мы НЕ доверяем persistedState “как есть” и:
        // - читаем его как Partial<AppSettings>,
        // - отдельные поля валидируем через unknown (ручная нормализация ниже).
        //
        // Поэтому:
        // - описываем минимальный тип persisted-состояния как Partial<AppSettings>
        // - отдельные поля читаем через `unknown`, чтобы валидировать их вручную.
        type PersistedSettings = Partial<AppSettings> & {
          apiProvider?: unknown;
          apiBaseUrl?: unknown;
          embeddingsBaseUrl?: unknown;
          embeddingsModel?: unknown;
          apiKeyStorageMode?: unknown;
        };

        const raw = (persistedState ?? {}) as PersistedSettings;

        // ---------------------------------------------------------------------
        // БАЗОВАЯ МИГРАЦИЯ: “накатываем” новые поля поверх старого состояния
        // ---------------------------------------------------------------------
        //
        // Идея:
        // - DEFAULT_SETTINGS содержит актуальную структуру настроек.
        // - raw содержит сохранённые пользователем значения.
        // - Мы объединяем их так, чтобы:
        //   - новые поля получили дефолты,
        //   - старые пользовательские значения сохранились.
        // ВАЖНО: именно AppSettings (только данные), никаких методов тут быть не должно.
        const next: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...(raw as Partial<AppSettings>),
        };

        // ---------------------------------------------------------------------
        // БЕЗОПАСНОСТЬ: НИКОГДА не восстанавливаем apiKey из persistedState
        // ---------------------------------------------------------------------
        //
        // Исторически apiKey сохранялся в localStorage, что небезопасно.
        // Начиная с v11:
        // - apiKey перестаёт persist'иться (см. partialize выше)
        // - а при миграции мы гарантированно вычищаем его даже из “старых” storage.
        //
        // Важно:
        // - Это означает, что после обновления пользователю нужно либо:
        //   - ввести ключ заново (режим `memory`), либо
        //   - включить `osVault` и сохранить ключ в хранилище ОС (desktop).
        next.apiKey = '';

        // ---------------------------------------------------------------------
        // НОРМАЛИЗАЦИЯ apiKeyStorageMode (v11)
        // ---------------------------------------------------------------------
        const savedMode = typeof raw.apiKeyStorageMode === 'string' ? raw.apiKeyStorageMode : '';
        next.apiKeyStorageMode = (savedMode === 'osVault' || savedMode === 'memory') ? savedMode : 'memory';

        // ---------------------------------------------------------------------
        // ВЕРСИОННЫЕ ДОБАВЛЕНИЯ (исторические поля)
        // ---------------------------------------------------------------------
        // Эти блоки оставлены в виде “страховки”, даже если DEFAULT_SETTINGS уже
        // содержит нужные значения, потому что в старых версиях могли быть
        // некорректные типы (undefined/null) или отсутствовать поля.

        // defaultCardWidth появилось в v7
        if (version < 7 && (next.defaultCardWidth === undefined || next.defaultCardWidth === null)) {
          next.defaultCardWidth = 400;
        }

        // neuroSearchMinSimilarity появилось в v8
        if (version < 8 && (next.neuroSearchMinSimilarity === undefined || next.neuroSearchMinSimilarity === null)) {
          next.neuroSearchMinSimilarity = 0.5;
        }

        // defaultCardContentHeight появилось в v9
        if (version < 9 && (next.defaultCardContentHeight === undefined || next.defaultCardContentHeight === null)) {
          next.defaultCardContentHeight = 400;
        }

        // ---------------------------------------------------------------------
        // НОРМАЛИЗАЦИЯ ПРОВАЙДЕРОВ (v10): оставили только openrouter+custom
        // ---------------------------------------------------------------------
        //
        // Требование проекта:
        // - Все текущие пользователи использовали VSELLM.
        // - Мы удалили отдельный провайдер VSELLM из списка.
        // - Поэтому мигрируем любые “старые” провайдеры на custom,
        //   но сохраняем/подставляем URL VSELLM.
        //
        // ВАЖНО:
        // - Мы НЕ трогаем apiKey.
        // - Мы НЕ затираем URL, если пользователь уже вводил свои.
        const allowedProviders: ApiProvider[] = ['openrouter', 'custom'];

        // Читаем provider из raw (а не из next), потому что:
        // - raw — это “как было сохранено” в localStorage (потенциально грязное значение),
        // - next — это уже “приведённые” настройки (AppSettings), где мог:
        //   - подставиться дефолт из DEFAULT_SETTINGS,
        //   - или значение могло быть перезаписано нашей нормализацией ниже.
        //
        // Нам важно принимать решение о миграции/переназначении провайдера,
        // исходя именно из исходного (возможно устаревшего) значения пользователя.
        const savedProvider: string = typeof raw.apiProvider === 'string' ? raw.apiProvider : '';

        // Флаг: была ли у пользователя “удалённая” конфигурация провайдера
        // (vsellm/openai/groq/together и т.п.). В таком случае мы не просто
        // меняем apiProvider на custom, но и предзаполняем URL VSELLM,
        // как вы и просили.
        const hadRemovedProvider = !allowedProviders.includes(savedProvider as ApiProvider);

        if (hadRemovedProvider) {
          next.apiProvider = 'custom';
          // Требование: “ввести туда данные провайдера VSELLM”
          // Поэтому принудительно выставляем URL VSELLM при миграции
          // со старых провайдеров (даже если раньше там были другие URL).
          next.apiBaseUrl = API_PROVIDERS.custom.baseUrl;
          next.embeddingsBaseUrl = API_PROVIDERS.custom.embeddingsUrl;
        }

        // Приводим baseUrl к ожидаемому виду в зависимости от выбранного провайдера.
        if (next.apiProvider === 'openrouter') {
          // openrouter всегда фиксирован
          next.apiBaseUrl = API_PROVIDERS.openrouter.baseUrl;
          next.embeddingsBaseUrl = API_PROVIDERS.openrouter.embeddingsUrl;

          // Если embeddingsModel пустой — ставим дефолт openrouter
          if (!next.embeddingsModel) {
            next.embeddingsModel = API_PROVIDERS.openrouter.defaultEmbeddingsModel;
          }
        } else {
          // custom: если URL не задан, подставляем VSELLM
          if (!next.apiBaseUrl || String(next.apiBaseUrl).trim().length === 0) {
            next.apiBaseUrl = API_PROVIDERS.custom.baseUrl;
          }
          if (!next.embeddingsBaseUrl || String(next.embeddingsBaseUrl).trim().length === 0) {
            next.embeddingsBaseUrl = API_PROVIDERS.custom.embeddingsUrl;
          }

          // Если embeddingsModel пустой — ставим дефолт custom (OpenAI-style)
          if (!next.embeddingsModel) {
            next.embeddingsModel = API_PROVIDERS.custom.defaultEmbeddingsModel;
          }
        }

        return next;
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
 * Селектор для получения режима хранения ключа.
 */
export const selectApiKeyStorageMode = (state: SettingsStore) => state.apiKeyStorageMode;

/**
 * Селектор для получения setter'а режима хранения ключа.
 */
export const selectSetApiKeyStorageMode = (state: SettingsStore) => state.setApiKeyStorageMode;

/**
 * Селектор для получения метода загрузки ключа из OS vault.
 */
export const selectLoadApiKeyFromSecureStore = (state: SettingsStore) => state.loadApiKeyFromSecureStore;

/**
 * Селектор для получения метода сохранения ключа в OS vault.
 */
export const selectPersistApiKeyToSecureStore = (state: SettingsStore) => state.persistApiKeyToSecureStore;

/**
 * Селектор для получения метода удаления ключа из OS vault.
 */
export const selectDeleteApiKeyFromSecureStore = (state: SettingsStore) => state.deleteApiKeyFromSecureStore;

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
 * Селектор для получения чувствительности NeuroSearch (minSimilarity).
 */
export const selectNeuroSearchMinSimilarity = (state: SettingsStore) => state.neuroSearchMinSimilarity;

/**
 * Селектор для получения setter'а чувствительности NeuroSearch.
 */
export const selectSetNeuroSearchMinSimilarity = (state: SettingsStore) => state.setNeuroSearchMinSimilarity;

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
 * Селектор для получения высоты контентной части карточек по умолчанию
 *
 * @example
 * const defaultCardContentHeight = useSettingsStore(selectDefaultCardContentHeight);
 */
export const selectDefaultCardContentHeight = (state: SettingsStore) => state.defaultCardContentHeight;

/**
 * Селектор для получения функции изменения высоты контентной части карточек
 */
export const selectSetDefaultCardContentHeight = (state: SettingsStore) => state.setDefaultCardContentHeight;

/**
 * Селектор для получения функции сброса настроек
 */
export const selectResetSettings = (state: SettingsStore) => state.resetSettings;

