/**
 * @file SystemPromptModal.tsx
 * @description Модальное окно для редактирования системной инструкции холста
 * 
 * Позволяет:
 * - Просмотреть глобальную системную инструкцию (readonly)
 * - Редактировать инструкцию для текущего холста
 * - Сохранить или отменить изменения
 * 
 * Системная инструкция применяется ко всем карточкам на холсте
 * и передаётся в контекст LLM перед контекстом родительских карточек.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FileText, Info, ChevronDown, ChevronUp, Save, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useTranslation } from '@/lib/i18n';
import { GLOBAL_SYSTEM_PROMPT } from '@/lib/systemPrompt';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Props для компонента SystemPromptModal
 */
interface SystemPromptModalProps {
  /** Открыто ли модальное окно */
  isOpen: boolean;
  /** Callback закрытия окна */
  onClose: () => void;
}

// =============================================================================
// КОМПОНЕНТ СЕКЦИИ С ЗАГОЛОВКОМ (COLLAPSIBLE)
// =============================================================================

interface CollapsibleSectionProps {
  /** Заголовок секции */
  title: string;
  /** Иконка заголовка */
  icon: React.ReactNode;
  /** Содержимое секции */
  children: React.ReactNode;
  /** Изначально раскрыта */
  defaultExpanded?: boolean;
  /** Цвет акцента */
  accentColor?: 'blue' | 'purple';
}

