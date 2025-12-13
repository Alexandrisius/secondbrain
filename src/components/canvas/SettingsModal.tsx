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
import { clearAllEmbeddings, getEmbeddingsCount, getEmbeddingsIndexMeta } from '@/lib/db/embeddings';
import type { EmbeddingsIndexMeta } from '@/lib/db/embeddings';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';
import { reindexCanvasCards } from '@/lib/search/semantic';
import { CHAT_MODELS, POPULAR_CHAT_MODEL_IDS, groupByDeveloper } from '@/lib/aiCatalog';

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
 * ВАЖНО:
 * - Раньше список был захардкожен прямо здесь, и его было неудобно поддерживать.
 * - Теперь список моделей лежит в src/lib/aiCatalog.ts (единообразно для всего приложения).
 * - В UI мы только “проецируем” этот список в нужный формат (группы + подписи).
 *
 * ВАЖНО ПРО maxContextTokens:
 * - В каталоге моделей (aiCatalog.ts) мы храним maxContextTokens как “полноценные данные”
 *   для будущих задач (валидации/подсказок/автоматической логики).
 * - По вашему требованию в UI эти цифры НЕ отображаем вообще,
 *   чтобы список моделей оставался компактным.
 */
const MODEL_GROUPS: ModelGroup[] = (() => {
  // 1) Группируем модели по developer (OpenAI/Google/Anthropic/…)
  const grouped = groupByDeveloper(CHAT_MODELS);

  // 2) Превращаем в массив групп для <optgroup>
  // ВАЖНО:
  // - порядок ключей задаётся в groupByDeveloper(), чтобы UI был предсказуемым
  // - пустые группы выкидываем
  return Object.entries(grouped)
    .filter(([, models]) => models.length > 0)
    .map(([developer, models]) => ({
      label: developer,
      models: models.map((m) => ({
        value: m.id,
        // ВАЖНО: maxContextTokens не показываем в UI (см. комментарий выше).
        label: m.displayName,
      })),
    }));
})();

/**
 * Популярные модели для быстрого выбора (первые в списке)
 */
