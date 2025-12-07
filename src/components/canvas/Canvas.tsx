/**
 * @file Canvas.tsx
 * @description Обёртка Canvas с ReactFlowProvider
 * 
 * АРХИТЕКТУРНОЕ РЕШЕНИЕ:
 * React Flow требует, чтобы useReactFlow hook вызывался ВНУТРИ ReactFlowProvider.
 * Поэтому мы разделяем компонент на:
 * 
 * 1. Canvas (этот файл) - обёртка с Provider
 * 2. CanvasContent - внутренний компонент с логикой и хуками
 * 
 * Это позволяет использовать screenToFlowPosition и другие методы
 * из useReactFlow внутри CanvasContent.
 */

'use client';

import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { CanvasContent } from './CanvasContent';

// Импортируем стили React Flow
import '@xyflow/react/dist/style.css';

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * Canvas - главный компонент холста NeuroCanvas
 * 
 * Использование:
 * ```tsx
 * <Canvas />
 * ```
 * 
 * Компонент автоматически:
 * - Оборачивает содержимое в ReactFlowProvider
 * - Подключает стили React Flow
 * - Рендерит CanvasContent с полной функциональностью
 */
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasContent />
    </ReactFlowProvider>
  );
}

// =============================================================================
// ЭКСПОРТ ПО УМОЛЧАНИЮ
// =============================================================================

export default Canvas;

