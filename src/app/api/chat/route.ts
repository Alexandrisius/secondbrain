/**
 * @file route.ts
 * @description API Route для проксирования запросов к внешнему LLM API
 * 
 * Этот endpoint принимает запросы в формате OpenAI и перенаправляет их
 * к выбранному пользователем API провайдеру. Поддерживает streaming responses.
 * 
 * Поддерживаются любые OpenAI-совместимые API:
 * - OpenAI (api.openai.com)
 * - OpenRouter (openrouter.ai)
 * - vsellm.ru
 * - Groq
 * - Together AI
 * - Любой custom OpenAI-compatible API (LM Studio, Ollama, etc.)
 * 
 * API ключ, модель и базовый URL передаются из клиента через тело запроса.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildFullSystemPrompt } from '@/lib/systemPrompt';

// =============================================================================
// NEXT.JS ROUTE КОНФИГУРАЦИЯ (для streaming)
// =============================================================================

/**
 * Принудительно отключаем кеширование - каждый запрос к LLM уникален
 * Это гарантирует что Next.js не будет кешировать streaming ответы
 */
export const dynamic = 'force-dynamic';

/**
 * Используем Node.js runtime для лучшей поддержки streaming
 * Edge runtime тоже поддерживает streaming, но Node.js более совместим
 * с различными API провайдерами и SSL настройками
 */
export const runtime = 'nodejs';

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
  /** 
   * Системная инструкция холста
   * Объединяется с глобальной инструкцией и добавляется как system message
   */
  systemPrompt?: string;
  /** API ключ для авторизации */
  apiKey?: string;
  /** Базовый URL API провайдера (например "https://api.openai.com/v1") */
  apiBaseUrl?: string;
  /** Название модели (например "openai/gpt-4o") */
  model?: string;
  /** Температура генерации */
  temperature?: number;
  /** Максимальное количество токенов */
  maxTokens?: number;
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
    
    // Используем baseUrl из запроса или URL по умолчанию
    const apiBaseUrl = body.apiBaseUrl || DEFAULT_API_BASE_URL;
    
    // Формируем полный URL для chat/completions
    const apiUrl = `${apiBaseUrl}/chat/completions`;
    
    // Используем модель из запроса или модель по умолчанию
    const model = body.model || DEFAULT_MODEL;
    
    // =========================================================================
    // ПОДГОТОВКА СООБЩЕНИЙ
    // =========================================================================
    
    const messages: ChatMessage[] = [];
    
    // 1. Добавляем системную инструкцию (глобальная + холста)
    // buildFullSystemPrompt объединяет GLOBAL_SYSTEM_PROMPT и systemPrompt холста
    const fullSystemPrompt = buildFullSystemPrompt(body.systemPrompt);
    if (fullSystemPrompt) {
      messages.push({
        role: 'system',
        content: fullSystemPrompt,
      });
    }
    
    // 2. Если есть контекст от родительских нод, добавляем его как второй system message
    if (body.context) {
      messages.push({
        role: 'system',
        content: `=== Контекст из родительских карточек ===\n${body.context}`,
      });
    }
    
    // 3. Добавляем основные сообщения (вопрос пользователя)
    messages.push(...body.messages);
    
    // =========================================================================
    // ЗАПРОС К LM STUDIO
    // =========================================================================
    
    // Корпоративный режим: отключаем проверку SSL сертификатов
    // Это необходимо для работы в корпоративных сетях с SSL-инспекцией (DLP, прокси)
    // ВНИМАНИЕ: это снижает безопасность, использовать только в доверенных сетях!
    const originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (body.corporateMode) {
      console.log('[Chat API] Корпоративный режим: отключаем проверку SSL');
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    
    // Создаём AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    
    try {
      console.log(`[Chat API] Запрос к ${apiUrl}, модель: ${model}, corporateMode: ${body.corporateMode || false}`);
      
      const response = await fetch(apiUrl, {
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
      
      // ВАЖНО: Проксируем stream напрямую от внешнего API!
      // Это критично для реального streaming - не создаём промежуточный ReadableStream,
      // а передаём response.body напрямую клиенту.
      // 
      // Внешний API уже отдаёт данные в SSE формате (data: {...}\n\n),
      // мы просто передаём их клиенту как есть без буферизации.
      
      // Возвращаем streaming response с правильными заголовками
      // ВАЖНО: Эти headers критичны для корректного streaming!
      return new Response(response.body, {
        headers: {
          // SSE (Server-Sent Events) формат
          'Content-Type': 'text/event-stream',
          // Отключаем кеширование на всех уровнях
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          // Поддерживаем соединение открытым
          'Connection': 'keep-alive',
          // Отключаем буферизацию в nginx и других reverse proxy
          'X-Accel-Buffering': 'no',
          // Отключаем сжатие - оно может буферизировать чанки
          'Content-Encoding': 'none',
        },
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
            details: 'Включите "Корпоративный режим" в настройках, если работаете в корпоративной сети с SSL-инспекцией',
          },
          { status: 495 } // SSL Certificate Error
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

