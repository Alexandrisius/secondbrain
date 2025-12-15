import React from 'react';
import { 
  Folder, 
  FolderOpen, 
  ChevronRight, 
  ChevronDown,
  MoreVertical
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileNode } from './types';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

interface FolderItemProps {
  folder: FileNode;
  level: number;
  isOpen: boolean;
  isSelected?: boolean;
  onToggle: () => void;
  onSelect: () => void;
  /**
   * Открыть контекстное меню папки (⋮ / ПКМ).
   *
   * Sidebar решает, какие действия показать:
   * - создать подпапку
   * - переименовать
   * - удалить (если пустая)
   */
  onOpenMenu?: (e: React.MouseEvent, folder: FileNode, opts?: { preferLeft?: boolean; preferTop?: boolean }) => void;
}

export function FolderItem({ 
  folder, 
  level, 
  isOpen, 
  isSelected,
  onToggle,
  onSelect,
  onOpenMenu
}: FolderItemProps) {
  // Локализация UI-строк (tooltips).
  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager : en.fileManager;

  return (
    <div 
      className={cn(
        "group flex items-center gap-2 p-1.5 rounded-lg select-none cursor-pointer",
        "transition-colors duration-150",
        isSelected 
          ? "bg-[#313244]/60 text-[#cdd6f4]" 
          : "text-[#a6adc8] hover:bg-[#313244]/30 hover:text-[#cdd6f4]"
      )}
      style={{ paddingLeft: `${level * 12 + 8}px` }}
      onClick={onSelect}
      onContextMenu={(e) => {
        onOpenMenu?.(e, folder, { preferLeft: true });
      }}
    >
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="p-0.5 hover:bg-[#45475a] rounded text-[#6c7086] hover:text-[#cdd6f4] transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>
      
      {isOpen ? (
        <FolderOpen className="w-4 h-4 text-[#89b4fa]" />
      ) : (
        <Folder className="w-4 h-4 text-[#89b4fa]" />
      )}
      
      <span className="text-xs font-medium truncate flex-1">{folder.name}</span>
      
      <button
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#45475a] rounded"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenMenu?.(e, folder, { preferLeft: true });
        }}
        title={t.folderItem.actionsTooltip}
      >
        <MoreVertical className="w-3 h-3" />
      </button>
    </div>
  );
}
