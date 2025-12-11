/**
 * @file aiService.ts
 * @description Сервис для взаимодействия с AI API (чат и суммаризация)
 */

import { ChatMessage } from '@/types/canvas';

export interface ChatRequestParams {
  messages: ChatMessage[];
  context?: string;
  /** Системная инструкция холста (добавляется к глобальной) */
  systemPrompt?: string;
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

/**
 * Отправляет запрос к API чата с поддержкой streaming
 */
export async function streamChatCompletion({
  messages,
  context,
  systemPrompt,
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
      apiKey,
      apiBaseUrl,
      model,
      corporateMode,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
    throw new Error(`Summary generation failed: ${response.status}`);
  }

  const data = await response.json();
  return data.summary;
}

