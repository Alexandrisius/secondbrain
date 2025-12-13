/**
 * Компонент модального окна настроек
 * 
 * Отображает глобальные настройки приложения и позволяет их изменять.
 * Включает настройку API ключа, выбора модели, суммаризации контекста и языка интерфейса.
 * 
 * @module SettingsModal
 */

'use client';

import React, { useState } from 'react';
import { Settings, Info, Zap, BookOpen, RotateCcw, Key, Cpu, Eye, EyeOff, Globe, Server, Link, ShieldAlert, Building2, Search, AlertTriangle, RefreshCw, Loader2, Monitor, LayoutTemplate } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  useSettingsStore, 
  selectApiKey,
  selectSetApiKey,
  selectApiProvider,
  selectSetApiProvider,
  selectApiBaseUrl,
  selectSetApiBaseUrl,
  selectEmbeddingsBaseUrl,
  selectSetEmbeddingsBaseUrl,
  selectModel,
  selectSetModel,
  selectUseSummarization, 
  selectSetUseSummarization,
  selectLanguage,
  selectSetLanguage,
  selectCorporateMode,
  selectSetCorporateMode,
  selectEmbeddingsModel,
  selectSetEmbeddingsModel,
  selectNeuroSearchMinSimilarity,
  selectSetNeuroSearchMinSimilarity,
  selectDefaultCardWidth,
  selectSetDefaultCardWidth,
  selectDefaultCardContentHeight,
  selectSetDefaultCardContentHeight,
  selectResetSettings,
  API_PROVIDERS,
  type Language,
  type ApiProvider,
} from '@/store/useSettingsStore';
import { useTranslation } from '@/lib/i18n';
import { clearAllEmbeddings, getEmbeddingsCount } from '@/lib/db/embeddings';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { reindexCanvasCards } from '@/lib/search/semantic';

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Группа моделей с заголовком
 */
interface ModelGroup {
  /** Название группы (провайдер) */
  label: string;
  /** Список моделей в группе */
  models: { value: string; label: string }[];
}

/**
 * Все доступные модели, сгруппированные по провайдерам
 * 
 * Список актуальных chat-моделей, доступных через vsellm.ru API
 * (исключены embedding и image-generation модели)
 */
