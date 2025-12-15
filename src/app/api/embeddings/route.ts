/**
 * @file route.ts
 * @description API Route для вычисления эмбеддингов текста
 * 
 * Этот endpoint принимает текст и возвращает его векторное представление
 * через выбранный OpenAI-совместимый Embeddings API (OpenRouter или Custom base URL).
 * 
 * Используется модель text-embedding-3-small (1536 измерений) по умолчанию:
 * - Быстрая генерация
 * - Высокое качество
 * - Экономичная стоимость
 * 
 * Поддерживаются любые OpenAI-совместимые Embeddings API через параметр embeddingsBaseUrl.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  type EmbeddingResponse,
  type EmbeddingError,
} from '@/types/embeddings';
import {
  getDemoOpenRouterApiKey,
  isDemoModeApiKey,
  OPENROUTER_BASE_URL,
  pickDemoEmbeddingsModelId,
} from '@/lib/openrouterDemo';

/**
 * Модель эмбеддингов по умолчанию (fallback если не указана в запросе)
 * Используется для обратной совместимости со старыми клиентами
 */
const FALLBACK_EMBEDDING_MODEL = 'text-embedding-3-small';

// =============================================================================
// КОНФИГУРАЦИЯ
// =============================================================================

/**
 * URL API для эмбеддингов по умолчанию.
 * Используется если embeddingsBaseUrl не передан в запросе (для обратной совместимости).
 */
const DEFAULT_EMBEDDINGS_BASE_URL = 'https://api.vsellm.ru/v1';

/**
 * Таймаут запроса в миллисекундах
 */
const REQUEST_TIMEOUT = 30000; // 30 секунд

/**
 * Максимальная длина текста для эмбеддинга
 * text-embedding-3-small поддерживает до 8191 токенов
 * Ограничиваем ~30000 символов для безопасности
 */
const MAX_TEXT_LENGTH = 30000;

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Тело входящего запроса
 */
interface RequestBody {
  /** Текст для векторизации */
  text: string;
  /** API ключ для авторизации */
  apiKey?: string;
  /** Базовый URL API провайдера для эмбеддингов (например "https://api.openai.com/v1") */
  embeddingsBaseUrl?: string;
  /** Модель эмбеддингов (опционально) */
  model?: string;
  /** 
   * Корпоративный режим - отключает проверку SSL сертификатов
   * Используется для работы в корпоративных сетях с SSL-инспекцией
   */
  corporateMode?: boolean;
}

/**
 * Ответ от OpenAI Embeddings API
 */
interface OpenAIEmbeddingResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// =============================================================================
// ОБРАБОТЧИК POST
// =============================================================================

