/**
 * @file DonateModal.tsx
 * @description Модальное окно с информацией о поддержке проекта
 * 
 * Показывает ссылки на:
 * - Boosty (для СНГ аудитории)
 * - Ko-fi (для международной аудитории)
 * - GitHub (для звёзд и issues)
 * 
 * Ссылки открываются во внешнем браузере (в Electron) или в новой вкладке (в браузере)
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Heart, Coffee, Star, ExternalLink, Sparkles, Gift } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';

// =============================================================================
// КОНСТАНТЫ
// =============================================================================

/**
 * Ссылки на платформы донатов
 * 
 * ВАЖНО: Замените YOUR_USERNAME на ваши реальные username'ы!
 */
const DONATE_LINKS = {
  // Boosty - для СНГ аудитории (рубли, карты РФ)
  boosty: 'https://boosty.to/klimovich_alexandr',
  
  // Ko-fi - для международной аудитории (PayPal, карты)
  kofi: 'https://ko-fi.com/klimovich_alexandr',
  
  // GitHub репозиторий (для звёзд)
  github: 'https://github.com/Alexandrisius/secondbrain',
} as const;

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Props для компонента DonateModal
 */
interface DonateModalProps {
  /** Открыто ли модальное окно */
  isOpen: boolean;
  /** Callback закрытия окна */
  onClose: () => void;
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Открывает ссылку во внешнем браузере (Electron) или в новой вкладке (web)
 * 
 * @param url - URL для открытия
 */
async function openExternalLink(url: string): Promise<void> {
  // Проверяем, запущено ли в Electron
  if (typeof window !== 'undefined' && window.electronAPI) {
    // В Electron используем IPC для открытия в системном браузере
    await window.electronAPI.openExternal(url);
  } else {
    // В браузере открываем в новой вкладке
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// =============================================================================
// КОМПОНЕНТ КНОПКИ ДОНАТА
// =============================================================================

/**
 * Props для кнопки доната
 */
interface DonateButtonProps {
  /** Иконка кнопки */
  icon: React.ReactNode;
  /** Основной текст */
  title: string;
  /** Описание */
  description: string;
  /** URL для открытия */
  href: string;
  /** Цветовая схема */
  colorScheme: 'orange' | 'blue' | 'purple';
}

/**
 * Компонент красивой кнопки доната
 */
const DonateButton: React.FC<DonateButtonProps> = ({
  icon,
  title,
  description,
  href,
  colorScheme,
}) => {
  // Цветовые схемы для разных платформ
  const colors = {
    orange: {
      bg: 'bg-gradient-to-r from-orange-500 to-amber-500',
      hover: 'hover:from-orange-600 hover:to-amber-600',
      shadow: 'shadow-orange-500/25',
      ring: 'focus:ring-orange-500',
    },
    blue: {
      bg: 'bg-gradient-to-r from-sky-500 to-blue-500',
      hover: 'hover:from-sky-600 hover:to-blue-600',
      shadow: 'shadow-blue-500/25',
      ring: 'focus:ring-blue-500',
    },
    purple: {
      bg: 'bg-gradient-to-r from-violet-500 to-purple-500',
      hover: 'hover:from-violet-600 hover:to-purple-600',
      shadow: 'shadow-purple-500/25',
      ring: 'focus:ring-purple-500',
    },
  };

  const scheme = colors[colorScheme];

  return (
    <button
      onClick={() => openExternalLink(href)}
      className={`
        group relative w-full p-4 rounded-xl
        ${scheme.bg} ${scheme.hover}
        text-white text-left
        shadow-lg ${scheme.shadow}
        transform transition-all duration-200
        hover:scale-[1.02] hover:shadow-xl
        focus:outline-none focus:ring-2 ${scheme.ring} focus:ring-offset-2 focus:ring-offset-background
        active:scale-[0.98]
      `}
    >
      {/* Фоновый паттерн */}
      <div className="absolute inset-0 rounded-xl overflow-hidden">
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full blur-xl" />
        <div className="absolute -left-4 -bottom-4 w-20 h-20 bg-white/5 rounded-full blur-lg" />
      </div>
      
      {/* Контент */}
      <div className="relative flex items-center gap-4">
        {/* Иконка */}
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
          {icon}
        </div>
        
        {/* Текст */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-lg flex items-center gap-2">
            {title}
            <ExternalLink className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-sm text-white/80">
            {description}
          </div>
        </div>
      </div>
    </button>
  );
};

// =============================================================================
// ОСНОВНОЙ КОМПОНЕНТ
// =============================================================================

/**
 * Модальное окно поддержки проекта
 * 
 * Показывает красивые кнопки с ссылками на платформы донатов.
 * Ссылки открываются во внешнем браузере для безопасности.
 */
export const DonateModal: React.FC<DonateModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string>('');
  const [isElectron, setIsElectron] = useState(false);

  // Получаем версию приложения и определяем среду запуска
  useEffect(() => {
    const checkEnvironment = async () => {
      if (typeof window !== 'undefined' && window.electronAPI) {
        setIsElectron(true);
        try {
          const version = await window.electronAPI.getAppVersion();
          setAppVersion(version);
        } catch (error) {
          console.error('Failed to get app version:', error);
        }
      }
    };
    
    checkEnvironment();
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        {/* Декоративный фон */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 rounded-lg pointer-events-none" />
        
        {/* Шапка */}
        <DialogHeader className="relative">
          <DialogTitle className="flex items-center justify-center gap-2 text-xl">
            <Heart className="w-6 h-6 text-red-500 animate-pulse" />
            {t.donate.title}
          </DialogTitle>
          <DialogDescription className="text-center">
            {t.donate.description}
          </DialogDescription>
        </DialogHeader>
        
        {/* Основной контент */}
        <div className="relative space-y-4 py-4">
          
          {/* Информационный блок */}
          <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50 border border-border">
            <Sparkles className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              {t.donate.freeNotice}
            </div>
          </div>
          
          {/* Кнопки донатов */}
          <div className="space-y-3">
            
            {/* Boosty - для СНГ */}
            <DonateButton
              icon={<Gift className="w-6 h-6" />}
              title="Boosty"
              description={t.donate.boostyDescription}
              href={DONATE_LINKS.boosty}
              colorScheme="orange"
            />
            
            {/* Ko-fi - для международных */}
            <DonateButton
              icon={<Coffee className="w-6 h-6" />}
              title="Ko-fi"
              description={t.donate.kofiDescription}
              href={DONATE_LINKS.kofi}
              colorScheme="blue"
            />
            
            {/* GitHub Stars */}
            <DonateButton
              icon={<Star className="w-6 h-6" />}
              title="GitHub"
              description={t.donate.githubDescription}
              href={DONATE_LINKS.github}
              colorScheme="purple"
            />
            
          </div>
          
          {/* Благодарность */}
          <div className="text-center text-sm text-muted-foreground pt-2">
            <span className="inline-flex items-center gap-1">
              {t.donate.thanks}
              <Heart className="w-4 h-4 text-red-400 inline" />
            </span>
          </div>
          
        </div>
        
        {/* Футер */}
        <div className="flex items-center justify-between pt-4 border-t">
          {/* Версия (только в Electron) */}
          <div className="text-xs text-muted-foreground">
            {isElectron && appVersion && (
              <span>NeuroCanvas v{appVersion}</span>
            )}
          </div>
          
          {/* Кнопка закрытия */}
          <Button variant="outline" onClick={onClose}>
            {t.common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// =============================================================================
// КОМПОНЕНТ КНОПКИ ОТКРЫТИЯ
// =============================================================================

/**
 * Props для кнопки открытия модального окна донатов
 */
interface DonateButtonTriggerProps {
  /** Callback открытия модального окна */
  onClick: () => void;
}

/**
 * Кнопка для открытия модального окна донатов
 * 
 * Размещается в панели инструментов рядом с настройками.
 * Имеет привлекательный дизайн с пульсирующим сердечком.
 */
export const DonateButtonTrigger: React.FC<DonateButtonTriggerProps> = ({ onClick }) => {
  const { t } = useTranslation();
  
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className="
        flex items-center gap-2 shadow-sm
        border-red-200 dark:border-red-900/50
        hover:bg-red-50 dark:hover:bg-red-950/30
        hover:border-red-300 dark:hover:border-red-800
        transition-colors duration-200
      "
      title={t.donate.supportProject}
    >
      <Heart className="w-4 h-4 text-red-500" />
      <span className="hidden sm:inline">{t.donate.support}</span>
    </Button>
  );
};

export default DonateModal;