const MODEL_GROUPS: ModelGroup[] = [
  {
    label: 'OpenAI',
    models: [
      { value: 'openai/chatgpt-4o-latest', label: 'ChatGPT-4o Latest' },
      { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
      { value: 'openai/gpt-4.1', label: 'GPT-4.1' },
      { value: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'openai/gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { value: 'openai/gpt-5', label: 'GPT-5' },
      { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
      { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano' },
      { value: 'openai/gpt-5-chat', label: 'GPT-5 Chat' },
      { value: 'openai/gpt-5.1', label: 'GPT-5.1' },
      { value: 'openai/gpt-5.1-chat', label: 'GPT-5.1 Chat' },
      { value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B' },
      { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
    ],
  },
  {
    label: 'Anthropic',
    models: [
      { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { value: 'anthropic/claude-opus-4.1', label: 'Claude Opus 4.1' },
      { value: 'anthropic/claude-opus-4.5', label: 'Claude Opus 4.5' },
      { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    label: 'Google',
    models: [
      { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
    ],
  },
  {
    label: 'DeepSeek',
    models: [
      { value: 'deepseek/deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill 70B' },
      { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek Chat V3' },
    ],
  },
  {
    label: 'Meta',
    models: [
      { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
    ],
  },
  {
    label: 'Qwen',
    models: [
      { value: 'qwen/qwen3-235b-a22b', label: 'Qwen3 235B' },
    ],
  },
  {
    label: 'Yandex',
    models: [
      { value: 'yandex/gpt5-pro', label: 'YandexGPT 5 Pro' },
      { value: 'yandex/gpt5.1-pro', label: 'YandexGPT 5.1 Pro' },
      { value: 'yandex/gpt5-lite', label: 'YandexGPT 5 Lite' },
    ],
  },
  {
    label: 'GigaChat',
    models: [
      { value: 'GigaChat/GigaChat-2-Max', label: 'GigaChat 2 Max' },
    ],
  },
  {
    label: 'T-Tech',
    models: [
      { value: 't-tech/T-pro-it-2.0', label: 'T-Pro IT 2.0' },
    ],
  },
  {
    label: 'X.AI',
    models: [
      { value: 'x-ai/grok-code-fast-1', label: 'Grok Code Fast' },
    ],
  },
  {
    label: 'Moonshot',
    models: [
      { value: 'moonshotai/kimi-k2-thinking', label: 'Kimi K2 Thinking' },
      { value: 'moonshotai/kimi-k2-0905', label: 'Kimi K2' },
    ],
  },
  {
    label: 'Z-AI (GLM)',
    models: [
      { value: 'z-ai/glm-4.5-air', label: 'GLM 4.5 Air' },
      { value: 'z-ai/glm-4.6', label: 'GLM 4.6' },
    ],
  },
];

/**
 * Популярные модели для быстрого выбора (первые в списке)
 */
const POPULAR_MODELS = [
  { value: 'openai/chatgpt-4o-latest', label: 'ChatGPT-4o Latest' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
];

/**
 * Доступные языки интерфейса
 */
const AVAILABLE_LANGUAGES: { value: Language; label: string; flag: string }[] = [
  { value: 'ru', label: 'Русский', flag: '🇷🇺' },
  { value: 'en', label: 'English', flag: '🇬🇧' },
];

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Props для компонента SettingsModal
 */
interface SettingsModalProps {
  /** Открыто ли модальное окно */
  isOpen: boolean;
  /** Callback закрытия окна */
  onClose: () => void;
}

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * Модальное окно настроек приложения
 * 
 * Позволяет пользователю:
 * - Ввести API ключ для внешнего LLM провайдера
 * - Выбрать модель для генерации ответов
 * - Включить/выключить суммаризацию контекста
 * - Выбрать язык интерфейса
 * - Сбросить настройки к значениям по умолчанию
 * 
 * Настройки сохраняются в localStorage и восстанавливаются при перезагрузке.
 * 
 * @param props - Свойства компонента
 * @returns JSX элемент модального окна
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();
  
  // ===========================================================================
  // ЛОКАЛЬНОЕ СОСТОЯНИЕ
  // ===========================================================================
  
  // Флаг для показа/скрытия API ключа
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Состояние для предупреждения о смене модели эмбеддингов
  const [pendingEmbeddingsModel, setPendingEmbeddingsModel] = useState<string | null>(null);
  
  // Флаг очистки индекса эмбеддингов
  const [isClearingEmbeddings, setIsClearingEmbeddings] = useState(false);
  
  // Количество проиндексированных карточек
  const [embeddingsCount, setEmbeddingsCount] = useState(0);
  
  // Состояние переиндексации после смены модели
  const [isReindexing, setIsReindexing] = useState(false);
  
  // Прогресс переиндексации: { current: число, total: число }
  const [reindexProgress, setReindexProgress] = useState({ current: 0, total: 0 });
  
  // ===========================================================================
  // STORE
  // ===========================================================================
  
  // Получаем текущие настройки и методы их изменения
  const apiKey = useSettingsStore(selectApiKey);
  const setApiKey = useSettingsStore(selectSetApiKey);
  const apiProvider = useSettingsStore(selectApiProvider);
  const setApiProvider = useSettingsStore(selectSetApiProvider);
  const apiBaseUrl = useSettingsStore(selectApiBaseUrl);
  const setApiBaseUrl = useSettingsStore(selectSetApiBaseUrl);
  const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
  const setEmbeddingsBaseUrl = useSettingsStore(selectSetEmbeddingsBaseUrl);
  const model = useSettingsStore(selectModel);
  const setModel = useSettingsStore(selectSetModel);
  const useSummarization = useSettingsStore(selectUseSummarization);
  const setUseSummarization = useSettingsStore(selectSetUseSummarization);
  const language = useSettingsStore(selectLanguage);
  const setLanguage = useSettingsStore(selectSetLanguage);
  const corporateMode = useSettingsStore(selectCorporateMode);
  const setCorporateMode = useSettingsStore(selectSetCorporateMode);
  const embeddingsModel = useSettingsStore(selectEmbeddingsModel);
  const setEmbeddingsModel = useSettingsStore(selectSetEmbeddingsModel);
  const neuroSearchMinSimilarity = useSettingsStore(selectNeuroSearchMinSimilarity);
  const setNeuroSearchMinSimilarity = useSettingsStore(selectSetNeuroSearchMinSimilarity);
  const defaultCardWidth = useSettingsStore(selectDefaultCardWidth);
  const setDefaultCardWidth = useSettingsStore(selectSetDefaultCardWidth);
  // Высота “контентной” части карточек (ответ AI-карточки / область заметки NoteNode)
  // Это единая настройка, чтобы интерфейс выглядел консистентно.
  const defaultCardContentHeight = useSettingsStore(selectDefaultCardContentHeight);
  const setDefaultCardContentHeight = useSettingsStore(selectSetDefaultCardContentHeight);
  const resetSettings = useSettingsStore(selectResetSettings);
  
  // Получаем данные для переиндексации из других stores
  const nodes = useCanvasStore((s) => s.nodes);
  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  // Загрузка количества проиндексированных карточек при открытии
  React.useEffect(() => {
    if (isOpen) {
      getEmbeddingsCount().then(setEmbeddingsCount).catch(() => setEmbeddingsCount(0));
    }
  }, [isOpen]);
  
  // ===========================================================================
  // ОБРАБОТЧИКИ
  // ===========================================================================
  
  /**
   * Обработка изменения API ключа
   */
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
  };
  
  /**
   * Обработка изменения API провайдера
   */
  const handleProviderChange = (provider: ApiProvider) => {
    setApiProvider(provider);
  };
  
  /**
   * Обработка изменения базового URL
   */
  const handleApiBaseUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiBaseUrl(e.target.value);
  };
  
  /**
   * Обработка изменения URL эмбеддингов
   */
  const handleEmbeddingsBaseUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmbeddingsBaseUrl(e.target.value);
  };
  
  /**
   * Обработка изменения модели
   */
  const handleModelChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setModel(e.target.value);
  };
  
  /**
   * Переключение видимости API ключа
   */
  const toggleShowApiKey = () => {
    setShowApiKey(!showApiKey);
  };
  
  /**
   * Переключение суммаризации
   */
  const handleToggleSummarization = () => {
    setUseSummarization(!useSummarization);
  };
  
  /**
   * Изменение языка интерфейса
   */
  const handleLanguageChange = (newLanguage: Language) => {
    setLanguage(newLanguage);
  };
  
  /**
   * Переключение корпоративного режима
   */
  const handleToggleCorporateMode = () => {
    setCorporateMode(!corporateMode);
  };
  
  /**
   * Обработка изменения модели эмбеддингов
   * Показывает предупреждение если есть проиндексированные карточки
   */
  const handleEmbeddingsModelChange = (newModel: string) => {
    if (newModel === embeddingsModel) return;
    
    // Если есть проиндексированные карточки - показываем предупреждение
    if (embeddingsCount > 0) {
      setPendingEmbeddingsModel(newModel);
    } else {
      // Если нет индексированных карточек - просто меняем модель
      setEmbeddingsModel(newModel);
    }
  };
  
  /**
   * Подтверждение смены модели эмбеддингов
   * Очищает индекс, применяет новую модель и запускает переиндексацию
   */
  const handleConfirmEmbeddingsModelChange = async () => {
    if (!pendingEmbeddingsModel) return;
    
    setIsClearingEmbeddings(true);
    
    try {
      // Очищаем все эмбеддинги
      await clearAllEmbeddings();
      
      // Сохраняем новую модель для использования в переиндексации
      const newModel = pendingEmbeddingsModel;
      
      // Применяем новую модель
      setEmbeddingsModel(newModel);
      
      // Обновляем счётчик (пока 0, будет обновлён после переиндексации)
      setEmbeddingsCount(0);
      
      // Закрываем диалог подтверждения
      setPendingEmbeddingsModel(null);
      
      // Завершаем процесс очистки
      setIsClearingEmbeddings(false);
      
      // =========================================================================
      // АВТОМАТИЧЕСКАЯ ПЕРЕИНДЕКСАЦИЯ
      // Если есть API ключ и активный холст - запускаем переиндексацию
      // =========================================================================
      if (apiKey && activeCanvasId && nodes.length > 0) {
        // Фильтруем только карточки с ответами (их имеет смысл индексировать)
        const cardsWithResponse = nodes.filter((n) => n.data.response);
        
        if (cardsWithResponse.length > 0) {
          console.log(`[SettingsModal] Запуск переиндексации ${cardsWithResponse.length} карточек с моделью ${newModel}`);
          
          setIsReindexing(true);
          setReindexProgress({ current: 0, total: cardsWithResponse.length });
          
          try {
            // Запускаем переиндексацию с новой моделью
            const indexedCount = await reindexCanvasCards(
              activeCanvasId,
              nodes,
              apiKey,
              embeddingsBaseUrl,
              (current, total) => {
                // Обновляем прогресс переиндексации
                setReindexProgress({ current, total });
              },
              corporateMode,
              newModel // Используем новую модель!
            );
            
            // Обновляем счётчик проиндексированных карточек
            setEmbeddingsCount(indexedCount);
            
            console.log(`[SettingsModal] Переиндексация завершена: ${indexedCount} карточек`);
          } catch (reindexError) {
            console.error('[SettingsModal] Ошибка переиндексации:', reindexError);
          } finally {
            setIsReindexing(false);
            setReindexProgress({ current: 0, total: 0 });
          }
        }
      }
      
    } catch (error) {
      console.error('[SettingsModal] Ошибка очистки эмбеддингов:', error);
      setIsClearingEmbeddings(false);
    }
  };
  
  /**
   * Отмена смены модели эмбеддингов
   */
  const handleCancelEmbeddingsModelChange = () => {
    setPendingEmbeddingsModel(null);
  };
  
  /**
   * Сброс настроек к значениям по умолчанию
   */
  const handleResetSettings = () => {
    resetSettings();
    setShowApiKey(false);
  };
  
  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================
  
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {/* Шапка диалога */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            {t.settings.title}
          </DialogTitle>
          <DialogDescription>
            {t.settings.description}
          </DialogDescription>
        </DialogHeader>
        
        {/* Секции настроек */}
        <div className="space-y-6 py-4 max-h-[60vh] overflow-y-auto">
          
          {/* =============================================================== */}
          {/* СЕКЦИЯ: ЯЗЫК ИНТЕРФЕЙСА */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Globe className="w-4 h-4" />
            {t.settings.languageSection}
          </div>
          
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Globe className="w-4 h-4 text-green-500" />
                {t.settings.language}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.languageDescription}
              </p>
              
              {/* Кнопки выбора языка */}
              <div className="flex gap-2">
                {AVAILABLE_LANGUAGES.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => handleLanguageChange(lang.value)}
                    className={`
                      flex-1 flex items-center justify-center gap-2
                      px-4 py-2.5 rounded-lg border transition-all duration-200
                      ${language === lang.value 
                        ? 'bg-primary text-primary-foreground border-primary shadow-md' 
                        : 'bg-background hover:bg-accent hover:text-accent-foreground border-border hover:border-primary/50'
                      }
                    `}
                  >
                    <span className="text-lg">{lang.flag}</span>
                    <span className="font-medium">{lang.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          {/* =============================================================== */}
          {/* СЕКЦИЯ: ИНТЕРФЕЙС */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Monitor className="w-4 h-4" />
            {t.settings.interfaceSection}
          </div>
          
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <LayoutTemplate className="w-4 h-4 text-blue-500" />
                {t.settings.defaultCardWidth}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.defaultCardWidthDescription}
              </p>
              
              <div className="flex items-center gap-4">
                 <Input 
                   type="number" 
                   min={300} 
                   max={1200}
                   step={10}
                   value={defaultCardWidth} 
                   onChange={(e) => setDefaultCardWidth(Number(e.target.value))}
                   className="w-32"
                 />
                 <span className="text-sm text-muted-foreground">px</span>
                 
                 {/* Слайдер для удобства */}
                 <input
                   type="range"
                   min={300}
                   max={1200}
                   step={10}
                   value={defaultCardWidth}
                   onChange={(e) => setDefaultCardWidth(Number(e.target.value))}
                   className="flex-1 accent-primary h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                 />
              </div>
            </div>
          </div>

          {/* Настройка высоты “контентной” части карточек (ответ / заметка) */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                {/* Используем ту же иконку “layout”, чтобы визуально сгруппировать UI-настройки */}
                <LayoutTemplate className="w-4 h-4 text-emerald-500" />
                {t.settings.defaultCardContentHeight}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.defaultCardContentHeightDescription}
              </p>

              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  min={150}
                  max={1200}
                  step={10}
                  value={defaultCardContentHeight}
                  onChange={(e) => setDefaultCardContentHeight(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">px</span>

                {/* Слайдер для удобства (быстро “пощупать” высоту без ввода числа) */}
                <input
                  type="range"
                  min={150}
                  max={1200}
                  step={10}
                  value={defaultCardContentHeight}
                  onChange={(e) => setDefaultCardContentHeight(Number(e.target.value))}
                  className="flex-1 accent-primary h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
          </div>
          
          {/* =============================================================== */}
          {/* СЕКЦИЯ: API НАСТРОЙКИ */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Key className="w-4 h-4" />
            {t.settings.apiSection}
          </div>
          
          {/* Выбор API провайдера */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-500" />
                {t.settings.apiProvider}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.apiProviderDescription}
              </p>
              
              {/* Сетка кнопок выбора провайдера */}
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(API_PROVIDERS) as [ApiProvider, typeof API_PROVIDERS[ApiProvider]][]).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => handleProviderChange(key)}
                    className={`
                      flex flex-col items-start p-3 rounded-lg border transition-all duration-200 text-left
                      ${apiProvider === key 
                        ? 'bg-primary/10 border-primary shadow-sm' 
                        : 'bg-background hover:bg-accent hover:border-primary/50 border-border'
                      }
                    `}
                  >
                    <span className={`font-medium text-sm ${apiProvider === key ? 'text-primary' : ''}`}>
                      {config.name}
                    </span>
                    {/* Локализованное описание провайдера без обрезки */}
                    <span className="text-xs text-muted-foreground">
                      {t.settings.providers[key as keyof typeof t.settings.providers]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          {/* Поле ввода API ключа */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Key className="w-4 h-4 text-blue-500" />
                {t.settings.apiKey}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.apiKeyDescription}
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    placeholder={t.settings.apiKeyPlaceholder}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={toggleShowApiKey}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    title={showApiKey ? t.settings.hideKey : t.settings.showKey}
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              
              {/* Предупреждение если ключ не введён */}
              {!apiKey && (
                <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>
                    {t.settings.apiKeyRequired}
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {/* Custom URL поля - показываем только для custom провайдера */}
          {apiProvider === 'custom' && (
            <div className="rounded-lg border p-4 space-y-4 border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Link className="w-4 h-4 text-amber-600" />
                  {t.settings.customApiUrl}
                </label>
                <p className="text-sm text-muted-foreground">
                  {t.settings.customApiUrlDescription}
                </p>
                <Input
                  type="text"
                  value={apiBaseUrl}
                  onChange={handleApiBaseUrlChange}
                  placeholder="http://localhost:1234/v1"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Link className="w-4 h-4 text-amber-600" />
                  {t.settings.customEmbeddingsUrl}
                </label>
                <p className="text-sm text-muted-foreground">
                  {t.settings.customEmbeddingsUrlDescription}
                </p>
                <Input
                  type="text"
                  value={embeddingsBaseUrl}
                  onChange={handleEmbeddingsBaseUrlChange}
                  placeholder="http://localhost:1234/v1"
                />
              </div>
            </div>
          )}
          
          {/* Информация о текущих URL (для не-custom провайдеров) */}
          {apiProvider !== 'custom' && (
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Link className="w-3 h-3" />
                <span className="font-medium">{t.settings.currentApiUrl}:</span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{apiBaseUrl}</code>
              </div>
              {API_PROVIDERS[apiProvider].supportsEmbeddings && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <Link className="w-3 h-3" />
                  <span className="font-medium">{t.settings.currentEmbeddingsUrl}:</span>
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{embeddingsBaseUrl}</code>
                </div>
              )}
              {!API_PROVIDERS[apiProvider].supportsEmbeddings && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mt-1">
                  <Info className="w-3 h-3" />
                  <span>{t.settings.noEmbeddingsSupport}</span>
                </div>
              )}
            </div>
          )}
          
          {/* Выбор модели */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Cpu className="w-4 h-4 text-purple-500" />
                {t.settings.model}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.modelDescription}
              </p>
              
              {/* Кнопки быстрого выбора популярных моделей */}
              <div className="flex flex-wrap gap-2 pb-2">
                {POPULAR_MODELS.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setModel(m.value)}
                    className={`
                      px-2 py-1 text-xs rounded-md border transition-colors
                      ${model === m.value 
                        ? 'bg-primary text-primary-foreground border-primary' 
                        : 'bg-background hover:bg-accent hover:text-accent-foreground border-border'
                      }
                    `}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              
              {/* Выпадающий список всех моделей с группировкой */}
              <select
                value={model}
                onChange={handleModelChange}
                className="w-full h-10 px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {/* Пустая опция для ручного ввода */}
                <option value="" disabled>
                  {t.settings.selectModel}
                </option>
                
                {/* Группы моделей */}
                {MODEL_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              
              {/* Поле для ручного ввода модели */}
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">
                  {t.settings.customModel}
                </p>
                <Input
                  type="text"
                  value={model}
                  onChange={handleModelChange}
                  placeholder={t.settings.modelPlaceholder}
                />
              </div>
            </div>
          </div>
          
          {/* =============================================================== */}
          {/* СЕКЦИЯ: СЕМАНТИЧЕСКИЙ ПОИСК (ЭМБЕДДИНГИ) */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Search className="w-4 h-4" />
            {t.settings.embeddingsSection}
          </div>
          
          {/* Выбор модели эмбеддингов */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Search className="w-4 h-4 text-cyan-500" />
                {t.settings.embeddingsModel}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.embeddingsModelDescription}
              </p>
              
              {/* Провайдер не поддерживает эмбеддинги */}
              {!API_PROVIDERS[apiProvider].supportsEmbeddings ? (
                <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{t.settings.noEmbeddingsSupport}</span>
                </div>
              ) : (
                <>
                  {/* Выпадающий список моделей эмбеддингов */}
                  {/* Показываем pendingEmbeddingsModel если есть (выбранная, но не подтверждённая модель) */}
                  <select
                    value={pendingEmbeddingsModel || embeddingsModel}
                    onChange={(e) => handleEmbeddingsModelChange(e.target.value)}
                    className="w-full h-10 px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    disabled={isReindexing || isClearingEmbeddings}
                  >
                    {API_PROVIDERS[apiProvider].embeddingsModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} ({model.dimension}d) - {model.description}
                      </option>
                    ))}
                  </select>
                  
                  {/* Информация о текущей модели */}
                  {(() => {
                    // Показываем информацию о выбранной модели (pending или текущей)
                    const displayModelId = pendingEmbeddingsModel || embeddingsModel;
                    const currentModel = API_PROVIDERS[apiProvider].embeddingsModels.find(
                      (m) => m.id === displayModelId
                    );
                    return currentModel ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded bg-muted/50">
                        <Info className="w-3 h-3" />
                        <span>
                          {t.settings.embeddingsDimension}: {currentModel.dimension} | 
                          {t.settings.indexedCards}: {embeddingsCount}
                        </span>
                      </div>
                    ) : null;
                  })()}
                </>
              )}
            </div>
            
            {/* Диалог подтверждения смены модели */}
            {pendingEmbeddingsModel && (
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 space-y-3">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">{t.settings.embeddingsModelChangeWarning}</p>
                    <p className="text-sm opacity-90">
                      {t.settings.embeddingsModelChangeDescription.replace('{count}', String(embeddingsCount))}
                    </p>
                  </div>
                </div>
                
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEmbeddingsModelChange}
                    disabled={isClearingEmbeddings}
                  >
                    {t.common.cancel}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleConfirmEmbeddingsModelChange}
                    disabled={isClearingEmbeddings}
                  >
                    {isClearingEmbeddings ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t.settings.clearingIndex}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {t.settings.clearAndChange}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            
            {/* Индикатор переиндексации */}
            {isReindexing && (
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 space-y-3">
                <div className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <div className="flex-1">
                    <p className="font-medium">{t.settings.reindexingCards}</p>
                    <p className="text-sm opacity-90">
                      {t.settings.reindexingProgress
                        .replace('{current}', String(reindexProgress.current))
                        .replace('{total}', String(reindexProgress.total))}
                    </p>
                  </div>
                </div>
                
                {/* Прогресс-бар */}
                <div className="w-full h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-200"
                    style={{
                      width: reindexProgress.total > 0
                        ? `${(reindexProgress.current / reindexProgress.total) * 100}%`
                        : '0%'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* =============================================================== */}
          {/* СЕКЦИЯ: NEUROSEARCH (ЧУВСТВИТЕЛЬНОСТЬ) */}
          {/* =============================================================== */}
          
          <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Search className="w-4 h-4 text-purple-500" />
                {t.settings.neuroSearchSensitivity}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.settings.neuroSearchSensitivityDescription}
              </p>

              {/*
                Настройка minSimilarity (0..1)

                UX:
                - Даём одновременно input + slider.
                - Пользователь быстро “крутит” слайдером, а точное значение добивает в input.

                Технически:
                - Значение хранится в useSettingsStore и clamp'ится в [0, 1].
                - Это значение мы используем в NeuroSearch как `minSimilarity`.
              */}
              <div className="flex items-center gap-4">
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={Number(neuroSearchMinSimilarity.toFixed(2))}
                  onChange={(e) => setNeuroSearchMinSimilarity(Number(e.target.value))}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">min</span>

                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={neuroSearchMinSimilarity}
                  onChange={(e) => setNeuroSearchMinSimilarity(Number(e.target.value))}
                  className="flex-1 accent-primary h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t.settings.neuroSearchSensitivityLow}</span>
                <span>{t.settings.neuroSearchSensitivityHigh}</span>
              </div>
            </div>
          </div>
          
          {/* =============================================================== */}
          {/* СЕКЦИЯ: НАСТРОЙКИ КОНТЕКСТА */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <BookOpen className="w-4 h-4" />
            {t.settings.contextSection}
          </div>
          
          {/* Настройка суммаризации */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="font-medium">{t.settings.summarization}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.settings.summarizationDescription}
                </p>
              </div>
              
              {/* Кастомный toggle switch */}
              <button
                onClick={handleToggleSummarization}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full
                  transition-colors duration-200 ease-in-out
                  focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
                  ${useSummarization 
                    ? 'bg-primary' 
                    : 'bg-gray-300 dark:bg-gray-600'
                  }
                `}
                role="switch"
                aria-checked={useSummarization}
                aria-label={t.settings.toggleSummarization}
              >
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white shadow-lg
                    transition-transform duration-200 ease-in-out
                    ${useSummarization ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>
            
            {/* Информационный блок о текущем режиме */}
            <div 
              className={`
                flex items-start gap-2 p-3 rounded-md text-sm
                ${useSummarization 
                  ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200' 
                  : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                }
              `}
            >
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                {useSummarization ? (
                  <>
                    <span className="font-medium">{t.settings.summarizationEnabled}</span>
                    <br />
                    {t.settings.summarizationEnabledDescription}
                  </>
                ) : (
                  <>
                    <span className="font-medium">{t.settings.summarizationDisabled}</span>
                    <br />
                    {t.settings.summarizationDisabledDescription}
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* =============================================================== */}
          {/* СЕКЦИЯ: КОРПОРАТИВНАЯ СЕТЬ */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Building2 className="w-4 h-4" />
            {t.settings.corporateSection}
          </div>
          
          {/* Настройка корпоративного режима */}
          <div className="rounded-lg border p-4 space-y-3 border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  <span className="font-medium">{t.settings.corporateMode}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.settings.corporateModeDescription}
                </p>
              </div>
              
              {/* Кастомный toggle switch */}
              <button
                onClick={handleToggleCorporateMode}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full
                  transition-colors duration-200 ease-in-out
                  focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
                  ${corporateMode 
                    ? 'bg-amber-500' 
                    : 'bg-gray-300 dark:bg-gray-600'
                  }
                `}
                role="switch"
                aria-checked={corporateMode}
                aria-label={t.settings.toggleCorporateMode}
              >
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white shadow-lg
                    transition-transform duration-200 ease-in-out
                    ${corporateMode ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>
            
            {/* Информационный блок о текущем режиме */}
            <div 
              className={`
                flex items-start gap-2 p-3 rounded-md text-sm
                ${corporateMode 
                  ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200' 
                  : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                }
              `}
            >
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                {corporateMode ? (
                  <>
                    <span className="font-medium">{t.settings.corporateModeEnabled}</span>
                    <br />
                    {t.settings.corporateModeEnabledDescription}
                  </>
                ) : (
                  <>
                    <span className="font-medium">{t.settings.corporateModeDisabled}</span>
                    <br />
                    {t.settings.corporateModeDisabledDescription}
                  </>
                )}
              </div>
            </div>
            
            {/* Предупреждение о безопасности (показывается когда режим включён) */}
            {corporateMode && (
              <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800/50">
                <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{t.settings.corporateModeWarning}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Кнопка сброса настроек */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetSettings}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            {t.settings.resetSettings}
          </Button>
          
          <Button onClick={onClose}>
            {t.common.done}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// =============================================================================
// КОМПОНЕНТ КНОПКИ НАСТРОЕК
// =============================================================================

/**
 * Props для кнопки открытия настроек
 */
interface SettingsButtonProps {
  /** Callback открытия модального окна */
  onClick: () => void;
}

/**
 * Кнопка для открытия модального окна настроек
 * 
 * Размещается в правом верхнем углу холста.
 * Имеет иконку шестерёнки и подсказку при наведении.
 * 
 * @param props - Свойства компонента
 * @returns JSX элемент кнопки
 */
export const SettingsButton: React.FC<SettingsButtonProps> = ({ onClick }) => {
  const { t } = useTranslation();
  
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="flex items-center gap-2 shadow-sm"
      title={t.canvas.openSettings}
    >
      <Settings className="w-4 h-4" />
      <span className="hidden sm:inline">{t.canvas.settings}</span>
    </Button>
  );
};

export default SettingsModal;
