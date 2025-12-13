import React from 'react';
import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NeuroSearchButtonProps {
  isEnabled: boolean;
  onToggle: () => void;
  resultCount?: number;
  isDeepThink?: boolean;
  isStale?: boolean; // Добавляем проп
  hasExcluded?: boolean; // Есть ли скрытые карточки
}

export const NeuroSearchButton: React.FC<NeuroSearchButtonProps> = ({
  isEnabled,
  onToggle,
  resultCount = 0,
  isDeepThink = false,
  isStale = false, // Значение по умолчанию
  hasExcluded = false,
}) => {
  return (
    <button
      onClick={onToggle}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        'relative flex-shrink-0 mb-2 mr-2',
        'w-8 h-8 rounded-md',
        'flex items-center justify-center',
        'transition-all duration-200',
        'nodrag group',
        isEnabled 
          ? [
              // Если stale - оранжевый, иначе - primary
              isStale 
                ? 'bg-orange-100 text-orange-600 hover:bg-orange-200 dark:bg-orange-950/30 dark:text-orange-400'
                : 'bg-primary/10 text-primary hover:bg-primary/20',
              'shadow-sm'
            ] 
          : [
              'text-muted-foreground/60',
              'hover:text-primary hover:bg-muted/50',
            ],
        isDeepThink && isEnabled && !isStale && 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30'
      )}
      title={isStale ? "Данные устарели. Нажмите для обновления." : (isEnabled ? "Disable NeuroSearch" : "Enable NeuroSearch")}
    >
      <Brain className={cn(
        "w-5 h-5 transition-transform duration-300",
        isEnabled && "scale-110",
        // Пульсация только при активном поиске (isDeepThink)
        isDeepThink && "animate-pulse"
      )} />
      
      {/* Индикатор количества найденных карточек */}
      {isEnabled && resultCount > 0 && (
        <span className={cn(
          "absolute -top-1.5 -right-1.5",
          "flex items-center justify-center",
          "min-w-[16px] h-[16px] px-1",
          "text-[10px] font-bold leading-none text-white",
          "bg-primary rounded-full shadow-sm border border-background",
          "animate-in zoom-in duration-200",
          isDeepThink && !isStale && "bg-indigo-500",
          isStale && "bg-orange-500" // Оранжевый бейдж если stale
        )}>
          {resultCount > 99 ? '99+' : resultCount}
        </span>
      )}
      
      {/* Индикатор DeepThink (маленькая точка, если нужно отличить режим) */}
      {isDeepThink && (
        <span className="absolute bottom-1 right-1 w-1 h-1 rounded-full bg-indigo-500" />
      )}

      {/* Индикатор наличия скрытых карточек (оранжевая точка снизу справа) */}
      {!isDeepThink && hasExcluded && (
        <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-orange-500 ring-1 ring-background" />
      )}
    </button>
  );
};
