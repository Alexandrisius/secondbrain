/**
 * @file ContextViewerModal.tsx
 * @description Модальное окно для просмотра полного контекста карточки
 * 
 * Функционал:
 * - Показывает иерархию контекста (родители → дедушки → прадедушки)
 * - Для каждого предка отображает: вопрос, тип контекста, содержимое
 * - Динамически склеивает контекст в момент открытия окна (не хранит)
 * - Отображает контент в формате Markdown
 * 
 * Типы контекста (определяются автоматически):
 * - full (полный) - для прямых родителей без цитаты
 * - quote (цитата) - если у карточки есть поле quote
 * - summary (суммаризация) - для дедушек и далее
 */

'use client';

import React, { useMemo } from 'react';
// ВАЖНО (Next.js):
// - ESLint правило @next/next/no-img-element рекомендует использовать next/image вместо <img>.
// - Это позволяет Next контролировать загрузку/размеры и (опционально) оптимизацию.
// - Для наших "локальных" вложений (через /api/attachments/...) мы включаем unoptimized,
//   чтобы не менять текущую семантику доставки файла и не завязываться на image-optimizer.
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText,
  Quote,
  FileSignature,
  ChevronRight,
  MessageSquare,
  Sparkles,
  Minimize2,
  Maximize2,
  Brain,
  AlertCircle,
  Paperclip,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useSettingsStore, selectUseSummarization } from '@/store/useSettingsStore';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useTranslation, format } from '@/lib/i18n';
import type { NeuroNode, ContextType, ContextBlock, NodeAttachment, NeuroNodeData } from '@/types/canvas';
import { useWorkspaceStore } from '@/store/useWorkspaceStore';

// Re-export типов для обратной совместимости
export type { ContextType, ContextBlock } from '@/types/canvas';

/**
 * Props компонента ContextViewerModal
 */
interface ContextViewerModalProps {
  /** Флаг открытости модального окна */
  isOpen: boolean;
  /** Callback для закрытия окна */
  onClose: () => void;
  /**
   * ID текущей ноды, для которой открыта модалка контекста.
   *
   * Зачем нужно:
   * - мы хотим показывать "вложения как контекст" (и уметь их выключать),
   *   а вложения принадлежат текущей карточке.
   * - это также даёт нам доступ к node.data.attachmentExcerpts/attachmentSummaries
   *   без необходимости передавать их отдельными пропами.
   */
  currentNodeId: string;
  /** Массив прямых родительских нод */
  directParents: NeuroNode[];
  /** Полная цепочка предков (включая прямых родителей, дедушек и т.д.) */
  ancestorChain: NeuroNode[];
  /** Цитата текущей карточки (если есть) */
  quote: string | null;
  /** ID ноды-источника цитаты */
  quoteSourceNodeId: string | null;
}

/**
 * Расширенный тип блока контекста для UI
 */
interface UiContextBlock extends ContextBlock {
  /**
   * Уникальный ключ для React (не всегда совпадает с nodeId).
   *
   * Почему не используем nodeId как key:
   * - для вложений `nodeId` = attachmentId, и он уникален в рамках холста,
   *   но мы также хотим иметь возможность:
   *   - отличать "ноды" от "вложений" на уровне UI,
   *   - безопасно расширять структуру без риска коллизий.
   */
  key: string;

  /**
   * Что именно мы показываем в этом блоке:
   * - 'node'       → обычная карточка-предок (как раньше)
   * - 'attachment' → вложение (файл), которое участвует в контексте как "предок"
   */
  blockKind: 'node' | 'attachment';

  /** Метаданные вложения (только если blockKind === 'attachment'). */
  attachment?: NodeAttachment;

  /**
   * ID ноды-владельца вложения (к какой карточке прикреплён файл).
   *
   * Нужен:
   * - для отладки,
   * - для объяснения пользователю "откуда" взялся документ в контексте.
   */
  attachmentOwnerNodeId?: string;

  quoteContent?: string;
  /** Тип ноды: 'neuro' (AI-карточка) или 'note' (личная заметка) */
  nodeType?: 'neuro' | 'note';
  /**
   * Семантика отображаемого контента (`content`) в UI.
   *
   * Зачем это нужно:
   * - `type: 'quote'` говорит только о том, что "в этом блоке есть цитата",
   *   но НЕ говорит, что именно мы показываем ниже как "контекст источника цитаты":
   *   это может быть как полный `response`, так и `summary` (если включена суммаризация).
   * - Ранее лейбл для `quote` на уровне 0 всегда показывался как "Ответ:",
   *   из-за чего пользователю казалось, что отображается полный ответ родителя,
   *   хотя фактически мы часто показывали суммаризацию источника цитаты.
   *
   * Поэтому мы явно помечаем, что сейчас в `content`:
   * - 'full'    → полный ответ (или иной полный текст без сокращения)
   * - 'summary' → суммаризация (или принудительно укороченный текст в режиме суммаризации)
   *
   * Важно:
   * - Это поле влияет ТОЛЬКО на UI-лейбл ("Ответ:" vs "Суммаризация:").
   * - Оно НЕ меняет саму логику выбора контента и НЕ влияет на контекст, который уходит в LLM.
   */
  contentKind?: 'full' | 'summary';
  /** Процент схожести для NeuroSearch (0-100) */
  similarityPercent?: number;
  /** Флаг устаревания результатов поиска */
  isStale?: boolean;
}


// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ И ФУНКЦИИ
// =============================================================================

/**
 * Иконка для типа контекста
 */
const ContextTypeIcon: React.FC<{ type: ContextType; className?: string }> = ({
  type,
  className,
}) => {
  switch (type) {
    case 'full':
      return <FileText className={cn('w-4 h-4', className)} />;
    case 'quote':
      return <Quote className={cn('w-4 h-4', className)} />;
    case 'summary':
      return <FileSignature className={cn('w-4 h-4', className)} />;
    case 'neuro-search':
      return <Brain className={cn('w-4 h-4', className)} />;
  }
};

/**
 * Цвет для типа контекста
 */
const getContextTypeColor = (type: ContextType): string => {
  switch (type) {
    case 'full':
      return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30';
    case 'quote':
      return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30';
    case 'summary':
      return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30';
    case 'neuro-search':
      return 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30';
  }
};

// =============================================================================
// КОМПОНЕНТ
// =============================================================================

/**
 * ContextViewerModal - модальное окно для просмотра контекста
 * 
 * Отображает иерархию контекста карточки:
 * - Прямые родители с полным response или цитатой
 * - Дедушки и далее с суммаризацией
 */