/**
 * Раскрывающаяся секция с заголовком
 */
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon,
  children,
  defaultExpanded = true,
  accentColor = 'blue',
}) => {
  // Состояние раскрытия секции
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Цветовые схемы
  const colors = {
    blue: {
      header: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
      icon: 'text-blue-600 dark:text-blue-400',
      title: 'text-blue-900 dark:text-blue-100',
    },
    purple: {
      header: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
      icon: 'text-purple-600 dark:text-purple-400',
      title: 'text-purple-900 dark:text-purple-100',
    },
  };

  const scheme = colors[accentColor];

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Заголовок секции - кликабельный */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          w-full flex items-center justify-between p-3
          ${scheme.header}
          transition-colors duration-200
          hover:opacity-90
        `}
      >
        <div className="flex items-center gap-2">
          <span className={scheme.icon}>{icon}</span>
          <span className={`font-medium ${scheme.title}`}>{title}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Содержимое секции */}
      {isExpanded && (
        <div className="p-3 bg-background border-t">
          {children}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// ОСНОВНОЙ КОМПОНЕНТ
// =============================================================================

/**
 * SystemPromptModal - модальное окно для редактирования системной инструкции
 * 
 * Показывает:
 * 1. Глобальную инструкцию (только для чтения, всегда применяется)
 * 2. Инструкцию холста (редактируемая, специфична для текущего холста)
 */
export const SystemPromptModal: React.FC<SystemPromptModalProps> = ({
  isOpen,
  onClose,
}) => {
  // ===========================================================================
  // ЛОКАЛИЗАЦИЯ
  // ===========================================================================
  
  const { t } = useTranslation();

  // ===========================================================================
  // STORE
  // ===========================================================================

  // Текущая системная инструкция холста из store
  const systemPrompt = useCanvasStore((s) => s.systemPrompt);
  const setSystemPrompt = useCanvasStore((s) => s.setSystemPrompt);

  // ===========================================================================
  // ЛОКАЛЬНОЕ СОСТОЯНИЕ
  // ===========================================================================

  // Локальная копия для редактирования (чтобы не менять store при каждом нажатии)
  const [localPrompt, setLocalPrompt] = useState<string>('');

  // Флаг: есть ли несохранённые изменения
  const [hasChanges, setHasChanges] = useState(false);

  // ===========================================================================
  // ЭФФЕКТЫ
  // ===========================================================================

  /**
   * Синхронизируем локальное состояние с store при открытии окна
   */
  useEffect(() => {
    if (isOpen) {
      setLocalPrompt(systemPrompt || '');
      setHasChanges(false);
    }
  }, [isOpen, systemPrompt]);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  /**
   * Обработчик изменения текста в textarea
   */
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalPrompt(newValue);
    
    // Проверяем есть ли изменения относительно сохранённого значения
    const savedValue = systemPrompt || '';
    setHasChanges(newValue !== savedValue);
  }, [systemPrompt]);

  /**
   * Сохранить изменения и закрыть окно
   */
  const handleSave = useCallback(() => {
    // Сохраняем в store (пустую строку конвертируем в null)
    const valueToSave = localPrompt.trim() || null;
    setSystemPrompt(valueToSave);
    setHasChanges(false);
    onClose();
  }, [localPrompt, setSystemPrompt, onClose]);

  /**
   * Отменить изменения и закрыть окно
   */
  const handleCancel = useCallback(() => {
    // Просто закрываем без сохранения
    setLocalPrompt(systemPrompt || '');
    setHasChanges(false);
    onClose();
  }, [systemPrompt, onClose]);

  /**
   * Очистить инструкцию холста
   */
  const handleClear = useCallback(() => {
    setLocalPrompt('');
    setHasChanges(systemPrompt !== null && systemPrompt !== '');
  }, [systemPrompt]);

  // ===========================================================================
  // РЕНДЕР
  // ===========================================================================

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Заголовок */}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            {t.systemPrompt?.title || 'Системная инструкция'}
          </DialogTitle>
          <DialogDescription>
            {t.systemPrompt?.description || 
              'Инструкция применяется ко всем карточкам на этом холсте. Глобальная инструкция добавляется автоматически.'}
          </DialogDescription>
        </DialogHeader>

        {/* Контент - скроллируемая область */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Секция 1: Глобальная инструкция (readonly) */}
          <CollapsibleSection
            title={t.systemPrompt?.globalSection || 'Глобальная инструкция'}
            icon={<Info className="w-4 h-4" />}
            defaultExpanded={false}
            accentColor="blue"
          >
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t.systemPrompt?.globalDescription || 
                  'Эта инструкция применяется ко всем холстам и не может быть изменена.'}
              </p>
              <pre className="p-3 rounded-md bg-muted/50 text-sm whitespace-pre-wrap font-mono text-foreground/80 max-h-48 overflow-y-auto">
                {GLOBAL_SYSTEM_PROMPT}
              </pre>
            </div>
          </CollapsibleSection>

          {/* Секция 2: Инструкция холста (редактируемая) */}
          <CollapsibleSection
            title={t.systemPrompt?.canvasSection || 'Инструкция холста'}
            icon={<FileText className="w-4 h-4" />}
            defaultExpanded={true}
            accentColor="purple"
          >
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {t.systemPrompt?.canvasDescription || 
                  'Дополнительная инструкция для этого холста. Добавляется после глобальной.'}
              </p>
              <textarea
                value={localPrompt}
                onChange={handleTextChange}
                placeholder={t.systemPrompt?.placeholder || 
                  'Например: "Отвечай кратко и по существу" или "Используй технический стиль изложения"'}
                className="
                  w-full h-40 p-3 rounded-md
                  bg-background border border-input
                  text-sm text-foreground
                  placeholder:text-muted-foreground
                  focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent
                  resize-none
                "
              />
              
              {/* Кнопка очистки */}
              {localPrompt && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="w-3 h-3 mr-1" />
                  {t.systemPrompt?.clear || 'Очистить'}
                </Button>
              )}
            </div>
          </CollapsibleSection>

          {/* Информационная подсказка */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                {t.systemPrompt?.hint || 
                  'Системная инструкция передаётся LLM в начале каждого запроса. Используйте её для настройки стиля ответов, указания роли или добавления контекста проекта.'}
              </p>
            </div>
          </div>
        </div>

        {/* Футер с кнопками */}
        <div className="flex items-center justify-between pt-4 border-t mt-4">
          {/* Индикатор изменений */}
          <div className="text-sm">
            {hasChanges && (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                {t.systemPrompt?.unsavedChanges || 'Есть несохранённые изменения'}
              </span>
            )}
          </div>

          {/* Кнопки действий */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleCancel}
            >
              {t.common?.cancel || 'Отмена'}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges}
              className="gap-2"
            >
              <Save className="w-4 h-4" />
              {t.common?.save || 'Сохранить'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// =============================================================================
// КОМПОНЕНТ КНОПКИ-ТРИГГЕРА
// =============================================================================

/**
 * Props для кнопки открытия модального окна системного промпта
 */
interface SystemPromptButtonProps {
  /** Callback открытия модального окна */
  onClick: () => void;
}

/**
 * Кнопка для открытия модального окна системного промпта
 * Стилизована под панель инструментов слева
 */
export const SystemPromptButton: React.FC<SystemPromptButtonProps> = ({ onClick }) => {
  const { t } = useTranslation();
  
  // Проверяем есть ли системная инструкция у текущего холста
  const systemPrompt = useCanvasStore((s) => s.systemPrompt);
  const hasPrompt = Boolean(systemPrompt?.trim());

  return (
    <button
      onClick={onClick}
      className={`
        group relative flex items-center justify-center w-12 h-12 rounded-2xl 
        bg-white dark:bg-zinc-900 border shadow-xl 
        hover:scale-110 transition-all duration-300
        ${hasPrompt 
          ? 'border-emerald-300 dark:border-emerald-700 hover:border-emerald-500/50 hover:shadow-emerald-500/20' 
          : 'border-zinc-200 dark:border-zinc-800 hover:border-violet-500/50 hover:shadow-violet-500/20'
        }
      `}
      title={t.systemPrompt?.buttonTooltip || 'Системная инструкция для LLM'}
    >
      {/* Градиентный фон при hover */}
      <div className={`
        absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity
        ${hasPrompt 
          ? 'bg-gradient-to-br from-emerald-500/10 to-teal-500/10' 
          : 'bg-gradient-to-br from-violet-500/10 to-purple-500/10'
        }
      `} />
      
      {/* Индикатор наличия инструкции */}
      {hasPrompt && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-900" />
      )}
      
      <span className="sr-only">{t.systemPrompt?.title || 'Системная инструкция'}</span>
      <FileText className={`
        w-6 h-6 transition-colors
        ${hasPrompt 
          ? 'text-emerald-600 dark:text-emerald-400 group-hover:text-emerald-500' 
          : 'text-zinc-700 dark:text-zinc-200 group-hover:text-violet-500'
        }
      `} />
    </button>
  );
};

// =============================================================================
// ЭКСПОРТ ПО УМОЛЧАНИЮ
// =============================================================================

export default SystemPromptModal;
