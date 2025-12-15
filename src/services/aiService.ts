/**
 * @file aiService.ts
 * @description Сервис для взаимодействия с AI API (чат и суммаризация)
 */

import type { ChatMessage, NodeAttachment } from '@/types/canvas';

export interface ChatRequestParams {
  messages: ChatMessage[];
  context?: string;
  /** Системная инструкция холста (добавляется к глобальной) */
  systemPrompt?: string;

  /**
   * Вложения текущей карточки.
   *
   * ВАЖНО:
   * - `attachmentId` теперь = `docId` из глобальной библиотеки (data/library/**).
   * - Клиент передаёт только метаданные + docId.
   * - Сервер (/api/chat) сам читает файл ТОЛЬКО из библиотеки и решает:
   *   - text → добавить как system-context
   *   - image → добавить как multimodal parts (image_url)
   */
  attachments?: NodeAttachment[];
  apiKey: string;
  apiBaseUrl?: string;
  model: string;
  corporateMode?: boolean;
  signal?: AbortSignal;
}

export interface SummarizeRequestParams {
  text: string;
  apiKey: string;
  apiBaseUrl?: string;
  model: string;
  corporateMode?: boolean;
}

// =============================================================================
// ERROR TYPES
// =============================================================================
//
// ВАЖНО:
// - `fetch()` по умолчанию НЕ кидает исключение на HTTP 4xx/5xx.
// - Для логики retries на клиенте нам критично понимать HTTP статус.
// - Поэтому мы используем отдельный тип ошибки с полем `status`.

/**
 * Ошибка HTTP-ответа (response.ok === false).
 *
 * Зачем нужна:
 * - клиент (useNodeGeneration) должен отличать:
 *   - 401/403 (не ретраить, показать пользователю)
 *   - 429/5xx (часто ретраить можно)
 */
export class HttpError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Безопасно читаем текст ответа.
 *
 * Почему так:
 * - некоторые ответы могут быть пустыми
 * - некоторые могут быть не-текстовыми/обрываться
 * - мы НЕ хотим, чтобы чтение error body ломало обработку ошибки
 */
const safeReadText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};

/**
 * Отправляет запрос к API чата с поддержкой streaming
 */
export async function streamChatCompletion({
  messages,
  context,
  systemPrompt,
  attachments,
  apiKey,
  apiBaseUrl,
  model,
  corporateMode,
  signal
}: ChatRequestParams): Promise<Response> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      context,
      systemPrompt, // Передаём системную инструкцию холста
      attachments,
      apiKey,
      apiBaseUrl,
      model,
      corporateMode,
    }),
    signal,
  });

  if (!response.ok) {
    // Пытаемся вытащить максимально полезную диагностическую информацию.
    // /api/chat обычно возвращает JSON вида { error, details }, но гарантий нет,
    // поэтому читаем как text.
    const details = await safeReadText(response);
    const message = details?.trim()
      ? `HTTP ${response.status}: ${response.statusText}. ${details}`
      : `HTTP ${response.status}: ${response.statusText}`;
    throw new HttpError(response.status, message);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  return response;
}

/**
 * Отправляет запрос на генерацию summary
 */
export async function generateSummary({
  text,
  apiKey,
  apiBaseUrl,
  model,
  corporateMode
}: SummarizeRequestParams): Promise<string> {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      apiKey,
      apiBaseUrl,
      model,
      corporateMode,
    }),
  });

  if (!response.ok) {
    // Для summary мы тоже прокидываем HttpError:
    // - это помогает в будущем единообразно обрабатывать статусы в UI
    // - и даёт более понятные сообщения, чем «просто статус»
    const details = await safeReadText(response);
    const message = details?.trim()
      ? `Summary generation failed: HTTP ${response.status}. ${details}`
      : `Summary generation failed: HTTP ${response.status}`;
    throw new HttpError(response.status, message);
  }

  const data = await response.json();
  return data.summary;
}

