/**
 * @file route.ts
 * @description API Route для проксирования запросов к внешнему LLM API
 * 
 * Этот endpoint принимает запросы в формате OpenAI и перенаправляет их
 * к внешнему API провайдеру (vsellm.ru). Поддерживает streaming responses.
 * 
 * API ключ и модель передаются из клиента через тело запроса.
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
 * Таймаут запроса в миллисекундах
 */
const REQUEST_TIMEOUT = 60000; // 60 секунд

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Формат сообщения в запросе
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Тело входящего запроса
 */
interface ChatRequestBody {
  /** Сообщения в формате OpenAI */
  messages: ChatMessage[];
  /** Контекст от родительских нод */
  context?: string;
  /** API ключ для авторизации */
  apiKey?: string;
  /** Название модели (например "openai/gpt-4o") */
  model?: string;
  /** Температура генерации */
  temperature?: number;
  /** Максимальное количество токенов */
  maxTokens?: number;
}

// =============================================================================
// ОБРАБОТЧИК POST
// =============================================================================

/**
 * POST /api/chat
 * 
 * Проксирует запрос к LM Studio с поддержкой streaming.
 * 
 * Request body:
 * {
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   context?: string,
 *   temperature?: number,
 *   maxTokens?: number
 * }
 * 
 * Response: Server-Sent Events (SSE) stream
 */
export async function POST(request: NextRequest) {
  try {
    // =========================================================================
    // ПАРСИНГ ЗАПРОСА
    // =========================================================================
    
    const body: ChatRequestBody = await request.json();
    
    // Валидация обязательных полей
    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: 'Missing or invalid "messages" field' },
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
    
    // =========================================================================
    // ПОДГОТОВКА СООБЩЕНИЙ
    // =========================================================================
    
    // Если есть контекст от родительских нод, добавляем его как system message
    const messages: ChatMessage[] = [];
    
    if (body.context) {
      messages.push({
        role: 'system',
        content: `Context from previous thoughts:\n${body.context}`,
      });
    }
    
    // Добавляем основные сообщения
    messages.push(...body.messages);
    
    // =========================================================================
    // ЗАПРОС К LM STUDIO
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
          messages,
          temperature: body.temperature ?? 0.7,
          max_tokens: body.maxTokens ?? 2048,
          stream: true, // Включаем streaming
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Проверяем статус ответа
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error:', errorText);
        
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
      
      // Проверяем наличие body для streaming
      if (!response.body) {
        return NextResponse.json(
          { error: 'Нет ответа от API' },
          { status: 500 }
        );
      }
      
      // =========================================================================
      // STREAMING RESPONSE
      // =========================================================================
      
      // Создаём readable stream для передачи данных клиенту
      const stream = new ReadableStream({
        async start(streamController) {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) {
                // Отправляем маркер завершения
                streamController.enqueue(
                  new TextEncoder().encode('data: [DONE]\n\n')
                );
                streamController.close();
                break;
              }
              
              // Передаём chunk как есть (LM Studio уже отдаёт в SSE формате)
              const chunk = decoder.decode(value, { stream: true });
              streamController.enqueue(new TextEncoder().encode(chunk));
            }
          } catch (error) {
            console.error('Streaming error:', error);
            streamController.error(error);
          }
        },
      });
      
      // Возвращаем streaming response с правильными заголовками
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
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
    
    console.error('API chat error:', error);
    
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
 * OPTIONS /api/chat
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

