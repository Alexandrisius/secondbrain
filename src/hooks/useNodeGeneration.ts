/**
 * @file useNodeGeneration.ts
 * @description Хук для управления генерацией ответа (streaming, summary, embeddings)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useSettingsStore, selectApiKey, selectApiBaseUrl, selectModel, selectCorporateMode, selectUseSummarization, selectEmbeddingsBaseUrl } from '@/store/useSettingsStore';
import { streamChatCompletion, generateSummary, HttpError } from '@/services/aiService';
import { useTranslation } from '@/lib/i18n';
import type { NeuroNode, NodeAttachment } from '@/types/canvas';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';

interface UseNodeGenerationProps {
  id: string;
  data: NeuroNode['data'];
  buildParentContext: () => string | undefined;
  // NOTE:
  // - Раньше сюда передавались прямые родители (directParents) на случай,
  //   если мы захотим автоматически подмешивать их вложения в запрос генерации.
  // - В текущей реализации генерации это НЕ используется: вложения берём только из текущей ноды,
  //   а родительский контекст собирается через `buildParentContext()`.
  // - Поэтому directParents удалён из API хука, чтобы ESLint не валил сборку из-за unused vars.
  localPrompt: string;
  setIsAnswerExpanded: (val: boolean) => void;
}

// =============================================================================
// SSE / STREAMING HELPERS
// =============================================================================
//
// ВАЖНО:
// - `/api/chat` проксирует внешний SSE-стрим «как есть».
// - В streaming нет гарантии, что границы чанков совпадают с границами строк.
// - JSON одного SSE события может быть разрезан границей чанка.
//
// Поэтому мы:
// - буферизуем неполные строки между `reader.read()`
// - коммитим событие только на границе SSE события (пустая строка)
// - парсим JSON устойчиво (join('\n') + fallback join(''))

/**
 * Пауза с поддержкой AbortSignal.
 *
 * Зачем это нужно:
 * - для ретраев с backoff мы ждём перед повтором,
 * - но если пользователь нажал Stop (AbortController), ждать нельзя — нужно мгновенно выйти.
 */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }

    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };

    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

/**
 * Добавляем небольшой случайный jitter (±20%).
 *
 * Почему это важно:
 * - если много клиентов одновременно получают временную ошибку (например 503),
 *   без jitter они все ретраят строго по расписанию и снова создают пик нагрузки.
 */
const withJitter = (baseMs: number): number => {
  const jitterFactor = 0.2;
  const delta = baseMs * jitterFactor;
  const r = (Math.random() * 2 - 1) * delta; // [-delta, +delta]
  return Math.max(0, Math.round(baseMs + r));
};

/**
 * Явная проверка AbortError (браузерный fetch / AbortController / наш sleep).
 */
const isAbortError = (err: unknown): boolean => {
  return err instanceof Error && err.name === 'AbortError';
};

/**
 * Какие HTTP-статусы считаем временными и достойными ретрая.
 */
const isRetryableHttpStatus = (status: number): boolean => {
  // 408: request timeout (промежуточные прокси, gateway)
  if (status === 408) return true;
  // 429: rate limit
  if (status === 429) return true;
  // 5xx: проблемы upstream/серверные временные ошибки
  if (status >= 500 && status <= 599) return true;
  return false;
};

/**
 * Устойчивый JSON.parse payload'а SSE события.
 *
 * В SSE событие может содержать несколько data:-строк.
 * По спеки они склеиваются через '\n'.
 *
 * Fallback join('') добавлен для «нестандартных» реализаций SSE,
 * которые дробят JSON на несколько data:-строк без подразумеваемых переносов.
 */
const parseSseEventJson = (dataLines: string[]): unknown | null => {
  if (dataLines.length === 0) return null;

  try {
    return JSON.parse(dataLines.join('\n'));
  } catch {
    if (dataLines.length > 1) {
      try {
        return JSON.parse(dataLines.join(''));
      } catch {
        return null;
      }
    }
    return null;
  }
};

/**
 * Достаём `choices[0].delta.content` из OpenAI-compatible streaming JSON.
 *
 * Почему так «многословно»:
 * - мы НЕ используем `any`, чтобы ESLint/TS не ругались и чтобы ошибки типов не прятались
 * - структура JSON может отличаться у разных провайдеров (или быть частично пустой)
 * - поэтому делаем максимально безопасный проход по неизвестной структуре
 */
