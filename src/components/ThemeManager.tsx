'use client';

import { useEffect } from 'react';
import { useSettingsStore, selectTheme } from '@/store/useSettingsStore';

/**
 * Компонент для управления темой приложения (Dark/Light/System).
 *
 * Работает в связке с blocking script в layout.tsx для предотвращения мерцания.
 * Отслеживает изменения в store и обновляет класс .dark на html элементе.
 */
export function ThemeManager() {
  const theme = useSettingsStore(selectTheme);

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (isDark: boolean) => {
      // Важно: мы добавляем/удаляем класс 'dark', который используется Tailwind
      if (isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    if (theme === 'system') {
      // Логика для системной темы
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      // Применяем текущее состояние системы
      applyTheme(mediaQuery.matches);

      // Подписываемся на изменения системной темы
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handler);
      
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      // Явный выбор пользователя
      applyTheme(theme === 'dark');
    }
  }, [theme]);

  // Компонент не рендерит ничего в DOM
  return null;
}
