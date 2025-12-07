/**
 * Система интернационализации (i18n)
 * 
 * Предоставляет:
 * - Типы для поддерживаемых языков
 * - Словари переводов
 * - Хук useTranslation для доступа к переводам
 * 
 * @module i18n
 */

import { ru, type TranslationKeys } from './ru';
import { en } from './en';
import { useSettingsStore, selectLanguage } from '@/store/useSettingsStore';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Поддерживаемые языки интерфейса
 */
export type Language = 'ru' | 'en';

/**
 * Словарь переводов по языкам
 */
const translations: Record<Language, TranslationKeys> = {
  ru,
  en,
};

// =============================================================================
// ЭКСПОРТ ТИПОВ
// =============================================================================

export type { TranslationKeys };

// =============================================================================
// ХУК useTranslation
// =============================================================================

/**
 * Хук для получения переводов в компонентах
 * 
 * Автоматически реагирует на изменение языка в настройках.
 * 
 * @returns Объект с функцией t для получения переводов и текущим языком
 * 
 * @example
 * ```tsx
 * const { t, language } = useTranslation();
 * 
 * return (
 *   <button>{t.common.done}</button>
 * );
 * ```
 */
export function useTranslation() {
  // Получаем текущий язык из store настроек
  const language = useSettingsStore(selectLanguage);
  
  // Возвращаем словарь переводов для текущего языка
  const t = translations[language];
  
  return {
    /** Объект с переводами для текущего языка */
    t,
    /** Текущий язык интерфейса */
    language,
  };
}

// =============================================================================
// УТИЛИТЫ
// =============================================================================

/**
 * Получить переводы для указанного языка (без хука)
 * 
 * Полезно для использования вне React компонентов.
 * 
 * @param language - Код языка
 * @returns Словарь переводов
 */
export function getTranslations(language: Language): TranslationKeys {
  return translations[language];
}

/**
 * Форматирование строки с подстановкой значений
 * 
 * @param template - Строка шаблона с placeholders вида {key}
 * @param values - Объект со значениями для подстановки
 * @returns Отформатированная строка
 * 
 * @example
 * ```ts
 * format('Hello, {name}!', { name: 'World' }) // 'Hello, World!'
 * format('Count: {count}', { count: 5 }) // 'Count: 5'
 * ```
 */
export function format(
  template: string, 
  values: Record<string, string | number>
): string {
  return template.replace(
    /\{(\w+)\}/g, 
    (_, key) => String(values[key] ?? `{${key}}`)
  );
}

// =============================================================================
// ЭКСПОРТ СЛОВАРЕЙ (для отладки)
// =============================================================================

export { ru, en };

