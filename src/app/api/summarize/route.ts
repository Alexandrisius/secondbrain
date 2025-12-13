/**
 * @file route.ts
 * @description API Route для суммаризации текста через внешний LLM API
 * 
 * Этот endpoint принимает текст и возвращает его краткое резюме (2-3 предложения).
 * Используется для генерации summary ответов, которые передаются внукам и далее
 * в иерархии карточек.
 * 
 * В отличие от /api/chat, этот endpoint НЕ использует streaming,
 * т.к. summary короткий и не требует постепенного отображения.
 * 
 * Поддерживаются любые OpenAI-совместимые API через параметр apiBaseUrl.
 */

import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_CHAT_MODEL_ID } from '@/lib/aiCatalog';

// =============================================================================
// КОНФИГУРАЦИЯ
// =============================================================================

/**
 * URL внешнего API провайдера по умолчанию
 * Используется если baseUrl не передан в запросе (для обратной совместимости)
 */
const DEFAULT_API_BASE_URL = 'https://api.vsellm.ru/v1';

/**
 * Модель по умолчанию
 * По умолчанию используем ту же модель, что и в UI/настройках,
 * чтобы серверный fallback не расходился с клиентским дефолтом.
 */
const DEFAULT_MODEL = DEFAULT_CHAT_MODEL_ID;

/**
 * Таймаут запроса в миллисекундах (меньше чем для основного chat)
 */
const REQUEST_TIMEOUT = 30000; // 30 секунд

/**
 * Системный промпт для суммаризации
 * Инструктирует модель создать краткое резюме
 */
// =============================================================================
// СИСТЕМНЫЙ ПРОМПТ ДЛЯ СУММАРИЗАЦИИ
// Написан на английском, чтобы не влиять на язык ответа.
// LLM должна определить язык входного текста и отвечать на том же языке.
// =============================================================================
const SUMMARIZE_SYSTEM_PROMPT = `You are a text summarization assistant.

Your task: condense the given text into 2-3 key sentences while preserving the main idea and important facts.

CRITICAL LANGUAGE RULE:
- Detect the language of the input text
- Write your summary in THE SAME LANGUAGE as the input
- If input is in Russian → summarize in Russian
- If input is in English → summarize in English
- If input is in any other language → summarize in that language

Rules:
- Be concise and to the point
- Preserve key facts and conclusions
- Do not add new information not present in the original
- Do not use introductory phrases like "This text discusses..." or "The author talks about..."
- Just provide a brief summary of the content`;

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Тело входящего запроса
 */
interface SummarizeRequestBody {
  /** Текст для суммаризации */
  text: string;
  /** API ключ для авторизации */
  apiKey?: string;
  /** Базовый URL API провайдера (например "https://api.openai.com/v1") */
  apiBaseUrl?: string;
  /** Название модели (например "openai/gpt-4o") */
  model?: string;
  /** 
   * Корпоративный режим - отключает проверку SSL сертификатов
   * Используется для работы в корпоративных сетях с SSL-инспекцией
   */
  corporateMode?: boolean;
}

// =============================================================================
// ОБРАБОТЧИК POST
// =============================================================================

/**
 * POST /api/summarize
 * 
 * Генерирует краткое резюме переданного текста.
 * 
 * Request body:
 * {
 *   text: "Длинный текст для суммаризации..."
 * }
 * 
 * Response:
 * {
 *   summary: "Краткое резюме в 2-3 предложения"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // =========================================================================
    // ПАРСИНГ ЗАПРОСА
    // =========================================================================
    
    const body: SummarizeRequestBody = await request.json();
    
    // Валидация обязательных полей
    if (!body.text || typeof body.text !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid "text" field' },
        { status: 400 }
      );
    }
    
    // Проверка наличия API ключа
    if (!body.apiKey) {
      return NextResponse.json(
        { 
          error: 'API ключ не указан',
          details: 'Пожалуйста, добавьте API ключ в настройках приложения',
        },
        { status: 401 }
      );
    }
    
    // Используем baseUrl из запроса или URL по умолчанию
    const apiBaseUrl = body.apiBaseUrl || DEFAULT_API_BASE_URL;
    
    // Формируем полный URL для chat/completions
    const apiUrl = `${apiBaseUrl}/chat/completions`;
    
    // Используем модель из запроса или модель по умолчанию
    const model = body.model || DEFAULT_MODEL;
    
    // Если текст слишком короткий, возвращаем его как есть
    if (body.text.length < 100) {
      return NextResponse.json({
        summary: body.text,
      });
    }
    
    // =========================================================================
    // ЗАПРОС К LM STUDIO (БЕЗ STREAMING)
    // =========================================================================
    
    // Корпоративный режим: отключаем проверку SSL сертификатов
    const originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (body.corporateMode) {
      console.log('[Summarize API] Корпоративный режим: отключаем проверку SSL');
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    
    // Создаём AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    try {
      console.log(`[Summarize API] Запрос к ${apiUrl}, модель: ${model}, corporateMode: ${body.corporateMode || false}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Авторизация через Bearer token
          'Authorization': `Bearer ${body.apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: SUMMARIZE_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: `Суммаризируй следующий текст:\n\n${body.text}`,
            },
          ],
          // Низкая температура для более стабильных результатов
          temperature: 0.3,
          // Ограничиваем токены - summary должен быть коротким
          max_tokens: 256,
          // БЕЗ streaming - получаем полный ответ сразу
          stream: false,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Проверяем статус ответа
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API summarize error:', errorText);
        
        // Специальная обработка ошибки авторизации
        if (response.status === 401) {
          return NextResponse.json(
            { 
              error: 'Неверный API ключ',
              details: 'Проверьте правильность API ключа в настройках',
            },
            { status: 401 }
          );
        }
        
        return NextResponse.json(
          { 
            error: `Ошибка API: ${response.status}`,
            details: errorText,
          },
          { status: response.status }
        );
      }
      
      // =========================================================================
      // ОБРАБОТКА ОТВЕТА
      // =========================================================================
      
      const data = await response.json();
      
      // Извлекаем текст ответа из формата OpenAI
      const summary = data.choices?.[0]?.message?.content || '';
      
      // Проверяем что получили непустой ответ
      if (!summary) {
        return NextResponse.json(
          { error: 'Пустой ответ от API' },
          { status: 500 }
        );
      }
      
      // Возвращаем summary
      return NextResponse.json({
        summary: summary.trim(),
      });
      
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
        return NextResponse.json(
          { error: 'Превышено время ожидания ответа от API' },
          { status: 504 }
        );
      }
      
      // Обработка ошибки подключения
      if (fetchError instanceof Error && 
          (fetchError.message.includes('ECONNREFUSED') || 
           fetchError.message.includes('fetch failed'))) {
        return NextResponse.json(
          { 
            error: 'Не удалось подключиться к API',
            details: 'Проверьте подключение к интернету',
          },
          { status: 503 }
        );
      }
      
      // Обработка SSL ошибок (корпоративные сети)
      if (fetchError instanceof Error && 
          (fetchError.message.includes('certificate') || 
           fetchError.message.includes('SSL') ||
           fetchError.message.includes('CERT'))) {
        return NextResponse.json(
          { 
            error: 'Ошибка SSL сертификата',
            details: 'Включите "Корпоративный режим" в настройках',
          },
          { status: 495 }
        );
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
    
    console.error('API summarize error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

// =============================================================================
// ОБРАБОТЧИК OPTIONS (CORS)
// =============================================================================

/**
 * OPTIONS /api/summarize
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

