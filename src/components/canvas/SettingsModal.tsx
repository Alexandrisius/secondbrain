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
import { Settings, Info, Zap, BookOpen, RotateCcw, Key, Cpu, Eye, EyeOff, Globe } from 'lucide-react';
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
  selectModel,
  selectSetModel,
  selectUseSummarization, 
  selectSetUseSummarization,
  selectLanguage,
  selectSetLanguage,
  selectResetSettings,
  type Language,
} from '@/store/useSettingsStore';
import { useTranslation } from '@/lib/i18n';

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
  
  // ===========================================================================
  // STORE
  // ===========================================================================
  
  // Получаем текущие настройки и методы их изменения
  const apiKey = useSettingsStore(selectApiKey);
  const setApiKey = useSettingsStore(selectSetApiKey);
  const model = useSettingsStore(selectModel);
  const setModel = useSettingsStore(selectSetModel);
  const useSummarization = useSettingsStore(selectUseSummarization);
  const setUseSummarization = useSettingsStore(selectSetUseSummarization);
  const language = useSettingsStore(selectLanguage);
  const setLanguage = useSettingsStore(selectSetLanguage);
  const resetSettings = useSettingsStore(selectResetSettings);
  
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
          {/* СЕКЦИЯ: API НАСТРОЙКИ */}
          {/* =============================================================== */}
          
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
            <Key className="w-4 h-4" />
            {t.settings.apiSection}
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
