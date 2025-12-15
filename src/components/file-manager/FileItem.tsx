import React from 'react';
import Image from 'next/image';
import { 
  FileText, 
  Image as ImageIcon, 
  File, 
  MoreVertical, 
  Loader2, 
  AlertCircle,
  Link as LinkIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileNode } from './types';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

interface FileItemProps {
  file: FileNode;
  isSelected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  viewMode?: 'list' | 'grid';
  /**
   * Открыть контекстное меню (⋮ / ПКМ).
   *
   * Почему прокидываем callback наверх:
   * - список/дерево управляется FileManagerSidebar,
   * - именно он знает "какая вкладка активна" (files/trash) и какие экшены доступны,
   * - поэтому центральная точка принятия решения по меню — sidebar.
   */
  onOpenMenu?: (e: React.MouseEvent, file: FileNode, opts?: { preferLeft?: boolean; preferTop?: boolean }) => void;
}

export function FileItem({ 
  file, 
  isSelected, 
  onClick, 
  onDoubleClick,
  viewMode = 'list',
  onOpenMenu
}: FileItemProps) {
  // Локализация UI-строк (tooltips/fallback-надписи).
  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager : en.fileManager;

  // ===========================================================================
  // Drag & Drop: "ссылка на документ библиотеки" → в карточку (node.data.attachments)
  // ===========================================================================
  //
  // Концепт:
  // - Мы НЕ переносим файл, мы переносим *ссылку* (docId).
  // - На стороне карточки drop-handler прочитает payload и добавит NodeAttachment,
  //   где attachmentId трактуется как docId (как в плане).
  //
  // Почему мы кладём в payload не только docId, но и метаданные:
  // - При drop карточке полезно сразу сохранить snapshot (mime/size/hash/updatedAt),
  //   чтобы:
  //   - корректно считать context-hash,
  //   - помечать stale при replace,
  //   - показывать пользователю нормальное имя даже без доп. запросов.
  //
  // Важно:
  // - MIME здесь "кастомный" (не стандарт браузера), чтобы не конфликтовать с файлами.
  // - Если payload по какой-то причине не будет распознан — drop handler просто проигнорирует.
  const LIB_DOC_DND_MIME = 'application/x-secondbrain-doc';

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    // На всякий случай: docId для библиотечного файла может храниться как file.docId,
    // но в некоторых местах UI мы используем id=docId. Поэтому делаем fallback.
    const docId = String(file.docId || file.id || '').trim();
    if (!docId) return;

    // Best-effort определяем kind:
    // - если mime начинается с image/ → image
    // - иначе считаем text (на первом этапе мы поддерживаем только images+texts).
    const mime = String(file.mime || '').trim();
    const kind = mime.startsWith('image/') || file.type === 'image' ? 'image' : 'text';

    const payload = {
      docId,
      name: file.name,
      kind,
      mime,
      sizeBytes: typeof file.sizeBytes === 'number' ? file.sizeBytes : undefined,
      fileHash: typeof file.fileHash === 'string' ? file.fileHash : undefined,
      // fileUpdatedAt может прийти явно (из API), либо как updatedAtTs (UI форматтер)
      fileUpdatedAt:
        typeof file.fileUpdatedAt === 'number'
          ? file.fileUpdatedAt
          : typeof file.updatedAtTs === 'number'
            ? file.updatedAtTs
            : undefined,
    };

    e.dataTransfer.setData(LIB_DOC_DND_MIME, JSON.stringify(payload));
    // Fallback для "простого" DnD (например, если кто-то будет пытаться drop в текстовое поле)
    e.dataTransfer.setData('text/plain', docId);
    e.dataTransfer.effectAllowed = 'copy';
  };
  
  const getIcon = () => {
    switch (file.type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-blue-400" />;
      case 'pdf': return <FileText className="w-5 h-5 text-red-400" />;
      case 'doc': return <FileText className="w-5 h-5 text-blue-300" />;
      default: return <File className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusIndicator = () => {
    /**
     * Мы поддерживаем “несколько индикаторов” одновременно:
     * - статус анализа/загрузки (processing/stale/error),
     * - + индикатор “используется на холстах” (link).
     *
     * Это важно, потому что:
     * - документ может быть “ready” по анализу, но при этом использоваться (link),
     * - или “stale” (нужен анализ) и одновременно использоваться (link),
     * - и пользователю полезно видеть обе вещи.
     */
    const icons: React.ReactNode[] = [];

    // -------------------------------------------------------------------------
    // 1) Primary status icon (upload/analyze lifecycle)
    // -------------------------------------------------------------------------
    if (file.status === 'uploading' || file.status === 'processing') {
      icons.push(
        <span key="status" title={file.statusHint || t.fileItem.processingFallback} className="inline-flex">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
        </span>
      );
    } else if (file.status === 'stale') {
      icons.push(
        <span key="status" title={file.statusHint || t.fileItem.staleFallback} className="inline-flex">
          <AlertCircle className="w-3 h-3 text-yellow-400" />
        </span>
      );
    } else if (file.status === 'error') {
      icons.push(
        <span key="status" title={file.statusHint || t.fileItem.errorFallback} className="inline-flex">
          <AlertCircle className="w-3 h-3 text-red-400" />
        </span>
      );
    }

    // -------------------------------------------------------------------------
    // 2) Secondary icon: document is referenced from canvases
    // -------------------------------------------------------------------------
    if (file.canvasLinks && file.canvasLinks.length > 0) {
      icons.push(
        <span
          key="link"
          title={t.fileItem.usedInCanvasesTooltip.replace('{count}', String(file.canvasLinks.length))}
          className="inline-flex"
        >
          <LinkIcon className="w-3 h-3 text-green-400" />
        </span>
      );
    }

    if (icons.length === 0) return null;
    return <span className="inline-flex items-center gap-1">{icons}</span>;
  };

  if (viewMode === 'grid') {
    return (
      <div 
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          // ПКМ по элементу файла открывает контекстное меню.
          // Важно: e.preventDefault() делаем в обработчике меню (в родителе),
          // чтобы не дублировать логику здесь.
          onOpenMenu?.(e, file, { preferLeft: true });
        }}
        draggable
        onDragStart={handleDragStart}
        className={cn(
          "group relative flex flex-col items-center gap-2 p-3 rounded-xl",
          "border transition-all duration-200 cursor-pointer",
          "hover:bg-[#313244]/40 hover:border-[#45475a]",
          isSelected 
            ? "bg-[#313244]/60 border-[#89b4fa]/50 shadow-[0_0_0_1px_rgba(137,180,250,0.5)]" 
            : "bg-[#1e1e2e]/50 border-transparent"
        )}
      >
        <div className="relative w-full aspect-square bg-[#181825] rounded-lg flex items-center justify-center overflow-hidden">
          {file.previewUrl ? (
            <Image
              // ВАЖНО:
              // - Это локальный файл, который отдаётся нашим API `/api/library/file/[docId]`.
              // - Next Image по умолчанию пытается оптимизировать изображения через loader,
              //   что в локальном/offline контексте не даёт выигрыша и иногда вызывает проблемы
              //   с конфигом доменов/loader'ов.
              // - Поэтому для “внутренних” превью используем `unoptimized`.
              src={file.previewUrl}
              alt={file.name}
              fill
              unoptimized
              // sizes нужен для корректного выбора плотности/размеров (даже при unoptimized)
              // и чтобы убрать предупреждения Next о “missing sizes” в future.
              sizes="(max-width: 768px) 50vw, 200px"
              className="object-cover opacity-80 group-hover:opacity-100 transition-opacity"
            />
          ) : (
            getIcon()
          )}
          
          {/* Status Badge */}
          <div className="absolute top-1 right-1">
            {getStatusIndicator()}
          </div>
        </div>

        <div className="w-full text-center">
          <p className="text-xs text-[#cdd6f4] truncate px-1 font-medium">{file.name}</p>
          <p className="text-[10px] text-[#6c7086] mt-0.5">{file.size}</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        onOpenMenu?.(e, file, { preferLeft: true });
      }}
      draggable
      onDragStart={handleDragStart}
      className={cn(
        "group flex items-center gap-3 p-2 rounded-lg",
        "border border-transparent transition-all duration-200 cursor-pointer",
        "hover:bg-[#313244]/40",
        isSelected && "bg-[#313244]/60 border-[#313244]"
      )}
    >
      <div className="flex-shrink-0 w-8 h-8 bg-[#181825] rounded-md flex items-center justify-center">
        {getIcon()}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn(
            "text-sm truncate font-medium",
            isSelected ? "text-[#89b4fa]" : "text-[#cdd6f4]"
          )}>
            {file.name}
          </p>
          {getStatusIndicator()}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#6c7086]">
          <span>{file.size}</span>
          <span>•</span>
          <span>{file.updatedAt}</span>
        </div>
      </div>

      <button
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#45475a] rounded transition-all"
        onClick={(e) => {
          // Меню-кнопка не должна триггерить выбор элемента повторно.
          e.preventDefault();
          e.stopPropagation();
          onOpenMenu?.(e, file, { preferLeft: true });
        }}
        title={t.fileItem.actionsTooltip}
      >
        <MoreVertical className="w-4 h-4 text-[#a6adc8]" />
      </button>
    </div>
  );
}