export const ContextViewerModal: React.FC<ContextViewerModalProps & {
  excludedContextNodeIds?: string[];
  onToggleContextItem?: (nodeId: string) => void;
  /** Список attachmentId, которые пользователь выключил из контекста этой карточки */
  excludedAttachmentIds?: string[];
  /** Переключить включённость конкретного attachmentId в контексте */
  onToggleAttachmentItem?: (attachmentId: string) => void;
  neuroSearchResults?: import('@/types/embeddings').SearchResult[]; // Добавляем проп
}> = ({
  isOpen,
  onClose,
  currentNodeId,
  directParents,
  ancestorChain,
  quote,
  quoteSourceNodeId,
  excludedContextNodeIds = [],
  onToggleContextItem,
  excludedAttachmentIds = [],
  onToggleAttachmentItem,
  neuroSearchResults = [], // Значение по умолчанию
}) => {
    // ===========================================================================
    // REFS ДЛЯ СКРОЛЛА
    // ===========================================================================
    /**
     * ref на DOM-элемент контейнера модалки (Radix DialogContent).
     *
     * Почему нужен ref:
     * - нам нужно повесить "настоящий" нативный wheel-listener с `{ passive: false }`,
     *   чтобы `preventDefault()` гарантированно работал.
     * - В React/Synthetic events wheel может быть пассивным (в зависимости от версии/настроек),
     *   и тогда `preventDefault()` либо не сработает, либо вызовет warning.
     */
    const dialogContentRef = React.useRef<HTMLDivElement | null>(null);

    /**
     * ref на ВНЕШНИЙ (главный) scroll-контейнер контекстного окна.
     *
     * Это тот список карточек/предков, который должен прокручиваться
     * колёсиком мыши "почти везде" внутри модалки (за исключением внутреннего скролла карточки).
     */
    const outerScrollRef = React.useRef<HTMLDivElement | null>(null);

    // ===========================================================================
    // STATE
    // ===========================================================================

    // Состояние свернутых блоков.
    //
    // Важно:
    // - Мы храним НЕ nodeId, а `UiContextBlock.key`.
    // - Потому что теперь блоки бывают двух типов:
    //   - node (nodeId = id ноды)
    //   - attachment (nodeId = attachmentId)
    // - `key` гарантирует уникальность и не смешивает домены ID.
    const [collapsedBlockIds, setCollapsedBlockIds] = React.useState<Set<string>>(new Set());

    // ===========================================================================
    // UX: ЕДИНЫЙ СКРОЛЛ КОЛЁСИКОМ ДЛЯ "ВНЕШНЕГО" КОНТЕНТ-ОКНА
    // ===========================================================================
    /**
     * Проблема (как описано в задаче):
     * - В модалке есть ДВА вертикальных скролла:
     *   1) внешний: список блоков контекста/карточек
     *   2) внутренний: прокрутка длинного Markdown-контента внутри конкретной карточки
     * - Сейчас внешний скролл можно крутить колёсиком только когда курсор стоит строго
     *   над его scroll-областью (она получается узкой), и это неудобно.
     *
     * Решение:
     * - Перехватываем wheel-событие на контейнере модалки (capture-фаза),
     *   и если курсор НЕ находится внутри "внутреннего скролла карточки",
     *   то принудительно прокручиваем внешний контейнер.
     * - Если курсор над внутренним скроллом карточки — ничего не перехватываем,
     *   чтобы внутренняя прокрутка работала как обычно.
     *
     * Важно:
     * - Используем нативный addEventListener с `{ passive: false }`, иначе preventDefault может не сработать.
     * - Не перехватываем Ctrl+Wheel (чтобы не ломать zoom в браузере).
     */
    React.useEffect(() => {
      // Обработчик нужен только когда модалка открыта.
      // ВАЖНО: перехватываем wheel на уровне document, а не DialogContent:
      // - wheel над overlay (затемнённый фон) НЕ попадает в DialogContent
      // - из-за этого пользователь не видел разницы в поведении
      // - на document мы гарантированно поймаем wheel в любых точках экрана,
      //   пока модалка открыта.
      if (!isOpen) return;

      const handleWheel = (event: WheelEvent) => {
        // Ctrl+Wheel обычно отвечает за zoom страницы/браузера — не ломаем этот кейс.
        if (event.ctrlKey) return;

        const target = event.target as HTMLElement | null;

        // Если колесо крутят НАД внутренним скроллом контента карточки —
        // не вмешиваемся, чтобы скроллился именно контент карточки.
        //
        // Маркер `data-context-card-inner-scroll="true"` мы ставим на нужный div ниже по коду.
        const isInsideCardInnerScroll = Boolean(
          target?.closest?.('[data-context-card-inner-scroll="true"]')
        );
        if (isInsideCardInnerScroll) return;

        const outerEl = outerScrollRef.current;
        if (!outerEl) return;

        // Мы действительно хотим "забрать" колесо себе:
        // - чтобы скролл не утекал на страницу/фон
        // - чтобы скролл работал при наведении на overlay (затемнённый фон)
        // - чтобы скролл работал в любых точках внутри модалки (header, отступы, боковые зоны и т.д.)
        event.preventDefault();

        // Нормализуем delta для разных режимов:
        // - deltaMode === 0: пиксели (обычно так и есть)
        // - deltaMode === 1: строки (редко, но бывает) → переводим в пиксели
        // - deltaMode === 2: страницы → используем высоту контейнера
        let deltaY = event.deltaY;
        if (event.deltaMode === 1) deltaY = deltaY * 16; // ~16px на строку (эвристика)
        if (event.deltaMode === 2) deltaY = deltaY * outerEl.clientHeight; // "страница" = высота области

        outerEl.scrollBy({ top: deltaY, left: 0 });
      };

      // capture + passive:false — ключевой момент, чтобы preventDefault работал стабильно.
      // Мы ставим listener на document, чтобы ловить wheel даже над overlay.
      document.addEventListener('wheel', handleWheel, { capture: true, passive: false });

      return () => {
        // Для removeEventListener важно совпадение capture-режима.
        document.removeEventListener('wheel', handleWheel, true);
      };
    }, [isOpen]);

    // Сброс состояния при открытии/закрытии
    React.useEffect(() => {
      if (!isOpen) {
        setCollapsedBlockIds(new Set());
      }
    }, [isOpen]);

    const toggleCollapse = (blockKey: string) => {
      setCollapsedBlockIds(prev => {
        const next = new Set(prev);
        if (next.has(blockKey)) {
          next.delete(blockKey);
        } else {
          next.add(blockKey);
        }
        return next;
      });
    };

    /**
     * Свернуть всё
     */
    const handleCollapseAll = () => {
      const allIds = new Set(contextBlocks.map(b => b.key));
      setCollapsedBlockIds(allIds);
    };

    /**
     * Развернуть всё
     */
    const handleExpandAll = () => {
      setCollapsedBlockIds(new Set());
    };

    // ===========================================================================
    // ЛОКАЛИЗАЦИЯ
    // ===========================================================================

    const { t } = useTranslation();

    // ===========================================================================
    // CANVAS STATE (для доступа к нодам по ID)
    // ===========================================================================
    
    // Получаем все ноды для поиска виртуальных дедушек по neuroSearchNodeIds
    const nodes = useCanvasStore(state => state.nodes);
    // Экшены, которые нужны для "прикрепить как ссылку"
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);

    /**
     * Активный холст (canvasId) нужен, чтобы строить URL выдачи вложений:
     * /api/attachments/<canvasId>/<attachmentId>
     */
    const activeCanvasId = useWorkspaceStore((s) => s.activeCanvasId);

    // ===========================================================================
    // NEURO SEARCH STATE (ZUSTAND)
    // ===========================================================================
    
    // ===========================================================================
    // НАСТРОЙКИ
    // ===========================================================================

    /**
     * Флаг суммаризации из глобальных настроек
     * Когда false - для всех предков показываем полный response
     */
    const useSummarization = useSettingsStore(selectUseSummarization);

    // ===========================================================================
    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ С ЛОКАЛИЗАЦИЕЙ
    // ===========================================================================

    /**
     * Получить название уровня предка по индексу
     * 
     * Используем компактный формат:
     * - Уровень 0: "Родитель" (или "Родитель N" если несколько)
     * - Уровень 1+: "Предок [1]", "Предок [2]", и т.д.
     * 
     * @param level - Индекс уровня (0 = родитель, 1 = дедушка, и т.д.)
     * @param parentIndex - Индекс родителя (для карточек с несколькими родителями)
     * @param totalParents - Общее количество прямых родителей
     * @returns Локализованное название уровня
     */
    const getLevelName = (
      level: number,
      parentIndex: number = 0,
      totalParents: number = 1
    ): string => {
      // Для прямых родителей (level 0)
      if (level === 0) {
        if (totalParents > 1) {
          return format(t.contextModal.parentN, { n: parentIndex + 1 });
        }
        return t.contextModal.parent;
      }

      // Для более дальних предков — компактный формат с номером поколения
      return format(t.contextModal.ancestor, { n: level });
    };

    /**
     * Название типа контекста
     */
    const getContextTypeName = (type: ContextType): string => {
      switch (type) {
        case 'full':
          return t.contextModal.fullResponse;
        case 'quote':
          return t.contextModal.quote;
        case 'summary':
          return t.contextModal.summary;
        case 'neuro-search':
          return 'NeuroSearch';
      }
    };

    // ===========================================================================
    // ПОСТРОЕНИЕ БЛОКОВ КОНТЕКСТА
    // ===========================================================================

    /**
     * Динамически строим массив блоков контекста
     * Выполняется в момент открытия окна (не хранится)
     */
    const contextBlocks = useMemo((): UiContextBlock[] => {
      const blocks: UiContextBlock[] = [];

      // =========================================================================
      // ЧАСТЬ 0: NEURO SEARCH РЕЗУЛЬТАТЫ (САМЫЙ ВЕРХ)
      // =========================================================================
      
      if (neuroSearchResults && neuroSearchResults.length > 0) {
        neuroSearchResults.forEach((result) => {
          // Проверяем stale статус (очень упрощенно: если есть результат, но он старый)
          // В идеале нужно сравнивать updatedAt эмбеддинга с updatedAt ноды
          // Но пока просто помечаем, если результаты поиска старее 1 часа (пример)
          // Или если сама нода-источник была обновлена позже
          
          // Для демо используем заглушку isStale=false, но логика готова
          const isStale = false; 

          blocks.push({
            key: `node:neuro-search:${result.nodeId}`,
            blockKind: 'node',
            nodeId: result.nodeId,
            prompt: result.prompt || 'Без вопроса',
            type: 'neuro-search',
            content: result.responsePreview || '', // Теперь здесь ПОЛНЫЙ текст
            // Важно: responsePreview хранит полный текст, поэтому это "full",
            // даже если глобально включена суммаризация.
            contentKind: 'full',
            level: -1, 
            levelName: t.contextModal.neuroSearchSimilar,
            nodeType: 'neuro',
            similarityPercent: result.similarityPercent,
            isStale
          });
        });
      }

      // =========================================================================
      // ЧАСТЬ 0.5: ВЛОЖЕНИЯ (ATTACHMENTS) КАК КОНТЕКСТ
      // =========================================================================
      //
      // Требование:
      // - "контекст каждого вложения должен быть отдельным блоком" с возможностью отключения
      // - "вложения ведут себя как предки":
      //   - у прямого потомка — полный документ (server inline по attachmentId)
      //   - у дальних потомков — суммаризация/суть документа
      //
      // В этой модалке мы показываем:
      // - вложения текущей карточки
      // - вложения прямых родителей
      // - вложения более дальних предков
      //
      // ВАЖНО:
      // - Мы НЕ грузим полный текст файла здесь по умолчанию, чтобы:
      //   1) не тратить время/трафик
      //   2) не дублировать функционал превью
      // - Для текста показываем summary/excerpt, если они сохранены в node.data.
      const normalizeStringMap = (v: unknown): Record<string, string> => {
        if (!v || typeof v !== 'object') return {};
        const obj = v as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const [k, val] of Object.entries(obj)) {
          if (typeof val === 'string') out[k] = val;
        }
        return out;
      };

      /**
       * Нормализация “описания изображения” для отображения/контекста.
       *
       * Новая семантика:
       * - node.data.attachmentImageDescriptions[attachmentId] содержит УЖЕ описание (caption-only),
       *   без OCR и без маркеров.
       *
       * Backward-compat:
       * - в старых данных там мог быть combined "OCR: ... Описание: ...".
       * - мы безопасно вырезаем часть после "Описание:"/"DESCRIPTION:".
       *
       * Важно:
       * - даже для владельца мы НЕ хотим показывать OCR/вербатим-текст:
       *   пользователь попросил уйти от OCR и не протаскивать текст (особенно код).
       * - превью изображения и просмотр файла решаются отдельным UI (attachments preview).
       */
      const normalizeImageDescription = (storedText: string): string => {
        const raw = (storedText || '').trim();
        if (!raw) return '';

        const descMarkerRu = /(^|\n)Описание:\s*/i;
        const descIdxRu = raw.search(descMarkerRu);
        if (descIdxRu !== -1) return raw.slice(descIdxRu).replace(descMarkerRu, '').trim();

        const descMarkerEn = /(^|\n)DESCRIPTION:\s*/i;
        const descIdxEn = raw.search(descMarkerEn);
        if (descIdxEn !== -1) return raw.slice(descIdxEn).replace(descMarkerEn, '').trim();

        const hasOcrMarker = /(^|\n)\s*OCR(_TEXT)?:\s*/i.test(raw);
        if (hasOcrMarker) return '';

        return raw;
      };

      const getAttachmentText = (
        owner: NeuroNode,
        attachmentId: string,
        preferSummary: boolean
      ): { text: string; kind: 'full' | 'summary' } => {
        const summaries = normalizeStringMap(owner.data.attachmentSummaries);
        const excerpts = normalizeStringMap(owner.data.attachmentExcerpts);
        const imageDescriptions = normalizeStringMap(owner.data.attachmentImageDescriptions);

        const summary = (summaries[attachmentId] || '').trim();
        const excerpt = (excerpts[attachmentId] || '').trim();
        const imageDesc = (imageDescriptions[attachmentId] || '').trim();

        // Изображения: для контекста используем только description (caption-only).
        if (imageDesc) {
          // И для “владельца”, и для “потомков” показываем один и тот же безопасный текст:
          // - новая версия: уже description
          // - старая версия: вырезаем “Описание:” часть из combined (best-effort)
          const textForThisBlock = normalizeImageDescription(imageDesc);
          // Если описания нет — показываем понятный placeholder.
          const safeText = textForThisBlock.trim() || '(нет описания)';
          return { text: safeText, kind: preferSummary ? 'summary' : 'full' };
        }

        // Если мы "предпочитаем summary" (для дальних предков) — сначала summary, потом excerpt.
        if (preferSummary) {
          if (summary) return { text: summary, kind: 'summary' };
          if (excerpt) return { text: excerpt, kind: 'summary' }; // это всё равно "суть", даже если это начало документа
          return { text: '', kind: 'summary' };
        }

        // Для уровня 0 (текущая/родитель) мы считаем, что документ будет подмешан как "full",
        // но для UI показываем excerpt/summary как быстрый preview.
        if (excerpt) return { text: excerpt, kind: 'full' };
        if (summary) return { text: summary, kind: 'full' };
        return { text: '', kind: 'full' };
      };

      const pushAttachmentBlocks = (
        owner: NeuroNode,
        level: number,
        levelName: string,
        preferSummary: boolean
      ) => {
        const atts = Array.isArray(owner.data.attachments)
          ? (owner.data.attachments as NodeAttachment[])
          : [];
        if (atts.length === 0) return;

        atts.forEach((att) => {
          if (!att || typeof att.attachmentId !== 'string') return;

          // Тип блока по смыслу:
          // - для дальних предков (preferSummary=true) показываем как summary
          // - иначе как full
          const type: ContextType = preferSummary ? 'summary' : 'full';

          // Важно:
          // - и для text, и для image мы возвращаем "текстовую суть" (summary/описание изображения),
          //   чтобы потомки не тащили полный документ/картинку в контекст.
          const { text, kind } = getAttachmentText(owner, att.attachmentId, preferSummary);

          blocks.push({
            // ВАЖНО:
            // - attachmentId теперь может встречаться в нескольких карточках (это "ссылки" на один файл).
            // - значит key обязан включать owner.id, иначе React будет коллапсить элементы.
            key: `att:${owner.id}:${att.attachmentId}:${level}`,
            blockKind: 'attachment',
            attachment: att,
            attachmentOwnerNodeId: owner.id,
            nodeId: att.attachmentId, // для toggles используем attachmentId
            prompt: att.originalName || att.attachmentId,
            type,
            content: text,
            contentKind: kind,
            level,
            levelName,
            nodeType: owner.type as 'neuro' | 'note',
          });
        });
      };

      // 0.5.1 Вложения ТЕКУЩЕЙ карточки (самый важный "локальный" контекст)
      const currentNode = nodes.find((n) => n.id === currentNodeId);
      if (currentNode) {
        pushAttachmentBlocks(
          currentNode,
          0,
          // Здесь мы используем levelName как "категорию", а не как родство,
          // потому что это вложения самой текущей карточки.
          t.contextModal.attachmentsThisCard,
          false
        );
      }

      // 0.5.2 Вложения ПРЯМЫХ родителей (для ребёнка это "контекст предка уровня 1")
      directParents.forEach((parent, parentIndex) => {
        if (!parent) return;
        if (excludedContextNodeIds.includes(parent.id)) return;
        const label = directParents.length > 1
          ? format(t.contextModal.attachmentsParentN, { n: parentIndex + 1 })
          : t.contextModal.attachmentsParent;
        // КЛЮЧЕВОЕ ПРОДУКТОВОЕ ПРАВИЛО:
        // - прямой ребёнок НЕ должен получать полный документ/картинку родителя;
        // - показываем и передаём только "суть":
        //   - текст: summary/excerpt
        //   - изображение: только описание (без OCR)
        pushAttachmentBlocks(parent, 0, label, true);
      });

      // =========================================================================
      // ЧАСТЬ 1: ПРЯМЫЕ РОДИТЕЛИ
      // =========================================================================

      directParents.forEach((parent, index) => {
        if (!parent) return;

        // Определяем тип контекста для этого родителя
        let type: ContextType = 'full';
        let content = parent.data.response || '';
        let quoteContent: string | undefined;
        /**
         * Семантика контента для UI (лейбл над `content`).
         *
         * По умолчанию — "full", потому что `content` берётся из `response`.
         * Ниже (в ветке с цитатой) мы можем заменить контент на `summary`,
         * и тогда лейбл должен быть "Суммаризация:", а не "Ответ:".
         */
        let contentKind: 'full' | 'summary' = 'full';

        // Если есть цитата и источник совпадает с этим родителем
        if (quote && quoteSourceNodeId === parent.id) {
          type = 'quote';
          // Сохраняем цитату отдельно для чистого отображения
          quoteContent = quote;

          // Определяем контент контекста (summary или full)
          if (useSummarization && parent.data.summary) {
            content = parent.data.summary;
            // В режиме суммаризации, если есть `summary`, отображаем именно суммаризацию.
            contentKind = 'summary';
          } else if (parent.data.response) {
            content = parent.data.response;
            // Summary нет (или суммаризация выключена) → показываем полный ответ.
            contentKind = 'full';
          } else {
            content = '';
          }
        }

        // Пропускаем если нет контента и нет цитаты
        if (!content && !quoteContent && !parent.data.prompt) return;

        blocks.push({
          key: `node:parent:${parent.id}`,
          blockKind: 'node',
          nodeId: parent.id,
          prompt: parent.data.prompt || '',
          type,
          content,
          quoteContent,
          contentKind,
          level: 0,
          levelName: getLevelName(0, index, directParents.length),
          // Сохраняем тип ноды для различения AI-карточек и личных заметок
          nodeType: parent.type as 'neuro' | 'note',
        });
      });

      // =========================================================================
      // ЧАСТЬ 1.5: ВИРТУАЛЬНЫЕ ДЕДУШКИ (NeuroSearch от прямых родителей)
      // 
      // Если у прямого родителя есть neuroSearchNodeIds - это виртуальные
      // дедушки текущей карточки. Показываем их с суммаризацией.
      // =========================================================================
      
      directParents.forEach((parent, parentIndex) => {
        if (!parent?.data.neuroSearchNodeIds?.length) return;

        parent.data.neuroSearchNodeIds.forEach((nsNodeId, nsIndex) => {
          // Пропускаем исключённые
          if (excludedContextNodeIds.includes(nsNodeId)) return;
          
          // Находим карточку по ID
          const nsNode = nodes.find(n => n.id === nsNodeId);
          if (!nsNode) return;

          // Определяем контент (если суммаризация выключена - полный ответ)
          let content = '';
          /**
           * Семантика контента для UI.
           * - Если суммаризация выключена → всегда full.
           * - Если включена → summary, когда мы используем `summary` или явно режем `response`.
           */
          let contentKind: 'full' | 'summary' = 'full';

          if (!useSummarization && nsNode.data.response) {
            // Режим полного контекста - весь ответ без обрезки
            content = nsNode.data.response;
            contentKind = 'full';
          } else if (useSummarization && nsNode.data.summary) {
            content = nsNode.data.summary;
            contentKind = 'summary';
          } else if (nsNode.data.response) {
            // Fallback - краткий ответ (только если суммаризация включена)
            const willTruncate = useSummarization && nsNode.data.response.length > 500;
            content = willTruncate
              ? nsNode.data.response.slice(0, 500) + '...'
              : nsNode.data.response;
            // Если мы реально обрезали текст — для пользователя это "суммаризация/суть".
            // Если ответ короткий и не обрезался — это всё ещё "полный ответ".
            contentKind = willTruncate ? 'summary' : 'full';
          }

          // Пропускаем если нет контента
          if (!content && !nsNode.data.prompt) return;

          blocks.push({
            key: `node:virtual-grandparent:${parent.id}:${nsNodeId}:${nsIndex}`,
            blockKind: 'node',
            nodeId: nsNodeId,
            prompt: nsNode.data.prompt || '',
            type: 'neuro-search',
            content,
            contentKind,
            level: 1, // Уровень дедушки
            levelName: directParents.length > 1 
              ? `Виртуальный дедушка (NeuroSearch родителя ${parentIndex + 1}, №${nsIndex + 1})`
              : `Виртуальный дедушка (NeuroSearch №${nsIndex + 1})`,
            nodeType: nsNode.type as 'neuro' | 'note',
          });
        });
      });

      // =========================================================================
      // ЧАСТЬ 2: ДЕДУШКИ И ДАЛЕЕ
      // Включает ВСЕХ предков (все родители каждого предка собраны через BFS)
      // 
      // ПРИОРИТЕТ КОНТЕНТА для каждого предка:
      // 1. Если кто-то из потомков (ближе к текущей ноде) ЦИТИРУЕТ этого предка
      //    → показываем эту цитату (она "просачивается" вниз по цепочке)
      // 2. Если у самого предка есть своя ЦИТАТА от его родителя
      //    → показываем её ЦЕЛИКОМ (тип 'quote')
      // 3. Если есть summary → используем summary (тип 'summary')
      // 4. Fallback: сокращённый response до 300 символов (тип 'summary')
      // =========================================================================

      // Фильтруем предков, исключая прямых родителей
      const grandparents = ancestorChain.filter(
        (node) => !directParents.some((p) => p.id === node.id)
      );

      /**
       * Вспомогательная функция: найти цитату на предка среди его потомков в цепочке
       * Если родитель или более близкий предок цитирует данного предка,
       * возвращаем эту цитату (она должна передаваться дальше по цепочке)
       */
      const findQuoteForAncestor = (ancestorId: string): string | null => {
        // Проверяем прямых родителей текущей карточки
        for (const parent of directParents) {
          if (parent.data.quoteSourceNodeId === ancestorId && parent.data.quote) {
            return parent.data.quote;
          }
        }

        // Проверяем всех предков (кроме самого искомого)
        // Ищем среди тех, кто "ближе" к текущей ноде
        for (const ancestor of ancestorChain) {
          if (ancestor.id === ancestorId) continue; // Пропускаем самого предка
          if (ancestor.data.quoteSourceNodeId === ancestorId && ancestor.data.quote) {
            return ancestor.data.quote;
          }
        }

        return null;
      };

      grandparents.forEach((ancestor, index) => {
        if (!ancestor) return;

        // Определяем тип и контент для предка
        // По умолчанию 'summary', но если суммаризация выключена - 'full'
        let type: ContextType = useSummarization ? 'summary' : 'full';
        let content = '';
        let quoteContent: string | undefined;
        /**
         * Семантика контента для UI.
         *
         * Важно не путать:
         * - `type` — тип блока в терминах "какой это контекст" (full/quote/summary)
         * - `contentKind` — что именно мы показываем в поле `content` (полный текст или суммаризация)
         *
         * Например: `type = 'quote'`, но `content` может быть как full, так и summary.
         */
        let contentKind: 'full' | 'summary' = 'full';

        // ПРИОРИТЕТ 1: Проверяем, цитирует ли кто-то из потомков этого предка
        // Если да - используем эту цитату (она должна "просачиваться" вниз по цепочке)
        const quoteFromDescendant = findQuoteForAncestor(ancestor.id);
        if (quoteFromDescendant) {
          type = 'quote';
          quoteContent = quoteFromDescendant;

          // Контекст предка
          if (useSummarization && ancestor.data.summary) {
            content = ancestor.data.summary;
            contentKind = 'summary';
          } else if (ancestor.data.response) {
            // Fallback - берем начало ответа или полный
            content = !useSummarization
              ? ancestor.data.response
              : (ancestor.data.response.slice(0, 500) + '...');
            // Если суммаризация включена — здесь мы гарантированно режем ответ до 500 символов,
            // поэтому для пользователя это именно "суммаризация/суть".
            contentKind = useSummarization ? 'summary' : 'full';
          }
        }
        // РЕЖИМ ПОЛНОГО КОНТЕКСТА: если суммаризация выключена - всегда полный response
        else if (!useSummarization && ancestor.data.response) {
          type = 'full';
          content = ancestor.data.response;
          contentKind = 'full';
        }
        // ПРИОРИТЕТ 2: Если есть summary - используем его (суммаризация включена)
        else if (ancestor.data.summary) {
          type = 'summary';
          content = ancestor.data.summary;
          contentKind = 'summary';
        }
        // ПРИОРИТЕТ 3: Fallback на полный response (суммаризация включена, но summary нет)
        else if (ancestor.data.response) {
          // При включённой суммаризации всё равно показываем полный ответ,
          // потому что summary ещё не готов (fallback поведение)
          type = 'full';
          content = ancestor.data.response;
          contentKind = 'full';
        }

        // Пропускаем если нет контента и нет цитаты
        if (!content && !quoteContent && !ancestor.data.prompt) return;

        blocks.push({
          key: `node:ancestor:${ancestor.id}:${index}`,
          blockKind: 'node',
          nodeId: ancestor.id,
          prompt: ancestor.data.prompt || '',
          type,
          content,
          quoteContent,
          contentKind,
          level: index + 1, // +1 потому что level 0 = прямые родители
          levelName: getLevelName(index + 1),
          // Сохраняем тип ноды для различения AI-карточек и личных заметок
          nodeType: ancestor.type as 'neuro' | 'note',
        });

        // -------------------------------------------------------------------
        // ВЛОЖЕНИЯ ДАЛЬНИХ ПРЕДКОВ (как "суммаризация документа")
        // -------------------------------------------------------------------
        //
        // Для дальних предков мы НЕ хотим тянуть полный документ (контекст раздуется).
        // Поэтому показываем (и передаём потомкам) только:
        // - summary (если есть)
        // - иначе excerpt (fallback)
        //
        // Важно: выключенные вложения (excludedAttachmentIds) остаются видимыми в UI,
        // но мы будем визуально подсвечивать их как "excluded" на уровне рендера.
        const ancestorLevel = index + 1; // 1 = дедушка, 2 = прадедушка, ...
        pushAttachmentBlocks(
          ancestor,
          ancestorLevel,
          format(t.contextModal.attachmentsOfLevel, { level: getLevelName(ancestorLevel) }),
          // Для НЕ-владельца мы всегда предпочитаем "суть" (не полный документ).
          // Это предотвращает раздувание контекста и соответствует продуктовой логике.
          true
        );

        // =======================================================================
        // ВИРТУАЛЬНЫЕ ПРАДЕДУШКИ (NeuroSearch от этого предка)
        // 
        // Если у предка есть neuroSearchNodeIds - показываем их как
        // виртуальных прадедушек с краткой суммаризацией
        // =======================================================================
        if (ancestor.data.neuroSearchNodeIds && ancestor.data.neuroSearchNodeIds.length > 0) {
          ancestor.data.neuroSearchNodeIds.forEach((nsNodeId, nsIndex) => {
            // Пропускаем исключённые
            if (excludedContextNodeIds.includes(nsNodeId)) return;
            
            // Находим карточку по ID
            const nsNode = nodes.find(n => n.id === nsNodeId);
            if (!nsNode) return;

            // Для дальних виртуальных предков - контент зависит от настроек суммаризации
            let nsContent = '';
            /**
             * Семантика контента для UI (лейбл).
             * Для дальних виртуальных предков мы считаем "summary", если:
             * - есть `summary`, или
             * - мы в режиме суммаризации и режем `response`.
             */
            let nsContentKind: 'full' | 'summary' = 'full';
            if (!useSummarization && nsNode.data.response) {
              // Режим полного контекста - весь ответ
              nsContent = nsNode.data.response;
              nsContentKind = 'full';
            } else if (nsNode.data.summary) {
              nsContent = nsNode.data.summary;
              nsContentKind = 'summary';
            } else if (nsNode.data.response) {
              // Fallback - краткий ответ (только если суммаризация включена)
              const willTruncate = useSummarization && nsNode.data.response.length > 300;
              nsContent = willTruncate
                ? nsNode.data.response.slice(0, 300) + '...'
                : nsNode.data.response;
              nsContentKind = willTruncate ? 'summary' : 'full';
            }

            // Пропускаем если нет контента
            if (!nsContent && !nsNode.data.prompt) return;

            blocks.push({
              key: `node:virtual-ancestor:${ancestor.id}:${nsNodeId}:${nsIndex}`,
              blockKind: 'node',
              nodeId: nsNodeId,
              prompt: nsNode.data.prompt || '',
              type: 'neuro-search',
              content: nsContent,
              contentKind: nsContentKind,
              level: index + 2, // Ещё глубже чем предок
              levelName: `Виртуальный предок [${index + 2}] (NeuroSearch №${nsIndex + 1})`,
              nodeType: nsNode.type as 'neuro' | 'note',
            });
          });
        }
      });

      return blocks;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      directParents,
      ancestorChain,
      quote,
      quoteSourceNodeId,
      useSummarization,
      t,
      neuroSearchResults,
      nodes,
      excludedContextNodeIds,
      currentNodeId,
      // excludedAttachmentIds используется в рендере (isExcluded),
      // но зависимость добавляем для ясности: если список изменится,
      // хотим гарантированно перерисовать модалку.
      excludedAttachmentIds,
    ]);

    // ===========================================================================
    // РЕНДЕР
    // ===========================================================================

    // Вычисляем описание в зависимости от количества предков
    const descriptionText = contextBlocks.length > 0
      ? contextBlocks.length === 1
        ? format(t.contextModal.description, { count: contextBlocks.length })
        : format(t.contextModal.descriptionPlural, { count: contextBlocks.length })
      : t.contextModal.noContext;

    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          ref={dialogContentRef}
          // Делаем окно шире и "резиновее", чтобы оно НЕ было ограничено размером карточки.
          // Важно: DialogContent рендерится в Portal (body), поэтому это не зависит от ReactFlow трансформов.
          className="w-[min(1100px,95vw)] max-w-none max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Шапка диалога */}
          {/* Шапка диалога */}
          <DialogHeader className="flex-shrink-0 space-y-4">
            <div className="flex items-center justify-between">
              {/* Контейнер заголовка и описания с минимальным отступом между ними */}
              <div className="space-y-1">
                <DialogTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  {t.contextModal.title}
                </DialogTitle>
                <DialogDescription>
                  {descriptionText}
                </DialogDescription>
              </div>

              {/* Кнопки управления */}
              {contextBlocks.length > 0 && (
                <div className="flex items-center gap-1 mr-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCollapseAll}
                    title="Collapse All"
                    className="h-8 w-8 p-0"
                  >
                    <Minimize2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExpandAll}
                    title="Expand All"
                    className="h-8 w-8 p-0"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* Контент с блоками контекста */}
          <div
            ref={outerScrollRef}
            className="flex-1 overflow-y-auto mt-4 space-y-4 pr-2"
          >
            {contextBlocks.length === 0 ? (
              // Пустое состояние
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">{t.contextModal.rootCard}</p>
              </div>
            ) : (
              // Список блоков контекста
              contextBlocks.map((block, index) => {
                // ВАЖНО:
                // - для нод используем excludedContextNodeIds
                // - для вложений используем excludedAttachmentIds
                const isExcluded =
                  block.blockKind === 'attachment'
                    ? excludedAttachmentIds.includes(block.nodeId)
                    : excludedContextNodeIds.includes(block.nodeId);

                // Сворачивание — по уникальному ключу
                const isCollapsed = collapsedBlockIds.has(block.key);

                /**
                 * ВАЖНОЕ РАЗДЕЛЕНИЕ "ВЛАДЕЛЕЦ vs ПОТОМОК" ДЛЯ ВЛОЖЕНИЙ:
                 *
                 * - Если вложение прикреплено к ТЕКУЩЕЙ карточке (owner === currentNodeId),
                 *   то пользователь явно сделал это вложение частью контекста этой карточки,
                 *   и мы можем показывать:
                 *   - превью картинки,
                 *   - описание изображения (caption-only) в UI.
                 *
                 * - Если вложение пришло из РОДИТЕЛЯ/ПРЕДКА (owner !== currentNodeId),
                 *   то это "наследуемый контекст":
                 *   - Картинку НЕ показываем (чтобы потомки не "таскали" изображения визуально),
                 *   - Показываем только ОПИСАНИЕ (caption-only),
                 *   - Если нужно реально дать картинку в контекст этой карточки — пользователь жмёт "Прикрепить".
                 */
                const isAttachmentBlock = block.blockKind === 'attachment';
                const isAttachmentOwnedByCurrent = isAttachmentBlock && block.attachmentOwnerNodeId === currentNodeId;

                return (
                  <div
                    key={block.key}
                    className={cn(
                      'rounded-lg border transition-colors',
                      'p-4',
                      block.level > 0 && 'ml-4',
                      isExcluded
                        ? 'bg-muted/30 border-border/50 opacity-60 grayscale-[0.5]'
                        : 'bg-card/50 border-border'
                    )}
                  >
                    {/* Заголовок блока */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {/* Чекбокс исключения контекста */}
                        <button
                          onClick={() => {
                            if (block.blockKind === 'attachment') {
                              onToggleAttachmentItem?.(block.nodeId);
                            } else {
                              onToggleContextItem?.(block.nodeId);
                            }
                          }}
                          className={cn(
                            "flex items-center justify-center w-5 h-5 rounded hover:bg-muted/50 transition-colors",
                            isExcluded ? "text-muted-foreground" : "text-primary"
                          )}
                          title={
                            block.blockKind === 'attachment'
                              ? (isExcluded ? "Включить вложение в контекст" : "Исключить вложение из контекста")
                              : (isExcluded ? "Включить контекст" : "Исключить из контекста")
                          }
                        >
                          {isExcluded ? (
                            // Иконка Square (пустой чекбокс) из lucide-react - симуляция uncheck
                            <div className="w-4 h-4 border-2 border-current rounded-sm" />
                          ) : (
                            // Checkbox с галочкой
                            <div className="w-4 h-4 bg-primary text-primary-foreground flex items-center justify-center rounded-sm">
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          )}
                        </button>

                        {/* Уровень и название */}
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {/* Индикатор иерархии */}
                          {index > 0 && block.type !== 'neuro-search' && (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                          
                          {/* Иконка мозга для NeuroSearch в заголовке */}
                          {block.type === 'neuro-search' && (
                             <Brain className="w-4 h-4 text-indigo-500" />
                          )}

                          {/* Иконка "скрепка" для вложений */}
                          {block.blockKind === 'attachment' && (
                            <Paperclip className="w-4 h-4 text-muted-foreground" />
                          )}
                          
                          {/**
                           * Визуальный стиль "выключенного" блока контекста (isExcluded):
                           *
                           * ВАЖНОЕ UX-решение:
                           * - Раньше мы добавляли зачёркивание (`line-through`) к названию уровня ("Родитель", "Предок [1]" и т.д.).
                           * - Одновременно весь блок уже становится "выключенным" за счёт:
                           *   - серого фона/границы
                           *   - пониженной прозрачности (opacity)
                           *   - grayscale-фильтра
                           *
                           * Из-за этого создавалось ощущение, что элемент "зачёркнут" ещё раз,
                           * и это выглядело странно/шумно.
                           *
                           * Поэтому:
                           * - при isExcluded мы НЕ используем зачёркивание
                           * - оставляем только приглушённый цвет текста
                           * - общий "disabled"-вид обеспечивает контейнер карточки (см. классы выше)
                           */}
                          <span className={isExcluded ? "text-muted-foreground" : "text-foreground"}>
                            {block.levelName}
                          </span>
                          
                          {/* Процент схожести для NeuroSearch */}
                          {block.type === 'neuro-search' && block.similarityPercent && (
                            <span className="text-xs text-indigo-500 font-bold bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                              {block.similarityPercent}%
                            </span>
                          )}
                          
                          {/* Индикатор устаревших данных (Stale) */}
                          {block.isStale && (
                            <div className="flex items-center text-xs text-orange-500 ml-2" title="Данные могли устареть">
                              <AlertCircle className="w-3.5 h-3.5 mr-1" />
                              <span>Stale</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* =====================================================================
                            ACTION: "ПРИКРЕПИТЬ К ЭТОЙ КАРТОЧКЕ" (как ссылка на файл холста)

                            Зачем:
                            - файл один на холст (глобальный по имени)
                            - карточки хранят ссылки (attachmentId)
                            - пользователь может "подключить" к ребёнку тот же документ,
                              чтобы он стал ПОЛНЫМ контекстом уже для этой карточки (владельца).

                            Важно:
                            - Мы НЕ копируем файл на диск (без дублей).
                            - Мы копируем МЕТАДАННЫЕ "текстовой сути" в data текущей карточки:
                              - для text: excerpt/summary
                              - для image: описание (caption-only) как текстовый суррогат изображения
                           ===================================================================== */}
                        {block.blockKind === 'attachment' &&
                          block.attachment &&
                          block.attachmentOwnerNodeId &&
                          block.attachmentOwnerNodeId !== currentNodeId && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                const ownerId = block.attachmentOwnerNodeId!;
                                const att = block.attachment!;
                                const attId = att.attachmentId;

                                // 1) Находим owner и current ноды
                                const ownerNode = nodes.find((n) => n.id === ownerId) || null;
                                const currentNode = nodes.find((n) => n.id === currentNodeId) || null;
                                if (!ownerNode || !currentNode) return;

                                // 2) Если уже прикреплено — ничего не делаем
                                const currentAtts = Array.isArray(currentNode.data.attachments)
                                  ? (currentNode.data.attachments as NodeAttachment[])
                                  : [];
                                if (currentAtts.some((a) => a?.attachmentId === attId)) return;

                                // 3) Добавляем ссылку на тот же attachmentId
                                const nextAtts = [...currentAtts, att];

                                // 4) Копируем метаданные "суть документа" из owner -> current,
                                //    чтобы потомки current могли использовать суммаризацию/описание.
                                const safeStringMap = (v: unknown): Record<string, string> => {
                                  if (!v || typeof v !== 'object') return {};
                                  const obj = v as Record<string, unknown>;
                                  const out: Record<string, string> = {};
                                  for (const [k, val] of Object.entries(obj)) {
                                    if (typeof val === 'string') out[k] = val;
                                  }
                                  return out;
                                };

                                const ownerSummaries = safeStringMap(ownerNode.data.attachmentSummaries);
                                const ownerExcerpts = safeStringMap(ownerNode.data.attachmentExcerpts);
                                const ownerImageDesc = safeStringMap(ownerNode.data.attachmentImageDescriptions);

                                const currentSummaries = safeStringMap(currentNode.data.attachmentSummaries);
                                const currentExcerpts = safeStringMap(currentNode.data.attachmentExcerpts);
                                const currentImageDesc = safeStringMap(currentNode.data.attachmentImageDescriptions);

                                const patch: Partial<NeuroNodeData> = {
                                  attachments: nextAtts,
                                  updatedAt: Date.now(),
                                };

                                // Текстовые вложения
                                if (att.kind === 'text') {
                                  const nextExcerpts = { ...currentExcerpts };
                                  const nextSummaries = { ...currentSummaries };
                                  if (ownerExcerpts[attId] && !nextExcerpts[attId]) {
                                    nextExcerpts[attId] = ownerExcerpts[attId];
                                  }
                                  if (ownerSummaries[attId] && !nextSummaries[attId]) {
                                    nextSummaries[attId] = ownerSummaries[attId];
                                  }
                                  if (Object.keys(nextExcerpts).length > 0) patch.attachmentExcerpts = nextExcerpts;
                                  if (Object.keys(nextSummaries).length > 0) patch.attachmentSummaries = nextSummaries;
                                }

                                // Изображения
                                if (att.kind === 'image') {
                                  const next = { ...currentImageDesc };
                                  if (ownerImageDesc[attId] && !next[attId]) {
                                    next[attId] = ownerImageDesc[attId];
                                  }
                                  if (Object.keys(next).length > 0) patch.attachmentImageDescriptions = next;
                                }

                                updateNodeData(currentNodeId, patch);
                                // STALE v2:
                                // - Подключение вложения как "ссылки" меняет PRIMARY-контекст ТОЛЬКО
                                //   текущей карточки (владельца).
                                // - Мы намеренно НЕ каскадим stale на потомков здесь, чтобы не получить
                                //   постоянную подсветку статусов при любых действиях в контекстном окне.
                                // - Если у владельца есть response, store (updateNodeData) сам пометит его stale.
                                // - Потомки станут stale только при Generate/Regenerate владельца
                                //   или при фактическом изменении response владельца.
                              }}
                              title="Прикрепить этот файл к текущей карточке (как ссылку, без копирования файла)"
                            >
                              Прикрепить
                            </Button>
                          )}

                        {/* Badge с типом контекста */}
                        <div
                          className={cn(
                            'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
                            isExcluded ? 'bg-muted text-muted-foreground' : getContextTypeColor(block.type)
                          )}
                        >
                          <ContextTypeIcon type={block.type} className="w-3.5 h-3.5" />
                          {getContextTypeName(block.type)}
                        </div>

                        {/* Кнопка сворачивания */}
                        <button
                          onClick={() => toggleCollapse(block.key)}
                          className="p-1 hover:bg-muted/50 rounded transition-colors text-muted-foreground"
                        >
                          <ChevronRight className={cn("w-4 h-4 transition-transform", !isCollapsed && "rotate-90")} />
                        </button>
                      </div>
                    </div>

                    {/* Контейнер контента, скрываемый при сворачивании */}
                    {!isCollapsed && (
                      <>
                        {/* Вопрос (prompt) или Название заметки */}
                        {block.prompt && (
                          <div className="mb-3 p-2 rounded bg-muted/50">
                            <div className="text-xs text-muted-foreground mb-1 font-medium">
                              {/**
                               * Заголовок "prompt" в зависимости от типа блока:
                               * - attachment: "Файл:"
                               * - note: "Название:"
                               * - neuro: "Вопрос:"
                               */}
                              {block.blockKind === 'attachment'
                                ? t.contextModal.file
                                : (block.nodeType === 'note' ? t.contextModal.noteTitle : t.contextModal.question)}
                            </div>
                            <div className="text-sm">{block.prompt}</div>
                          </div>
                        )}

                        {/* Содержимое контекста */}
                        <div className="mt-2 text-sm">
                          {/* Если есть цитата - отображаем её Plain Text отдельным блоком */}
                          {block.quoteContent && (
                            <div className="mb-3">
                              <div className="text-xs text-orange-600 dark:text-orange-400 mb-1 font-medium">
                                {t.contextModal.quoteLabel}
                              </div>
                              <div className={cn(
                                "whitespace-pre-wrap font-sans text-foreground/90",
                                "pl-3 border-l-2 border-orange-500",
                                "bg-orange-50/50 dark:bg-orange-950/20",
                                "p-2 rounded-r-md"
                              )}>
                                {block.quoteContent}
                              </div>
                            </div>
                          )}

                          {/* Основной контент (Контекст) */}
                          {/**
                           * ПРЕВЬЮ ИЗОБРАЖЕНИЯ:
                           * - показываем ТОЛЬКО если это вложение прикреплено к текущей карточке (owner === currentNodeId)
                           * - у потомков (вложения предков/родителей) картинку НЕ показываем
                           */}
                          {block.blockKind === 'attachment' &&
                            block.attachment?.kind === 'image' &&
                            isAttachmentOwnedByCurrent && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 font-medium">
                                {t.contextModal.attachmentImage}
                              </div>
                              <div className="rounded-md border border-border overflow-hidden bg-muted/10">
                                {activeCanvasId ? (
                                  <Image
                                    // Вложение отдаётся нашим API-роутом.
                                    // Используем относительный URL — Next сам подставит origin.
                                    src={`/api/attachments/${activeCanvasId}/${block.attachment.attachmentId}`}
                                    alt={block.attachment.originalName || block.attachment.attachmentId}
                                    // Next/Image требует width/height для расчёта соотношения сторон и предотвращения layout shift.
                                    // Точные размеры заранее неизвестны, поэтому задаём "большой" безопасный baseline,
                                    // а адаптивность обеспечиваем через классы Tailwind (w-full h-auto) + sizes.
                                    width={1600}
                                    height={900}
                                    sizes="(max-width: 1100px) 95vw, 1100px"
                                    className="w-full h-auto"
                                    draggable={false}
                                    // Не включаем оптимизацию через Next Image Optimizer для /api/attachments,
                                    // чтобы избежать потенциальных проблем с доступом/заголовками и лишних вычислений.
                                    unoptimized
                                  />
                                ) : (
                                  <div className="p-3 text-xs text-muted-foreground">
                                    Нет активного холста: невозможно загрузить изображение.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Для изображений показываем описание отдельным блоком, чтобы не путать с превью "Изображение:" */}
                          {block.blockKind === 'attachment' && block.attachment?.kind === 'image' && block.content && (
                            <div className="mt-3">
                              <div className="text-xs text-muted-foreground mb-1 font-medium">
                                {/**
                                 * ЛЕЙБЛ ДЛЯ ТЕКСТА ПО ИЗОБРАЖЕНИЯМ:
                                 * - мы больше НЕ показываем OCR и не храним его как отдельный слой
                                 * - поэтому лейбл всегда "Описание:"
                                 */}
                                {'Описание:'}
                              </div>
                              <div
                                data-context-card-inner-scroll="true"
                                className={cn(
                                  'prose prose-sm dark:prose-invert max-w-none',
                                  'prose-p:my-1.5 prose-headings:my-2',
                                  'max-h-[300px] overflow-y-auto pr-2 custom-scrollbar'
                                )}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {block.content}
                                </ReactMarkdown>
                              </div>
                            </div>
                          )}

                          {block.content && !(block.blockKind === 'attachment' && block.attachment?.kind === 'image') && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1 font-medium">
                                {/**
                                 * Лейбл контента:
                                 * - attachment: "Текст документа:" / "Изображение:"
                                 * - note: "Содержание:"
                                 * - neuro: "Ответ:" или "Суммаризация:"
                                 */}
                                {block.blockKind === 'attachment'
                                  ? (block.attachment?.kind === 'image'
                                    ? t.contextModal.attachmentImage
                                    : t.contextModal.attachmentText)
                                  : (block.nodeType === 'note'
                                    ? t.contextModal.noteContent
                                    : (() => {
                                        const isSummaryContent = block.contentKind === 'summary';
                                        const summaryLabel = `${t.contextModal.summary}:`;
                                        return isSummaryContent ? summaryLabel : t.contextModal.response;
                                      })())}
                              </div>
                              <div
                                /**
                                 * Внутренний scroll-контейнер контента КОНКРЕТНОЙ карточки.
                                 *
                                 * Мы помечаем его data-атрибутом, чтобы wheel-перехватчик на уровне модалки
                                 * мог отличать "скролл карточки" от "скролла списка карточек".
                                 *
                                 * Если курсор над этим контейнером — колесо должно скроллить карточку,
                                 * а не внешний список.
                                 */
                                data-context-card-inner-scroll="true"
                                className={cn(
                                  'prose prose-sm dark:prose-invert max-w-none',
                                  'prose-p:my-1.5 prose-headings:my-2',
                                  // Ограничиваем высоту если блок не свернут, но очень большой
                                  'max-h-[500px] overflow-y-auto pr-2 custom-scrollbar'
                                )}
                              >
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {block.content}
                                </ReactMarkdown>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Легенда типов контекста */}
          {contextBlocks.length > 0 && (
            <div className="flex-shrink-0 mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="font-medium">{t.contextModal.contextTypes}</span>
                <div className="flex items-center gap-1">
                  <ContextTypeIcon type="full" className="w-3 h-3" />
                  <span>{t.contextModal.full}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ContextTypeIcon type="quote" className="w-3 h-3" />
                  <span>{t.contextModal.quote}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ContextTypeIcon type="summary" className="w-3 h-3" />
                  <span>{t.contextModal.summary}</span>
                </div>
                <div className="flex items-center gap-1 ml-4 border-l pl-4">
                  <div className="w-3 h-3 border border-current rounded-sm opacity-50" />
                  <span>{t.contextModal.excluded || "Excluded from context"}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  };

export default ContextViewerModal;