/**
 * POST /api/embeddings
 * 
 * Вычисляет векторное представление (эмбеддинг) для переданного текста.
 * 
 * Request body:
 * {
 *   text: string,      // Текст для векторизации
 *   apiKey: string,    // API ключ выбранного провайдера (OpenAI-compatible)
 *   model?: string     // Модель (опционально)
 * }
 * 
 * Response:
 * {
 *   embedding: number[],  // Вектор 1536 измерений
 *   dimension: number,    // Размерность вектора
 *   model: string,        // Использованная модель
 *   tokenCount: number    // Количество токенов
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // =========================================================================
    // ПАРСИНГ ЗАПРОСА
    // =========================================================================
    
    const body: RequestBody = await request.json();
    
    // Валидация: текст обязателен
    if (!body.text || typeof body.text !== 'string') {
      const error: EmbeddingError = {
        error: 'Отсутствует или некорректный параметр "text"',
        details: 'Текст для векторизации обязателен',
      };
      return NextResponse.json(error, { status: 400 });
    }

    // =========================================================================
    // DEMO MODE (NO USER API KEY) — embeddings enabled
    // =========================================================================
    //
    // Требование проекта:
    // - В demo режиме мы хотим, чтобы работали и эмбеддинги (NeuroSearch),
    //   чтобы пользователь мог полноценно протестировать приложение.
    //
    // Решение:
    // - если apiKey пустой → используем встроенный OpenRouter demo key,
    // - embeddingsBaseUrl принудительно ставим на OpenRouter,
    // - модель принудительно ставим на qwen/qwen3-embedding-8b (по требованию автора).
    //
    // NOTE про localhost:
    // - если пользователь явно использует локальный embeddingsBaseUrl (localhost),
    //   мы НЕ включаем demoMode: некоторые локальные API могут работать без ключа.
    const incomingApiKey = String(body.apiKey ?? '').trim();
    const incomingBaseUrlRaw = String(body.embeddingsBaseUrl ?? '').trim();
    const incomingBaseUrl = incomingBaseUrlRaw || DEFAULT_EMBEDDINGS_BASE_URL;

    const isLocalHostLike =
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(incomingBaseUrl);
    const isKnownRemoteProvider =
      /openrouter\.ai/i.test(incomingBaseUrl) || /api\.vsellm\.ru/i.test(incomingBaseUrl);

    const demoMode = isDemoModeApiKey(incomingApiKey) && !isLocalHostLike && (isKnownRemoteProvider || !incomingBaseUrlRaw);

    const apiKeyToUse = demoMode ? getDemoOpenRouterApiKey() : incomingApiKey;
    const embeddingsBaseUrl = demoMode ? OPENROUTER_BASE_URL : incomingBaseUrl;
    const model = demoMode ? pickDemoEmbeddingsModelId() : (body.model || FALLBACK_EMBEDDING_MODEL);
    
    // Валидация: длина текста
    if (body.text.length > MAX_TEXT_LENGTH) {
      const error: EmbeddingError = {
        error: 'Текст слишком длинный',
        details: `Максимальная длина: ${MAX_TEXT_LENGTH} символов`,
      };
      return NextResponse.json(error, { status: 400 });
    }
    
    // Формируем полный URL для embeddings
    const apiUrl = `${embeddingsBaseUrl}/embeddings`;
    
    // =========================================================================
    // ЗАПРОС К API ЭМБЕДДИНГОВ
    // =========================================================================
    
    // Корпоративный режим: отключаем проверку SSL сертификатов
    const originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (body.corporateMode) {
      console.log('[Embeddings API] Корпоративный режим: отключаем проверку SSL');
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    
    // Создаём AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    try {
      console.log(`[Embeddings API] Запрос к ${apiUrl}, модель: ${model}, длина текста: ${body.text.length}, corporateMode: ${body.corporateMode || false}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKeyToUse
            ? { 'Authorization': `Bearer ${apiKeyToUse}` }
            : {}),
          ...( /openrouter\.ai/i.test(embeddingsBaseUrl)
            ? {
                'HTTP-Referer': 'https://neurocanvas.local',
                'X-Title': demoMode ? 'NeuroCanvas (Demo Mode)' : 'NeuroCanvas',
              }
            : {}),
        },
        body: JSON.stringify({
          model: model,
          input: body.text,
          // Можно добавить dimensions для уменьшения размерности (опционально)
          // dimensions: 512,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Проверяем статус ответа
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Embeddings API] Ошибка:', response.status, errorText);
        
        // Специальная обработка ошибки авторизации
        if (response.status === 401) {
          const error: EmbeddingError = {
            error: 'Неверный API ключ',
            details: 'Проверьте правильность API ключа в настройках',
          };
          return NextResponse.json(error, { status: 401 });
        }
        
        // Ошибка лимита
        if (response.status === 429) {
          const error: EmbeddingError = {
            error: 'Превышен лимит запросов',
            details: 'Подождите немного и попробуйте снова',
          };
          return NextResponse.json(error, { status: 429 });
        }
        
        const error: EmbeddingError = {
          error: `Ошибка API: ${response.status}`,
          details: errorText,
        };
        return NextResponse.json(error, { status: response.status });
      }
      
      // Парсим ответ
      const data: OpenAIEmbeddingResponse = await response.json();
      
      // Валидация ответа
      if (!data.data || data.data.length === 0 || !data.data[0].embedding) {
        const error: EmbeddingError = {
          error: 'Некорректный ответ от API',
          details: 'Не получен вектор эмбеддинга',
        };
        return NextResponse.json(error, { status: 500 });
      }
      
      const embedding = data.data[0].embedding;
      
      console.log(
        '[Embeddings API] Успешно. Размерность:',
        embedding.length,
        'Токенов:',
        data.usage?.total_tokens
      );
      
      // =========================================================================
      // ФОРМИРОВАНИЕ ОТВЕТА
      // =========================================================================
      
      const result: EmbeddingResponse = {
        embedding: embedding,
        dimension: embedding.length,
        model: data.model || model,
        tokenCount: data.usage?.total_tokens || 0,
      };
      
      return NextResponse.json(result);
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Восстанавливаем настройку SSL после ошибки
      if (body.corporateMode) {
        if (originalTlsReject !== undefined) {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
        } else {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
      }
      
      // Обработка ошибки таймаута
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        const error: EmbeddingError = {
          error: 'Превышено время ожидания',
          details: 'Сервер эмбеддингов не ответил вовремя',
        };
        return NextResponse.json(error, { status: 504 });
      }
      
      // Обработка ошибки подключения
      if (
        fetchError instanceof Error &&
        (fetchError.message.includes('ECONNREFUSED') ||
          fetchError.message.includes('fetch failed'))
      ) {
        const error: EmbeddingError = {
          error: 'Не удалось подключиться к API',
          details: 'Проверьте подключение к интернету',
        };
        return NextResponse.json(error, { status: 503 });
      }
      
      // Обработка SSL ошибок (корпоративные сети)
      if (fetchError instanceof Error && 
          (fetchError.message.includes('certificate') || 
           fetchError.message.includes('SSL') ||
           fetchError.message.includes('CERT'))) {
        const error: EmbeddingError = {
          error: 'Ошибка SSL сертификата',
          details: 'Включите "Корпоративный режим" в настройках',
        };
        return NextResponse.json(error, { status: 495 });
      }
      
      throw fetchError;
    } finally {
      // Гарантированно восстанавливаем настройку SSL
      if (body.corporateMode) {
        if (originalTlsReject !== undefined) {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
        } else {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
      }
    }
    
  } catch (error) {
    // =========================================================================
    // ОБРАБОТКА ОШИБОК
    // =========================================================================
    
    console.error('[Embeddings API] Внутренняя ошибка:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const errorResponse: EmbeddingError = {
      error: 'Внутренняя ошибка сервера',
      details: errorMessage,
    };
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// =============================================================================
// ОБРАБОТЧИК OPTIONS (CORS)
// =============================================================================

/**
 * OPTIONS /api/embeddings
 * 
 * Обработка preflight запросов для CORS
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