const extractDeltaContent = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return '';

  const obj = payload as Record<string, unknown>;
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== 'object') return '';

  const choiceObj = firstChoice as Record<string, unknown>;
  const delta = choiceObj.delta;
  if (!delta || typeof delta !== 'object') return '';

  const deltaObj = delta as Record<string, unknown>;
  const content = deltaObj.content;
  return typeof content === 'string' ? content : '';
};

export const useNodeGeneration = ({
  id,
  data,
  buildParentContext,
  localPrompt,
  setIsAnswerExpanded
}: UseNodeGenerationProps) => {
  const { t } = useTranslation();
  
  // Zustand actions
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const saveContextHash = useCanvasStore((s) => s.saveContextHash);
  const onBatchNodeComplete = useCanvasStore((s) => s.onBatchNodeComplete);
  const markChildrenStale = useCanvasStore((s) => s.markChildrenStale);
  const checkAndClearStale = useCanvasStore((s) => s.checkAndClearStale);

  // Settings
  const apiKey = useSettingsStore(selectApiKey);
  const apiBaseUrl = useSettingsStore(selectApiBaseUrl);
  const model = useSettingsStore(selectModel);
  const corporateMode = useSettingsStore(selectCorporateMode);
  const useSummarization = useSettingsStore(selectUseSummarization);
  const embeddingsBaseUrl = useSettingsStore(selectEmbeddingsBaseUrl);
  const embeddingsModel = useSettingsStore((s) => s.embeddingsModel);

  // Системная инструкция холста
  const systemPrompt = useCanvasStore((s) => s.systemPrompt);

  // Активный холст (нужен для вложений: data/attachments/<canvasId>/...)
  const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);

  /**
   * ЛЕНИВЫЙ АНАЛИЗ ВЛОЖЕНИЙ (summary / image description) — FIRE-AND-FORGET
   *
   * Ключевая продуктовая логика:
   * - upload вложений должен быть быстрым → НЕ считаем LLM-атрибуты при загрузке
   * - но потомкам нужны "суть документа" и "описание картинки"
   * - поэтому при первой генерации ответа карточки, где есть attachments, мы:
   *   1) запускаем `/api/attachments/analyze` в фоне (без await)
   *   2) когда ответ пришёл — кэшируем результаты в node.data (attachmentSummaries / attachmentImageDescriptions)
   *   3) пропагируем эти кэши по другим карточкам-ссылкам (best-effort)
   *
   * Важно:
   * - Это НЕ должно тормозить streaming ответа пользователю
   * - Поэтому мы никогда не await'им этот запрос в основном потоке генерации
   */
  const triggerAttachmentsAnalyzeInBackground = useCallback((params: {
    canvasId: string;
    attachmentIds: string[];
    /**
     * Языковая “подсказка” — текст вопроса пользователя.
     *
     * Почему передаём сюда:
     * - серверу нужно понять, на каком языке генерировать описание изображения,
     *   чтобы оно соответствовало языку вопроса (требование пользователя).
     *
     * Важно:
     * - это не секрет и не токен,
     * - но мы всё равно не хотим слать сюда мегабайты текста,
     *   поэтому ниже ограничиваем длину.
     */
    languageHintText?: string;
  }) => {
    // Минимальная защита от бессмысленных запросов
    if (!params.canvasId || params.attachmentIds.length === 0) return;
    if (!apiKey) return;

    // Fire-and-forget: мы намеренно НЕ ждём результат здесь.
    void (async () => {
      try {
        // Языковая подсказка: берём вопрос пользователя, но ограничиваем длину,
        // чтобы:
        // - не раздувать request body,
        // - не тратить лишние токены на стороне LLM,
        // - избежать потенциальных проблем со слишком длинными строками.
        const languageHintText = (params.languageHintText || '').trim();
        const safeLanguageHintText =
          languageHintText.length > 2000 ? languageHintText.slice(0, 2000) : languageHintText;

        const res = await fetch('/api/attachments/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canvasId: params.canvasId,
            attachmentIds: params.attachmentIds,
            languageHintText: safeLanguageHintText,
            apiKey,
            apiBaseUrl,
            model,
            corporateMode,
            // Важно: по вашему решению summary считаем только если настройка включена.
            useSummarization,
          }),
        });

        if (!res.ok) {
          // Best-effort: не валим генерацию и не показываем ошибку пользователю.
          // Это фоновая оптимизация контекста.
          return;
        }

        const payload = (await res.json().catch(() => ({}))) as {
          attachmentSummaries?: unknown;
          attachmentImageDescriptions?: unknown;
        };

        const safeStringMap = (v: unknown): Record<string, string> => {
          if (!v || typeof v !== 'object') return {};
          const obj = v as Record<string, unknown>;
          const out: Record<string, string> = {};
          for (const [k, val] of Object.entries(obj)) {
            if (typeof val === 'string') out[k] = val;
          }
          return out;
        };

        const newSummaries = safeStringMap(payload.attachmentSummaries);
        const newImageDescriptions = safeStringMap(payload.attachmentImageDescriptions);

        // Если сервер ничего нового не посчитал — не трогаем store (избегаем лишних ререндеров).
        if (Object.keys(newSummaries).length === 0 && Object.keys(newImageDescriptions).length === 0) {
          return;
        }

        // Достаём актуальные nodes и updateNodeData прямо из store,
        // чтобы не зависеть от устаревших замыканий (closures).
        const { nodes, updateNodeData } = useCanvasStore.getState();

        // ---------------------------------------------------------------------
        // 1) Кэшируем результаты в текущей карточке
        // ---------------------------------------------------------------------
        //
        // Важно:
        // - берём текущие значения из store (а не из `data` пропса),
        //   потому что `data` может быть "старым" в момент, когда фон завершился.
        const currentNode = nodes.find((n) => n.id === id) || null;
        if (currentNode) {
          const existingSummaries =
            currentNode.data.attachmentSummaries && typeof currentNode.data.attachmentSummaries === 'object'
              ? (currentNode.data.attachmentSummaries as Record<string, string>)
              : {};
          const existingImageDescriptions =
            currentNode.data.attachmentImageDescriptions && typeof currentNode.data.attachmentImageDescriptions === 'object'
              ? (currentNode.data.attachmentImageDescriptions as Record<string, string>)
              : {};

          const nextSummaries = { ...existingSummaries, ...newSummaries };
          const nextImageDescriptions = { ...existingImageDescriptions, ...newImageDescriptions };

          // Патчим только если действительно что-то добавили/изменили.
          // Это важно для производительности и для корректной stale-логики.
          const summariesChanged = JSON.stringify(existingSummaries) !== JSON.stringify(nextSummaries);
          const imagesChanged = JSON.stringify(existingImageDescriptions) !== JSON.stringify(nextImageDescriptions);

          if (summariesChanged || imagesChanged) {
            updateNodeData(id, {
              ...(summariesChanged ? { attachmentSummaries: nextSummaries } : {}),
              ...(imagesChanged ? { attachmentImageDescriptions: nextImageDescriptions } : {}),
            });
          }
        }

        // ---------------------------------------------------------------------
        // 2) Пропагируем по всем карточкам-ссылкам (best-effort)
        // ---------------------------------------------------------------------
        //
        // Это приближает нас к модели "файловый менеджер холста":
        // - файл один на холст
        // - карточек-ссылок много
        // - метаданные "суть файла" должны быть одинаковыми у всех ссылок
        const summaryKeys = Object.keys(newSummaries);
        const imageKeys = Object.keys(newImageDescriptions);
        if (summaryKeys.length === 0 && imageKeys.length === 0) return;

        nodes.forEach((node) => {
          if (node.id === id) return;
          const atts = Array.isArray(node.data.attachments) ? (node.data.attachments as NodeAttachment[]) : [];
          if (atts.length === 0) return;

          const hasAnySummary = summaryKeys.some((k) => atts.some((a) => a.attachmentId === k));
          const hasAnyImage = imageKeys.some((k) => atts.some((a) => a.attachmentId === k));
          if (!hasAnySummary && !hasAnyImage) return;

          const existingSummaries =
            node.data.attachmentSummaries && typeof node.data.attachmentSummaries === 'object'
              ? (node.data.attachmentSummaries as Record<string, string>)
              : {};
          const existingImageDescriptions =
            node.data.attachmentImageDescriptions && typeof node.data.attachmentImageDescriptions === 'object'
              ? (node.data.attachmentImageDescriptions as Record<string, string>)
              : {};

          let changed = false;
          const nextSummaries = { ...existingSummaries };
          const nextImages = { ...existingImageDescriptions };

          if (hasAnySummary) {
            summaryKeys.forEach((k) => {
              if (!atts.some((a) => a.attachmentId === k)) return;
              if (nextSummaries[k] !== newSummaries[k]) {
                nextSummaries[k] = newSummaries[k];
                changed = true;
              }
            });
          }

          if (hasAnyImage) {
            imageKeys.forEach((k) => {
              if (!atts.some((a) => a.attachmentId === k)) return;
              if (nextImages[k] !== newImageDescriptions[k]) {
                nextImages[k] = newImageDescriptions[k];
                changed = true;
              }
            });
          }

          if (changed) {
            updateNodeData(node.id, {
              ...(hasAnySummary ? { attachmentSummaries: nextSummaries } : {}),
              ...(hasAnyImage ? { attachmentImageDescriptions: nextImages } : {}),
            });
          }
        });
      } catch (err) {
        // Best-effort: игнорируем любые ошибки фона.
        // Если анализ не случился — ничего критичного, просто потомки будут видеть fallback.
        console.warn('[useNodeGeneration] Attachments analyze failed (background):', err);
      }
    })();
  }, [apiKey, apiBaseUrl, model, corporateMode, useSummarization, id]);

  // Local state
  const [streamingText, setStreamingText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState(Boolean(data.response));

  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * STALE v2: флаг "в этой попытке мы уже каскадили stale потомкам".
   *
   * Зачем он нужен:
   * - по новой семантике мы помечаем потомков stale НЕ при каждом изменении контекста,
   *   а только когда пользователь решил запускать Generate/Regenerate у владельца.
   * - если генерация отменена/упала и response владельца фактически НЕ изменился,
   *   мы должны уметь быстро снять stale у потомков (reconcile по lastContextHash).
   */
  const cascadedChildrenStaleThisAttemptRef = useRef(false);

  /**
   * Генерация summary (фоновая)
   */
  const handleGenerateSummary = useCallback(async (responseText: string): Promise<string | null> => {
    if (!responseText || responseText.length < 100) {
      updateNodeData(id, { summary: responseText });
      return responseText;
    }

    updateNodeData(id, { isSummarizing: true });

    try {
      const summary = await generateSummary({
        text: responseText,
        apiKey: apiKey || '',
        apiBaseUrl,
        model,
        corporateMode
      });
      
      const result = summary || responseText.slice(0, 200) + '...';
      
      updateNodeData(id, {
        summary: result,
        isSummarizing: false
      });
      
      return result;
    } catch (err) {
      console.error('Summary generation error:', err);
      const fallback = responseText.slice(0, 200) + '...';
      updateNodeData(id, {
        summary: fallback,
        isSummarizing: false
      });
      return fallback;
    }
  }, [id, updateNodeData, apiKey, apiBaseUrl, model, corporateMode]);

  /**
   * Генерация эмбеддинга (фоновая)
   */
  const handleGenerateEmbedding = useCallback(async (responseText: string, summary?: string) => {
    if (!apiKey || !embeddingsBaseUrl || !embeddingsModel) return;

    try {
        const { generateAndSaveEmbedding } = await import('@/lib/search/semantic');
        const { useWorkspaceStore } = await import('@/store/useWorkspaceStore');
        const canvasId = useWorkspaceStore.getState().activeCanvasId;
        
        if (canvasId) {
             await generateAndSaveEmbedding(
                id,
                canvasId,
                localPrompt,
                responseText,
                apiKey,
                embeddingsBaseUrl,
                corporateMode,
                embeddingsModel,
                summary // Передаем summary
             );
             console.log('[useNodeGeneration] Эмбеддинг сохранён:', id);
        }
    } catch (err) {
        console.error('[useNodeGeneration] Ошибка эмбеддинга:', err);
    }
  }, [id, localPrompt, apiKey, embeddingsBaseUrl, embeddingsModel, corporateMode]);


  /**
   * Основной метод генерации
   */
  const handleGenerate = useCallback(async () => {
    if (!localPrompt.trim()) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setError(null);
    setStreamingText('');
    setIsGenerating(true);
    setIsAnswerExpanded(true); // Автораскрытие

    // =====================================================================
    // STALE v2: помечаем потомков stale на СТАРТЕ генерации
    // =====================================================================
    //
    // Продуктовая логика:
    // - любые "контекстные" правки делают stale только владельца (см. useCanvasStore.updateNodeData),
    //   чтобы не подсвечивать поддерево постоянно.
    // - но когда пользователь нажимает Generate/Regenerate в карточке, которая уже имеет ответ,
    //   это сигнал "родитель сейчас потенциально поменяет response" → контекст потомков потенциально изменится.
    //
    // Поэтому:
    // - если у карточки УЖЕ БЫЛ ответ (hasGeneratedOnce || data.response),
    //   помечаем потомков stale сразу при старте запроса.
    // - если это первая генерация (ответа ещё не было) — потомков не трогаем, потому что
    //   им нечего "устаревать" относительно несуществующего ответа родителя.
    cascadedChildrenStaleThisAttemptRef.current = false;
    const hadResponseBeforeThisGenerate = Boolean(data.response) || hasGeneratedOnce;
    if (hadResponseBeforeThisGenerate) {
      markChildrenStale(id);
      cascadedChildrenStaleThisAttemptRef.current = true;
    }

    // Update store state
    updateNodeData(id, {
      prompt: localPrompt,
      isGenerating: true,
      mode: 'result',
      isAnswerExpanded: true // Sync with store immediately
    });

    // Синхронный буфер «последнего видимого» текста.
    //
    // Почему он нужен:
    // - streamingText — это React state и обновляется асинхронно
    // - при резком обрыве стрима последнее setStreamingText() может не успеть примениться
    // - но мы хотим сохранить partial последней попытки (по требованию)
    let lastVisibleText = '';

    try {
      if (!apiKey) throw new Error(t.node.apiKeyMissing);

      const parentContext = buildParentContext();

      // Для корректной отмены и ретраев держим signal отдельной переменной.
      // ВАЖНО: abortControllerRef.current гарантированно существует здесь,
      // потому что мы только что его создали в начале handleGenerate().
      const signal = abortControllerRef.current.signal;

      // -----------------------------------------------------------------------
      // RETRIES (выбранная стратегия): 3 ретрая с backoff + jitter
      // -----------------------------------------------------------------------
      //
      // Что именно ретраим:
      // - сетевые ошибки
      // - временные HTTP статусы (408/429/5xx)
      // - обрыв стрима в процессе чтения
      //
      // Поведение при ретрае (вы выбрали):
      // - перезапускаем запрос с нуля
      // - и ПЕРЕЗАПИСЫВАЕМ partial-текст (clear -> новый стрим)
      //
      // Почему «продолжить» нельзя корректно:
      // - OpenAI-compatible streaming не поддерживает resume по смещению,
      // - поэтому единственный честный автоматический вариант — перезапуск.

      const retryDelaysMs = [500, 1500, 3500];
      const maxRetries = retryDelaysMs.length;

      // fullText — итог последней успешной/текущей попытки.
      // lastVisibleText — то, что мы уже отдали в UI (важно для сохранения partial при ошибке).
      let fullText = '';
      lastVisibleText = '';

      /**
       * Одна попытка: fetch + чтение SSE + сбор текста.
       * Возвращаем собранный текст (commit в store сделаем снаружи).
       */
      const runSingleStreamingAttempt = async (): Promise<string> => {
        // ---------------------------------------------------------------------
        // ВЛОЖЕНИЯ (ATTACHMENTS)
        // ---------------------------------------------------------------------
        //
        // ВАЖНО:
        // - Вложения хранятся на диске и подтягиваются сервером (/api/chat).
        // - Клиент должен передать:
        //   - canvasId (чтобы сервер нашёл папку)
        //   - attachments (метаданные + attachmentId)
        //
        // КЛЮЧЕВОЕ ПРОДУКТОВОЕ ПРАВИЛО (файловый менеджер холста):
        // - ПОЛНЫЙ контент вложений (текст целиком / image parts) должен попадать в LLM
        //   ТОЛЬКО для той карточки, где файл прикреплён напрямую.
        // - Ни родители, ни дети, ни предки не должны автоматически "таскать" полные файлы.
        // - Для иерархического контекста мы используем ТОЛЬКО суммаризации/описания (без “полных файлов”).
        //   (см. useNodeContext и ContextViewerModal).
        //
        // Graceful degradation:
        // - Если canvasId по какой-то причине отсутствует — мы НЕ валим генерацию,
        //   а просто отправляем запрос без вложений (и логируем предупреждение).
        // 0) Какие вложения пользователь выключил из контекста в этой ноде
        const excludedAttachmentIds = Array.isArray(data.excludedAttachmentIds)
          ? (data.excludedAttachmentIds as string[])
          : [];

        // 1) Вложения самой текущей ноды (input пользователя)
        const rawSelfAttachments = Array.isArray(data.attachments) ? data.attachments : [];

        const ATTACHMENT_ID_RE =
          /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]+$/;

        const isValidAttachment = (a: unknown): a is NodeAttachment => {
          if (!a || typeof a !== 'object') return false;
          const o = a as Record<string, unknown>;
          return (
            typeof o.attachmentId === 'string' &&
            ATTACHMENT_ID_RE.test(o.attachmentId) &&
            // Остальные поля опциональны для /api/chat, но если они есть — это бонус для контекста.
            // (Сервер всё равно не доверяет mime/size и читает файл сам.)
            true
          );
        };

        // Собираем "безопасный" список вложений:
        // - валидный attachmentId
        // - не выключен пользователем (excludedAttachmentIds)
        // - порядок: как в списке вложений текущей карточки (важно для multimodal)
        const combined = [...rawSelfAttachments].filter(isValidAttachment);
        const safeAttachments = combined.filter((a) => !excludedAttachmentIds.includes(a.attachmentId));

        // Дедуп по attachmentId (на всякий случай), сохраняя порядок "первого появления"
        const seen = new Set<string>();
        const dedupedAttachments = safeAttachments.filter((a) => {
          if (seen.has(a.attachmentId)) return false;
          seen.add(a.attachmentId);
          return true;
        });

        const canSendAttachments = Boolean(activeCanvasId) && dedupedAttachments.length > 0;
        if (dedupedAttachments.length > 0 && !activeCanvasId) {
          console.warn('[useNodeGeneration] Attachments exist but activeCanvasId is null; sending request without attachments.');
        }

        // ---------------------------------------------------------------------
        // ЛЕНИВЫЙ АНАЛИЗ ВЛОЖЕНИЙ (BACKGROUND)
        // ---------------------------------------------------------------------
        //
        // Важно:
        // - Этот запрос НЕ должен блокировать LLM streaming.
        // - Поэтому он запускается "в фоне" (fire-and-forget).
        // - Сервер сам решит, нужно ли что-то считать (если уже посчитано и актуально — вернёт пусто).
        if (canSendAttachments) {
          triggerAttachmentsAnalyzeInBackground({
            canvasId: activeCanvasId || '',
            attachmentIds: dedupedAttachments.map((a) => a.attachmentId),
            // Ключевое требование: описание картинки должно быть на языке вопроса.
            // Поэтому передаём текст вопроса как “language hint”.
            languageHintText: localPrompt,
          });
        }

        const response = await streamChatCompletion({
          messages: [{ role: 'user', content: localPrompt }],
          context: parentContext,
          systemPrompt: systemPrompt || undefined, // Передаём системную инструкцию холста
          canvasId: canSendAttachments ? activeCanvasId || undefined : undefined,
          attachments: canSendAttachments ? (dedupedAttachments as NodeAttachment[]) : undefined,
          apiKey,
          apiBaseUrl,
          model,
          corporateMode,
          signal,
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader available');

        const decoder = new TextDecoder();

        // Буфер «сырого текста» (на случай, когда строка разрезана чанком).
        let textBuffer = '';

        // Накопление data:-строк текущего SSE события.
        let eventDataLines: string[] = [];

        // Флаг: получили [DONE] (можно завершать чтение).
        let sawDone = false;

        /**
         * Коммитим одно SSE событие (завершилось пустой строкой).
         *
         * Важно:
         * - мы НЕ пытаемся парсить JSON до тех пор, пока событие не завершено,
         *   иначе вернёмся к багу с разрывом JSON на границе чанка.
         */
        const commitEvent = () => {
          if (eventDataLines.length === 0) return;

          const joinedPayload = eventDataLines.join('\n');
          const trimmed = joinedPayload.trim();

          // Стандартный маркер конца стрима у OpenAI-compatible API
          if (trimmed === '[DONE]') {
            sawDone = true;
            eventDataLines = [];
            return;
          }

          const parsed = parseSseEventJson(eventDataLines);
          eventDataLines = [];

          // Если JSON не распарсился — просто игнорируем это событие.
          // Это безопаснее, чем убивать весь стрим (и UX) из-за 1 «битого» кадра.
          if (!parsed || typeof parsed !== 'object') return;

          // Ожидаемый формат delta (OpenAI-compatible):
          // { choices: [{ delta: { content: "..." } }] }
          const content = extractDeltaContent(parsed);

          if (content) {
            fullText += content;
            lastVisibleText = fullText;
            setStreamingText(fullText);
          }
        };

        /**
         * Обрабатываем одну строку SSE (без '\n').
         */
        const processLine = (rawLine: string) => {
          // Нормализация CRLF: если строка закончилась '\r', убираем его.
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

          // Пустая строка = граница SSE события
          if (line === '') {
            commitEvent();
            return;
          }

          // Комментарий SSE
          if (line.startsWith(':')) return;

          // data: (может быть и `data:` и `data: `)
          if (line.startsWith('data:')) {
            let dataPart = line.slice('data:'.length);
            if (dataPart.startsWith(' ')) dataPart = dataPart.slice(1);
            eventDataLines.push(dataPart);
            return;
          }

          // Остальные поля SSE (event:, id:, retry:) сейчас не используем.
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // ВАЖНО: stream:true — иначе UTF-8 символы на границе чанка могут поломаться.
            textBuffer += decoder.decode(value, { stream: true });

            // Достаём строки из буфера (одна за другой)
            while (true) {
              const nlIndex = textBuffer.indexOf('\n');
              if (nlIndex === -1) break;

              const line = textBuffer.slice(0, nlIndex);
              textBuffer = textBuffer.slice(nlIndex + 1);

              processLine(line);
              if (sawDone) break;
            }

            if (sawDone) break;
          }

          // Финальный flush декодера (закрывает поток символов)
          const tail = decoder.decode();
          if (tail) textBuffer += tail;

          // Если в буфере осталась «последняя строка без \n» — обработаем её
          if (textBuffer.length > 0) {
            processLine(textBuffer);
            textBuffer = '';
          }

          // Если стрим закончился без пустой строки-разделителя, но мы накопили data:-строки —
          // попробуем всё равно закоммитить последнее событие (эвристика).
          commitEvent();

          return fullText;
        } finally {
          // Закрываем reader, чтобы аккуратно освободить ресурсы.
          // Даже если он уже закрыт — cancel безопасно.
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
        }
      };

      // Основной цикл попыток: 1 попытка + maxRetries повторов
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // При ретрае — очищаем partial и начинаем «с чистого листа»
        if (attempt > 0) {
          fullText = '';
          lastVisibleText = '';
          setStreamingText('');
        }

        try {
          fullText = await runSingleStreamingAttempt();
          break; // success
        } catch (err) {
          // Отмена пользователем — не считаем ошибкой и не ретраим.
          if (isAbortError(err)) throw err;

          // Если это HTTP ошибка — ретраим только «временные» статусы.
          const isRetryable = err instanceof HttpError
            ? isRetryableHttpStatus(err.status)
            : true; // сетевые/стрим ошибки обычно временные

          const hasMoreAttempts = attempt < maxRetries;
          if (!isRetryable || !hasMoreAttempts) {
            // ВАЖНО: не теряем partial последней попытки — сохраняем его через outer catch ниже.
            throw err;
          }

          // Backoff перед повтором (с jitter)
          const baseDelay = retryDelaysMs[attempt];
          const delay = withJitter(baseDelay);
          await sleep(delay, signal);
        }
      }

      // Final commit
      updateNodeData(id, {
        response: fullText,
        isGenerating: false,
        isStale: false,
      });

      saveContextHash(id);
      onBatchNodeComplete(id);
      setHasGeneratedOnce(true);

      // Background tasks
      // Сначала генерируем summary, потом используем его для эмбеддинга
      if (useSummarization) {
        const summary = await handleGenerateSummary(fullText);
        handleGenerateEmbedding(fullText, summary || undefined);
      } else {
        handleGenerateEmbedding(fullText);
      }

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;

      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);

      // ВАЖНО (по плану): если стрим оборвался и все ретраи исчерпаны,
      // мы сохраняем partial последней попытки, чтобы пользователь не терял результат.
      //
      // Почему не используем ТОЛЬКО `streamingText`:
      // - setState асинхронный, и при резком обрыве последнее значение могло не успеть примениться
      // - поэтому при стриминге мы обновляем `lastVisibleText` синхронно вместе с fullText
      const partial = lastVisibleText?.trim() ? lastVisibleText : null;

      updateNodeData(
        id,
        partial
          ? { response: partial, isGenerating: false, isStale: false }
          : { isGenerating: false }
      );

      // STALE v2:
      // - если мы пометили потомков stale на старте этой попытки,
      //   но генерация не завершилась успешно, то:
      //   - если response владельца не изменился, reconcile снимет stale у потомков,
      //   - если response изменился (например мы сохранили partial), reconcile НЕ снимет stale,
      //     потому что их текущий hash уже не совпадает с lastContextHash.
      if (cascadedChildrenStaleThisAttemptRef.current) {
        checkAndClearStale(id);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      cascadedChildrenStaleThisAttemptRef.current = false;
    }
  }, [
    id, localPrompt, apiKey, t.node.apiKeyMissing, buildParentContext, 
    apiBaseUrl, model, corporateMode, systemPrompt, updateNodeData, saveContextHash, 
    onBatchNodeComplete, handleGenerateEmbedding, useSummarization, 
    handleGenerateSummary, setIsAnswerExpanded,
    // STALE v2
    markChildrenStale,
    checkAndClearStale,
    hasGeneratedOnce,
    // ВАЖНО (React hooks / exhaustive-deps):
    // - Внутри handleGenerate мы читаем `data.response` (см. hadResponseBeforeThisGenerate).
    // - Если НЕ добавить `data.response` в зависимости, то handleGenerate может "захватить"
    //   устаревшее значение ответа и принять неверное решение:
    //   - нужно ли помечать потомков stale на старте (когда у ноды уже был ответ),
    //   - или считать это первой генерацией (когда ответа ещё не было).
    // - Это проявляется как "неожиданные" stale-подсветки/их отсутствие при Regenerate.
    data.response,
    // Вложения
    data.attachments,
    data.excludedAttachmentIds,
    // ВАЖНО (React hooks / exhaustive-deps):
    // - Ранее сюда были добавлены `data.excludedContextNodeIds` и `directParents`,
    //   но внутри handleGenerate они НЕ используются напрямую.
    // - Если эти значения влияют на контекст, то это уже отражено через `buildParentContext`
    //   (его ссылка меняется при изменении зависимостей внутри самого buildParentContext).
    activeCanvasId,
    triggerAttachmentsAnalyzeInBackground,
  ]);

  /**
   * Остановка генерации
   */
  const handleAbortGeneration = useCallback(() => {
    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
    }
    setIsGenerating(false);
    
    // Сохраняем частичный ответ
    if (streamingText.trim()) {
        updateNodeData(id, {
            response: streamingText,
            isGenerating: false,
            isStale: false
        });
        setHasGeneratedOnce(true);
    } else {
        updateNodeData(id, { isGenerating: false });
    }

    // STALE v2:
    // - если в этой попытке мы пометили потомков stale на старте,
    //   то при отмене нужно дать reconcile шанс снять stale у тех потомков,
    //   чей контекст фактически не менялся (hash == lastContextHash).
    if (cascadedChildrenStaleThisAttemptRef.current) {
      checkAndClearStale(id);
      cascadedChildrenStaleThisAttemptRef.current = false;
    }
  }, [id, streamingText, updateNodeData, checkAndClearStale]);

  /**
   * Регенерация
   */
  const handleRegenerate = useCallback(() => {
    setStreamingText('');
    updateNodeData(id, { response: null, summary: null });
    handleGenerate();
  }, [id, updateNodeData, handleGenerate]);

  // Эффект для авто-регенерации (например, при обновлении цитаты)
  const pendingRegenerateHandledRef = useRef(false);
  useEffect(() => {
    if (data.pendingRegenerate && localPrompt.trim() && !pendingRegenerateHandledRef.current) {
        pendingRegenerateHandledRef.current = true;
        updateNodeData(id, { pendingRegenerate: false });
        handleRegenerate();
    }
    if (!data.pendingRegenerate) {
        pendingRegenerateHandledRef.current = false;
    }
  }, [data.pendingRegenerate, localPrompt, id, updateNodeData, handleRegenerate]);

  return {
    isGenerating,
    streamingText,
    error,
    hasGeneratedOnce,
    handleGenerate,
    handleRegenerate,
    handleAbortGeneration
  };
};