const POPULAR_MODELS = POPULAR_CHAT_MODEL_IDS
  .map((id) => CHAT_MODELS.find((m) => m.id === id))
  .filter((m): m is NonNullable<typeof m> => Boolean(m))
  .map((m) => ({ value: m.id, label: m.displayName }));

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
  
  /**
   * Метаданные текущего embedding-индекса (если они есть).
   *
   * ВАЖНО:
   * - Это НЕ “настройка”, а “паспорт” того, ЧЕМ был построен индекс в IndexedDB.
   * - Нужен, чтобы определить: индекс совместим с текущими настройками или устарел.
   */
  const [embeddingsIndexMeta, setEmbeddingsIndexMetaState] = useState<EmbeddingsIndexMeta | null>(null);
  
  // Флаг очистки индекса эмбеддингов
  const [isClearingEmbeddings, setIsClearingEmbeddings] = useState(false);
  
  // Количество проиндексированных карточек
  const [embeddingsCount, setEmbeddingsCount] = useState(0);
  
  // Состояние переиндексации после смены модели
  const [isReindexing, setIsReindexing] = useState(false);
  
  // Прогресс переиндексации: { current: число, total: число }
  const [reindexProgress, setReindexProgress] = useState({ current: 0, total: 0 });

  /**
   * Прогресс глобальной переиндексации (по всем холстам).
   *
   * Почему отдельное состояние:
   * - “reindexProgress” исторически показывал прогресс только для одного холста.
   * - По вашему требованию мы добавляем глобальную переиндексацию,
   *   где нужен 2-уровневый прогресс: (холст i/N) + (карточка j/M).
   */
  const [reindexAllProgress, setReindexAllProgress] = useState<{
    canvasCurrent: number;
    canvasTotal: number;
    canvasName: string;
    cardCurrent: number;
    cardTotal: number;
  }>({
    canvasCurrent: 0,
    canvasTotal: 0,
    canvasName: '',
    cardCurrent: 0,
    cardTotal: 0,
  });
  
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
  
  // Список всех холстов нужен для глобальной переиндексации (все холсты).
  const canvases = useWorkspaceStore((s) => s.canvases);
  
  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================
  
  // Загрузка статуса embedding-индекса при открытии:
  // - сколько записей (embeddingsCount)
  // - “паспорт” индекса (embeddingsIndexMeta: какой моделью/URL был построен индекс)
  React.useEffect(() => {
    if (isOpen) {
      Promise.all([getEmbeddingsCount(), getEmbeddingsIndexMeta()])
        .then(([count, meta]) => {
          setEmbeddingsCount(count);
          setEmbeddingsIndexMetaState(meta ?? null);
        })
        .catch(() => {
          // Если по какой-то причине чтение IndexedDB не удалось:
          // - не ломаем UI,
          // - показываем “0” и отсутствие меты.
          setEmbeddingsCount(0);
          setEmbeddingsIndexMetaState(null);
        });
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
   *
   * ВАЖНО (по UX-требованию):
   * - Мы НЕ блокируем смену модели через подтверждение.
   * - Пользователь может поменять настройки сразу.
   * - А “предупреждение о переиндексации” показываем отдельно (см. блок статуса индекса),
   *   сравнивая текущие настройки с метаданными индекса (EmbeddingsIndexMeta).
   */
  const handleEmbeddingsModelChange = (newModel: string) => {
    if (newModel === embeddingsModel) return;

    // Применяем новую модель сразу.
    // Если текущий индекс был построен другой моделью/URL, UI подсветит предупреждение
    // и предложит переиндексацию всей базы.
    setEmbeddingsModel(newModel);
  };

  /**
   * Глобальная переиндексация эмбеддингов: пересобрать индекс ДЛЯ ВСЕХ ХОЛСТОВ.
   *
   * Почему это нужно:
   * - IndexedDB база эмбеддингов у нас общая на всё приложение.
   * - Если меняется embeddingsModel / embeddingsBaseUrl (или provider), старый индекс
   *   становится несовместимым → семантический поиск может начать “врать”.
   *
   * UX-требование:
   * - Настройки можно менять сразу (мы не блокируем),
   * - но даём явную кнопку “Переиндексировать все холсты”, которая:
   *   1) очищает индекс,
   *   2) проходит по всем холстам,
   *   3) пересчитывает эмбеддинги для карточек с ответом.
   *
   * ВАЖНО:
   * - Эта операция может быть долгой (много холстов/карточек).
   * - Поэтому мы показываем 2-уровневый прогресс: холст i/N и карточка j/M.
   */
  const handleReindexAllCanvases = async () => {
    // Базовая защита от “двойных кликов”
    if (isReindexing || isClearingEmbeddings) return;

    // Без API ключа мы не можем вызывать /api/embeddings
    if (!apiKey) return;

    // Если провайдер (в теории) не поддерживает эмбеддинги — выходим.
    // Сейчас в проекте оба провайдера поддерживают embeddings, но оставляем проверку на будущее.
    if (!API_PROVIDERS[apiProvider].supportsEmbeddings) return;

    setIsReindexing(true);
    setReindexProgress({ current: 0, total: 0 });
    setReindexAllProgress({
      canvasCurrent: 0,
      canvasTotal: 0,
      canvasName: '',
      cardCurrent: 0,
      cardTotal: 0,
    });

    try {
      // ---------------------------------------------------------------------
      // ШАГ 1: очищаем индекс (и метаданные), чтобы не смешивать разные модели
      // ---------------------------------------------------------------------
      setIsClearingEmbeddings(true);
      await clearAllEmbeddings();
      setEmbeddingsCount(0);
      setEmbeddingsIndexMetaState(null);
      setIsClearingEmbeddings(false);

      // ---------------------------------------------------------------------
      // ШАГ 2: переиндексируем каждый холст через его сохранённые данные (/api/canvas/:id)
      // ---------------------------------------------------------------------
      const canvasList = Array.isArray(canvases) ? canvases : [];
      const canvasTotal = canvasList.length;

      setReindexAllProgress((prev) => ({
        ...prev,
        canvasCurrent: canvasTotal > 0 ? 1 : 0,
        canvasTotal,
      }));

      for (let i = 0; i < canvasList.length; i++) {
        const canvas = canvasList[i];
        const canvasId = canvas.id;

        // Обновляем “верхний” прогресс
        setReindexAllProgress((prev) => ({
          ...prev,
          canvasCurrent: i + 1,
          canvasTotal,
          canvasName: canvas.name || canvasId,
          cardCurrent: 0,
          cardTotal: 0,
        }));

        try {
          const response = await fetch(`/api/canvas/${canvasId}`);
          if (!response.ok) {
            console.warn('[SettingsModal] Не удалось загрузить холст для переиндексации:', canvasId, response.status);
            continue;
          }

          const canvasData = await response.json();
          const canvasNodes = Array.isArray(canvasData?.nodes) ? canvasData.nodes : [];

          // Подготовка “нижнего” прогресса (сколько карточек вообще имеет смысл индексировать)
          // ВАЖНО ПО ТИПАМ (почему здесь нельзя просто написать `node.data.response`):
          // - `canvasData` приходит из `response.json()`, то есть это внешний (непроверенный) JSON.
          // - TypeScript не может гарантировать форму данных, а ESLint запрещает использовать `any`.
          // - Нам НЕ нужна полная типизация ReactFlow-нод на этом шаге — только факт наличия `data.response`,
          //   чтобы корректно посчитать `cardTotal` для прогресс-бара.
          // - Поэтому мы работаем с `unknown` и делаем минимальное безопасное “сужение” типов:
          //   1) проверяем что нода — объект (и не `null`)
          //   2) проверяем что `data` — объект
          //   3) считаем, что “ответ есть”, если `data.response` truthy
          //
          // ПРИМЕЧАНИЕ:
          // - Дальше мы всё равно передаём `canvasNodes` в `reindexCanvasCards()`, где есть своя типизация/фильтрация.
          // - Здесь мы не меняем логику индексации — только убираем `any` и делаем проверку явной/безопасной.
          const cardsWithResponse = canvasNodes.filter((node: unknown) => {
            // 1) node должен быть объектом (иначе у него нет свойств)
            if (!node || typeof node !== 'object') return false;

            // 2) “Достаём” data в безопасном виде (без `any`)
            const data = (node as { data?: unknown }).data;
            if (!data || typeof data !== 'object') return false;

            // 3) Любое truthy-значение response считаем “ответом”
            return Boolean((data as { response?: unknown }).response);
          });
          setReindexAllProgress((prev) => ({
            ...prev,
            cardCurrent: 0,
            cardTotal: cardsWithResponse.length,
          }));

          // Запускаем переиндексацию одного холста.
          // reindexCanvasCards() внутри сам фильтрует карточки с ответом и делает небольшие задержки,
          // чтобы не перегружать API провайдера.
          await reindexCanvasCards(
            canvasId,
            canvasNodes,
            apiKey,
            embeddingsBaseUrl,
            (current, total) => {
              setReindexAllProgress((prev) => ({
                ...prev,
                cardCurrent: current,
                cardTotal: total,
              }));
            },
            corporateMode,
            embeddingsModel
          );
        } catch (canvasError) {
          console.error('[SettingsModal] Ошибка переиндексации холста:', canvasId, canvasError);
          // Не прерываем весь процесс — продолжаем со следующим холстом.
          continue;
        }
      }

      // ---------------------------------------------------------------------
      // ШАГ 3: обновляем отображаемые счётчики/мету после завершения
      // ---------------------------------------------------------------------
      const [count, meta] = await Promise.all([getEmbeddingsCount(), getEmbeddingsIndexMeta()]);
      setEmbeddingsCount(count);
      setEmbeddingsIndexMetaState(meta ?? null);
    } catch (error) {
      console.error('[SettingsModal] Ошибка глобальной переиндексации эмбеддингов:', error);
    } finally {
      setIsReindexing(false);
      setIsClearingEmbeddings(false);
      setReindexProgress({ current: 0, total: 0 });
      setReindexAllProgress({
        canvasCurrent: 0,
        canvasTotal: 0,
        canvasName: '',
        cardCurrent: 0,
        cardTotal: 0,
      });
    }
  };
  
  /**
   * Сброс настроек к значениям по умолчанию
   */
  const handleResetSettings = () => {
    resetSettings();
    setShowApiKey(false);
  };
  
  // ===========================================================================
  // ВЫЧИСЛЯЕМ СТАТУС EMBEDDINGS-ИНДЕКСА (СОВМЕСТИМ / УСТАРЕЛ / НЕИЗВЕСТЕН)
  // ===========================================================================
  //
  // Мы используем 2 источника правды:
  // 1) embeddingsCount — есть ли вообще какие-то данные в IndexedDB
  // 2) embeddingsIndexMeta — “паспорт” индекса (какой model/baseUrl использовали при построении)
  //
  // Результаты:
  // - hasEmbeddingsIndex: есть ли индекс “по факту” (кол-во записей > 0)
  // - isEmbeddingsIndexStale: индекс есть, но его паспорт не совпадает с текущими настройками
  // - isEmbeddingsIndexUnknown: индекс есть, но паспорт отсутствует (скорее всего данные из старой версии)
  //
  // ВАЖНО:
  // - Мы сравниваем строки после trim, чтобы не ловить ложные отличия из-за пробелов.
  // - Мы НЕ пытаемся “угадывать” размерность/модель по данным векторов — это дорого и ненадёжно.
  /**
   * Нормализует “ID модели” для сравнения.
   *
   * Почему нужна нормализация:
   * - некоторые провайдеры (например, OpenRouter) могут возвращать model-id в другом регистре
   *   (`Qwen/Qwen3-Embedding-8B`), хотя фактически это тот же идентификатор,
   *   что и в настройках (`qwen/qwen3-embedding-8b`).
   *
   * Мы считаем различия регистра НЕсущественными.
   */
  const normalizeModelIdForCompare = (value: string | null | undefined): string =>
    String(value ?? '').trim().toLowerCase();

  /**
   * Нормализует embeddingsBaseUrl для сравнения.
   *
   * Что делаем:
   * - trim()
   * - убираем хвостовые “/”, чтобы `.../v1` и `.../v1/` считались одинаковыми
   * - приводим к lower-case (scheme/host case-insensitive; path у нас стабильный)
   */
  const normalizeBaseUrlForCompare = (value: string | null | undefined): string =>
    String(value ?? '')
      .trim()
      .replace(/\/+$/g, '')
      .toLowerCase();

  const hasEmbeddingsIndex = embeddingsCount > 0;
  const isEmbeddingsIndexUnknown = hasEmbeddingsIndex && !embeddingsIndexMeta;
  const isEmbeddingsIndexStale =
    hasEmbeddingsIndex &&
    Boolean(embeddingsIndexMeta) &&
    (
      normalizeModelIdForCompare(embeddingsIndexMeta?.embeddingsModel) !== normalizeModelIdForCompare(embeddingsModel) ||
      normalizeBaseUrlForCompare(embeddingsIndexMeta?.embeddingsBaseUrl) !== normalizeBaseUrlForCompare(embeddingsBaseUrl)
    );

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
                  {/*
                    UX-логика для Embeddings Model:
                    - OpenRouter: показываем селект по известным моделям из каталога.
                    - Custom: НЕЛЬЗЯ навязывать жёсткий список (у пользователя может быть любой сервер/model-id),
                      поэтому показываем простой input для ручного ввода.
                  */}
                  {apiProvider === 'custom' ? (
                    <>
                      {/* Ручной ввод модели эмбеддингов (Custom provider) */}
                      <Input
                        type="text"
                        value={embeddingsModel}
                        onChange={(e) => setEmbeddingsModel(e.target.value)}
                        // ВАЖНО: дефолт для custom в store — text-embedding-3-small,
                        // но placeholder оставляем как подсказку.
                        placeholder="text-embedding-3-small"
                        disabled={isReindexing || isClearingEmbeddings}
                      />
                    </>
                  ) : (
                    <>
                      {/* Выпадающий список моделей эмбеддингов (для провайдеров с известным каталогом) */}
                      <select
                        value={embeddingsModel}
                        onChange={(e) => handleEmbeddingsModelChange(e.target.value)}
                        className="w-full h-10 px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        disabled={isReindexing || isClearingEmbeddings}
                      >
                        {/*
                          Группируем embedding-модели по разработчикам.

                          Почему это важно:
                          - список моделей со временем растёт;
                          - без группировки пользователю сложно ориентироваться;
                          - вы отдельно просили “сгруппировать по разработчикам”.
                        */}
                        {Object.entries(groupByDeveloper(API_PROVIDERS[apiProvider].embeddingsModels))
                          .filter(([, models]) => models.length > 0)
                          .map(([developer, models]) => (
                            <optgroup key={developer} label={developer}>
                              {models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.dimension}d) - {m.description}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                      </select>

                      {/*
                        ВАЖНО: блок “Dimension: 4096” (и аналогичные) намеренно скрыт/удалён.
                        Причина: это служебная информация (размерность embedding-вектора), которая
                        не нужна большинству пользователей и визуально “захламляет” модалку настроек.

                        Если в будущем понадобится вернуть этот индикатор — можно снова вывести
                        `currentModel.dimension` рядом с выбором embedding-модели.
                      */}
                    </>
                  )}
                </>
              )}
            </div>
            
            {/*
              ================================================================
              СТАТУС EMBEDDINGS-ИНДЕКСА (динамическая метка)
              ================================================================
              Здесь мы показываем пользователю:
              - сколько карточек сейчас проиндексировано,
              - какой моделью/URL этот индекс был построен (если мета доступна),
              - и подсвечиваем предупреждение, если индекс устарел или “неизвестен”.
            */}

            {/* Компактный “паспорт индекса” */}
            <div className="p-3 rounded-lg border bg-muted/30 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="w-3 h-3" />
                <span className="font-medium">
                  {t.settings.indexedCards}: {embeddingsCount}
                </span>
              </div>

              {/* Показываем, чем был построен индекс, если мета известна */}
              {embeddingsIndexMeta && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.settings.embeddingsModel}:</span>
                    <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
                      {embeddingsIndexMeta.embeddingsModel || '—'}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.settings.currentEmbeddingsUrl}:</span>
                    <code className="text-[11px] bg-muted px-1 py-0.5 rounded break-all">
                      {embeddingsIndexMeta.embeddingsBaseUrl || '—'}
                    </code>
                  </div>
                </div>
              )}
            </div>

            {/* Предупреждение: индекс устарел / мета отсутствует (старый индекс) */}
            {(isEmbeddingsIndexStale || isEmbeddingsIndexUnknown) && (
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 space-y-3">
                <div className="flex items-start gap-2 text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p className="font-medium">{t.settings.embeddingsModelChangeWarning}</p>
                    <p className="text-sm opacity-90">
                      {isEmbeddingsIndexUnknown ? (
                        // Индекс есть, но мы не знаем, чем он был построен (данные из старой версии).
                        // В таком случае не можем гарантировать корректность семантического поиска.
                        t.settings.embeddingsIndexUnknownWarning
                      ) : (
                        // Индекс есть и мета известна, но она отличается от текущих настроек.
                        // Показываем сравнение “как было” vs “как сейчас”.
                        t.settings.embeddingsIndexStaleWarning
                          .replace('{indexedModel}', String(embeddingsIndexMeta?.embeddingsModel || '—'))
                          .replace('{indexedUrl}', String(embeddingsIndexMeta?.embeddingsBaseUrl || '—'))
                          .replace('{currentModel}', String((embeddingsModel || '').trim() || '—'))
                          .replace('{currentUrl}', String((embeddingsBaseUrl || '').trim() || '—'))
                      )}
                    </p>
                  </div>
                </div>

                {/* Действие: переиндексировать ВСЮ базу (все холсты) */}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={handleReindexAllCanvases}
                    disabled={!apiKey || isReindexing || isClearingEmbeddings}
                  >
                    {isClearingEmbeddings ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t.settings.clearingIndex}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {t.settings.reindexAllCanvases}
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
                    <p className="font-medium">
                      {isClearingEmbeddings ? t.settings.clearingIndex : t.settings.reindexingCards}
                    </p>
                    <p className="text-sm opacity-90">
                      {isClearingEmbeddings ? (
                        t.settings.reindexAllPreparing
                      ) : reindexAllProgress.canvasTotal > 0 ? (
                        t.settings.reindexAllProgress
                          .replace('{canvasCurrent}', String(reindexAllProgress.canvasCurrent))
                          .replace('{canvasTotal}', String(reindexAllProgress.canvasTotal))
                          .replace('{canvasName}', String(reindexAllProgress.canvasName || '—'))
                          .replace('{cardCurrent}', String(reindexAllProgress.cardCurrent))
                          .replace('{cardTotal}', String(reindexAllProgress.cardTotal))
                      ) : (
                        // Fallback на старый формат (если вдруг переиндексация запускается иначе)
                        t.settings.reindexingProgress
                          .replace('{current}', String(reindexProgress.current))
                          .replace('{total}', String(reindexProgress.total))
                      )}
                    </p>
                  </div>
                </div>
                
                {/* Прогресс-бар */}
                <div className="w-full h-2 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-blue-500 transition-all duration-200 ${isClearingEmbeddings ? 'animate-pulse' : ''}`}
                    style={{
                      width: isClearingEmbeddings
                        ? '100%'
                        : reindexAllProgress.cardTotal > 0
                          ? `${(reindexAllProgress.cardCurrent / reindexAllProgress.cardTotal) * 100}%`
                          : reindexProgress.total > 0
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
