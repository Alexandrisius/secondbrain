import React from 'react';
import { 
  Search, 
  Filter, 
  LayoutGrid, 
  List as ListIcon,
  FolderPlus,
  Trash,
  Link2Off,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

interface ToolbarProps {
  viewMode: 'list' | 'grid';
  onViewModeChange: (mode: 'list' | 'grid') => void;
  onSearch: (query: string) => void;
  onFilterClick: () => void;
  activeFiltersCount?: number;

  onCreateFolder: () => void;
  /**
   * Переместить в корзину ВСЕ "живые" документы без ссылок.
   *
   * Важно:
   * - это НЕ "Очистить корзину" и не удаление навсегда,
   * - это просто уборка "осиротевших" файлов.
   */
  onTrashUnlinked: () => void;
  onEmptyTrash: () => void;
  onRefresh: () => void;
  isReindexing: boolean;
  activeTab: 'files' | 'trash';
  selectedFolderId: string | null;

  /**
   * Количество "живых" документов без ссылок (unlinked).
   *
   * UI использует это значение для числового бейджа на кнопке уборки:
   * пользователь сразу видит, сколько файлов будет перемещено в корзину.
   */
  unlinkedCount: number;
}

export function Toolbar({ 
  viewMode, 
  onViewModeChange,
  onSearch,
  onFilterClick,
  activeFiltersCount = 0,
  onCreateFolder,
  onTrashUnlinked,
  onEmptyTrash,
  onRefresh,
  isReindexing,
  activeTab,
  selectedFolderId,
  unlinkedCount
}: ToolbarProps) {
  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager : en.fileManager;

  return (
    <div className="flex flex-col gap-3 px-3 py-3 border-b border-[#313244]/40 bg-[#181825]/20">
      {/* Search Input */}
      <div className="relative group">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6c7086] group-focus-within:text-[#89b4fa] transition-colors" />
        <input 
          type="text" 
          placeholder={t.searchPlaceholder}
          onChange={(e) => onSearch(e.target.value)}
          className={cn(
            "w-full h-9 pl-9 pr-3 rounded-lg",
            "bg-[#181825]/50 border border-[#313244]/50",
            "text-xs text-[#cdd6f4] placeholder:text-[#6c7086]",
            "focus:outline-none focus:border-[#89b4fa]/50 focus:bg-[#181825]",
            "transition-all duration-200"
          )}
        />
      </div>
      
      {/* Actions Row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Main Action: New Folder or Empty Trash */}
        {activeTab === 'trash' ? (
           <button
             onClick={onEmptyTrash}
             className={cn(
               "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md",
               "text-[10px] font-semibold",
               "bg-[#f38ba8]/10 border border-[#f38ba8]/20 text-[#f38ba8]",
               "hover:bg-[#f38ba8]/20 transition-colors whitespace-nowrap"
             )}
             title={t.emptyTrashTooltip}
           >
             <Trash className="w-3.5 h-3.5" />
             <span>{t.emptyTrash}</span>
           </button>
        ) : (
          <button
            onClick={onCreateFolder}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-md",
              "text-[10px] font-semibold",
              "bg-[#89b4fa]/10 border border-[#89b4fa]/20 text-[#89b4fa]",
              "hover:bg-[#89b4fa]/20 transition-colors whitespace-nowrap"
            )}
            title={selectedFolderId ? `${t.newFolder} (${t.uploadingTo} ${selectedFolderId})` : t.newFolder}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{t.newFolder}</span>
          </button>
        )}

        {/* Secondary Actions: "Unlinked cleanup" & Refresh (Icon-only to save space) */}
        <button
          onClick={onTrashUnlinked}
          className={cn(
            // relative — чтобы можно было аккуратно позиционировать бейдж счётчика
            "relative flex items-center justify-center p-1.5 rounded-md",
            "text-[#cdd6f4] bg-[#313244]/30 border border-[#313244]/30",
            "hover:bg-[#313244]/60 transition-colors"
          )}
          title={t.trashUnlinkedTooltip}
        >
          {/*
            Иконка Link2Off — прямой визуальный сигнал "без ссылок".
            Мы сознательно НЕ используем Trash здесь, чтобы:
            - не путать с "Очистить корзину",
            - и подчеркнуть, что действие связано именно со ссылками.
          */}
          <Link2Off className="w-4 h-4 text-[#fab387]" />

          {/*
            Числовой бейдж:
            - показывает "сколько файлов будет перемещено в корзину",
            - всегда видим (включая 0), но в 0-режиме приглушён.
          */}
          <span
            className={cn(
              "absolute -top-1 -right-1 inline-flex items-center justify-center",
              "min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-none font-semibold",
              unlinkedCount > 0
                ? "bg-[#fab387]/20 text-[#fab387] border border-[#fab387]/30"
                : "bg-[#313244]/40 text-[#6c7086] border border-[#313244]/40"
            )}
            aria-label={t.trashUnlinkedCountAria.replace('{count}', String(unlinkedCount))}
          >
            {unlinkedCount}
          </span>
        </button>

        <button
          onClick={onRefresh}
          className={cn(
            "flex items-center justify-center p-1.5 rounded-md",
            "text-[#cdd6f4] bg-[#313244]/30 border border-[#313244]/30",
            "hover:bg-[#313244]/60 transition-colors",
            isReindexing && "opacity-70 cursor-not-allowed"
          )}
          title={t.refreshTooltip}
        >
          <RefreshCw className={cn("w-4 h-4 text-[#a6e3a1]", isReindexing && "animate-spin")} />
        </button>
      </div>

      {/* Filters & View Mode Row */}
      <div className="flex items-center justify-between">
        {/* 
          ФИЛЬТРЫ В КОРЗИНЕ ОТКЛЮЧЕНЫ (product requirement)
          
          Требование пользователя:
          - на вкладке "Корзина" НЕ показывать кнопку "Фильтр",
          - и НЕ давать ощущение, что там “что-то фильтруется”.
          
          Как это устроено:
          - UI: кнопку скрываем (этот блок рендерится только на вкладке files),
          - Data: в store `load()` при trashed=true игнорирует canvas/ext фильтры и возвращает ВСЕ удалённые файлы.
          
          Важно:
          - мы НЕ “сбрасываем” фильтры в store, чтобы при возврате на вкладку files
            пользователь увидел свою привычную конфигурацию (например, активный холст / ext).
        */}
        {activeTab !== 'trash' ? (
          <button 
            onClick={onFilterClick}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md",
              "text-[10px] font-medium text-[#a6adc8]",
              activeFiltersCount > 0
                ? "bg-[#45475a]/60 border border-[#89b4fa]/30 text-[#cdd6f4]"
                : "bg-[#313244]/30 border border-[#313244]/30",
              "hover:bg-[#313244]/60 hover:text-[#cdd6f4]",
              "transition-colors"
            )}
            title={t.filters}
          >
            <Filter className="w-3 h-3" />
            <span>{t.filters}</span>
            {activeFiltersCount > 0 && (
              <span
                className={cn(
                  "ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full",
                  "text-[10px] leading-none font-semibold",
                  "bg-[#89b4fa]/20 text-[#89b4fa] border border-[#89b4fa]/30"
                )}
              >
                {activeFiltersCount}
              </span>
            )}
          </button>
        ) : (
          // Spacer: сохраняем левую колонку, чтобы переключатели вида справа не “прыгали” по горизонтали.
          <div />
        )}

        <div className="flex items-center bg-[#313244]/30 rounded-lg p-0.5 border border-[#313244]/30">
          <button
            onClick={() => onViewModeChange('list')}
            className={cn(
              "p-1.5 rounded-md transition-all",
              viewMode === 'list' 
                ? "bg-[#45475a] text-[#cdd6f4] shadow-sm" 
                : "text-[#6c7086] hover:text-[#a6adc8]"
            )}
            title={t.viewList}
          >
            <ListIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange('grid')}
            className={cn(
              "p-1.5 rounded-md transition-all",
              viewMode === 'grid' 
                ? "bg-[#45475a] text-[#cdd6f4] shadow-sm" 
                : "text-[#6c7086] hover:text-[#a6adc8]"
            )}
            title={t.viewGrid}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
