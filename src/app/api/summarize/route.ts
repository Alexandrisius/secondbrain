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
 */

import { NextRequest, NextResponse } from 'next/server';

// =============================================================================
// КОНФИГУРАЦИЯ
// =============================================================================

/**
 * URL внешнего API провайдера
 * Используем vsellm.ru - прокси для доступа к различным LLM
 */
const API_BASE_URL = 'https://api.vsellm.ru/v1/chat/completions';

/**
 * Модель по умолчанию
 * Используем chatgpt-4o-latest - актуальная версия GPT-4o
 */
const DEFAULT_MODEL = 'openai/chatgpt-4o-latest';

/**
 * Таймаут запроса в миллисекундах (меньше чем для основного chat)
 */
const REQUEST_TIMEOUT = 30000; // 30 секунд

/**
 * Системный промпт для суммаризации
 * Инструктирует модель создать краткое резюме
 */
const SUMMARIZE_SYSTEM_PROMPT = `Ты - ассистент для суммаризации текста.
Твоя задача: сократить данный текст до 2-3 ключевых предложений, сохраняя основную суть и важные факты.
Правила:
- Пиши кратко и по существу
- Сохраняй ключевые факты и выводы
- Не добавляй новую информацию
- Не используй вводные фразы типа "В данном тексте говорится..."
- Просто дай краткое резюме содержания`;

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
  /** Название модели (например "openai/gpt-4o") */
  model?: string;
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
    
    // Создаём AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    try {
      const response = await fetch(API_BASE_URL, {
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
      
      throw fetchError;
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

