/**
 * @file route.ts
 * @description API Route для вычисления эмбеддингов текста
 * 
 * Этот endpoint принимает текст и возвращает его векторное представление
 * через API vsellm.ru (прокси к OpenAI Embeddings API).
 * 
 * Используется модель text-embedding-3-small (1536 измерений):
 * - Быстрая генерация
 * - Высокое качество
 * - Экономичная стоимость
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingResponse,
  type EmbeddingError,
} from '@/types/embeddings';

// =============================================================================
// КОНФИГУРАЦИЯ
// =============================================================================

/**
 * URL API для эмбеддингов через vsellm.ru
 * Совместим с OpenAI Embeddings API
 */
const EMBEDDINGS_API_URL = 'https://api.vsellm.ru/v1/embeddings';

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
  apiKey: string;
  /** Модель эмбеддингов (опционально) */
  model?: string;
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
 *   apiKey: string,    // API ключ vsellm.ru
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
    
    // Валидация: API ключ обязателен
    if (!body.apiKey || typeof body.apiKey !== 'string') {
      const error: EmbeddingError = {
        error: 'API ключ не указан',
        details: 'Пожалуйста, добавьте API ключ в настройках приложения',
      };
      return NextResponse.json(error, { status: 401 });
    }
    
    // Валидация: длина текста
    if (body.text.length > MAX_TEXT_LENGTH) {
      const error: EmbeddingError = {
        error: 'Текст слишком длинный',
        details: `Максимальная длина: ${MAX_TEXT_LENGTH} символов`,
      };
      return NextResponse.json(error, { status: 400 });
    }
    
    // Используем модель из запроса или модель по умолчанию
    const model = body.model || DEFAULT_EMBEDDING_MODEL;
    
    // =========================================================================
    // ЗАПРОС К API ЭМБЕДДИНГОВ
    // =========================================================================
    
    // Создаём AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    try {
      console.log('[Embeddings API] Запрос эмбеддинга, длина текста:', body.text.length);
      
      const response = await fetch(EMBEDDINGS_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${body.apiKey}`,
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
      
      throw fetchError;
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

