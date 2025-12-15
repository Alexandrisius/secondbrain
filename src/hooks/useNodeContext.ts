/**
 * @file useNodeContext.ts
 * @description Хук для построения контекста родительских нод
 * 
 * Поддерживает:
 * - Прямые родительские связи (edges)
 * - Виртуальные связи через NeuroSearch
 * - Цепочку предков (дедушки, прадедушки)
 * - Суммаризацию для дальних предков
 */

import { useMemo, useCallback } from 'react';
import { useCanvasStore } from '@/store/useCanvasStore';
import { useSettingsStore, selectUseSummarization } from '@/store/useSettingsStore';
import type { NeuroNode } from '@/types/canvas';
import type { SearchResult } from '@/types/embeddings';

interface UseNodeContextProps {
  /** ID текущей ноды */
  nodeId: string;
  /** Данные текущей ноды */
  data: NeuroNode['data'];
  /**
   * Результаты NeuroSearch для текущей ноды (виртуальные родители)
   * Если переданы - включаются в контекст при генерации
   */
  neuroSearchResults?: SearchResult[];
}

export const useNodeContext = ({ nodeId, data, neuroSearchResults = [] }: UseNodeContextProps) => {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const useSummarization = useSettingsStore(selectUseSummarization);

  /**
   * Вычисляем ПРЯМЫХ родителей
   */
  const directParents = useMemo(() => {
    const parents: NeuroNode[] = [];

    // Приоритет 1: parentIds (массив родителей)
    if (data.parentIds && data.parentIds.length > 0) {
      data.parentIds.forEach((parentId) => {
        const parentNode = nodes.find((n) => n.id === parentId);
        if (parentNode) {
          parents.push(parentNode);
        }
      });
      return parents;
    }

    // Приоритет 2: Ищем входящие связи (может быть несколько)
    const incomingEdges = edges.filter((e) => e.target === nodeId);
    if (incomingEdges.length > 0) {
      incomingEdges.forEach((edge) => {
        const parentNode = nodes.find((n) => n.id === edge.source);
        if (parentNode && !parents.some((p) => p.id === parentNode.id)) {
          parents.push(parentNode);
        }
      });
      if (parents.length > 0) return parents;
    }

    // Приоритет 3: parentId (обратная совместимость)
    if (data.parentId) {
      const parentNode = nodes.find((n) => n.id === data.parentId);
      if (parentNode) {
        parents.push(parentNode);
      }
    }

    return parents;
  }, [nodeId, data.parentIds, data.parentId, nodes, edges]);

  /**
   * Вычисляем ПОЛНУЮ цепочку предков (BFS)
   */
  const ancestorChain = useMemo(() => {
    const ancestors: NeuroNode[] = [];

    if (directParents.length === 0) return ancestors;

    ancestors.push(...directParents);

    const queue: string[] = directParents.map((p) => p.id);
    const processedIds = new Set<string>(queue);
    
    // Защита от бесконечных циклов
    const maxIterations = 500;
    let iterations = 0;

    const getParentsOfNode = (currNodeId: string): NeuroNode[] => {
      const parents: NeuroNode[] = [];
      const node = nodes.find((n) => n.id === currNodeId);
      if (!node) return parents;

      if (node.data.parentIds && node.data.parentIds.length > 0) {
        node.data.parentIds.forEach((pid) => {
          const pNode = nodes.find((n) => n.id === pid);
          if (pNode && !parents.some((p) => p.id === pNode.id)) parents.push(pNode);
        });
        return parents;
      }

      const incomingEdges = edges.filter((e) => e.target === currNodeId);
      if (incomingEdges.length > 0) {
        incomingEdges.forEach((edge) => {
          const pNode = nodes.find((n) => n.id === edge.source);
          if (pNode && !parents.some((p) => p.id === pNode.id)) parents.push(pNode);
        });
        if (parents.length > 0) return parents;
      }

      if (node.data.parentId) {
        const pNode = nodes.find((n) => n.id === node.data.parentId);
        if (pNode) parents.push(pNode);
      }

      return parents;
    };

    while (queue.length > 0 && iterations < maxIterations) {
      iterations++;
      const currId = queue.shift()!;
      const parentsOfCurrent = getParentsOfNode(currId);

      parentsOfCurrent.forEach((parent) => {
        if (!processedIds.has(parent.id)) {
          processedIds.add(parent.id);
          ancestors.push(parent);
          queue.push(parent.id);
        }
      });
    }

    return ancestors;
  }, [directParents, nodes, edges]);

  /**
   * Вспомогательная функция для поиска цитаты
   */
  const findQuoteForAncestor = useCallback((ancestorId: string, excludedIds: string[]): string | null => {
    // В прямых родителях
    for (const parent of directParents) {
      if (parent.data.quoteSourceNodeId === ancestorId && parent.data.quote) {
        return parent.data.quote;
      }
    }
    // В предках (не исключенных)
    for (const ancestor of ancestorChain) {
      if (excludedIds.includes(ancestor.id)) continue;
      if (ancestor.id === ancestorId) continue;
      if (ancestor.data.quoteSourceNodeId === ancestorId && ancestor.data.quote) {
        return ancestor.data.quote;
      }
    }
    return null;
  }, [directParents, ancestorChain]);

  /**
   * Формирование строкового контекста для LLM
   * 
   * Структура контекста (приоритетная, “честная” для LLM):
   * 
   * 1) ВАЖНО: РОДОСЛОВНАЯ
   *    - прямые родители → предки
   *    - цитаты/summary/full — как и раньше
   * 
   * 2) ДОПОЛНИТЕЛЬНО: ВЛОЖЕНИЯ ПРЕДКОВ (ТОЛЬКО СУТЬ)
   *    - текст: summary/excerpt
   *    - изображение: caption-only description
   *    - НИКОГДА не подмешиваем полный файл предка (иначе контекст раздуется)
   * 
   * 3) НИЗКИЙ ПРИОРИТЕТ: NEUROSEARCH (ВИРТУАЛЬНЫЙ КОНТЕКСТ)
   *    - может быть шумом и не должен “перебивать” родословную
   *    - поэтому идёт последним и помечается как low-priority
   * 
   * Почему так:
   * - пользователь явно попросил, чтобы LLM не воспринимала “виртуальных детей” (NeuroSearch)
   *   как “первую и самую важную” информацию.
   */
  const buildParentContext = useCallback((): string | undefined => {
    // Проверяем наличие контекста: родители ИЛИ нейропоиск
    const hasNeuroSearch = neuroSearchResults.length > 0;
    if (directParents.length === 0 && !hasNeuroSearch) return undefined;

    const excludedIds = data.excludedContextNodeIds || [];
    const excludedAttachmentIds = Array.isArray(data.excludedAttachmentIds)
      ? (data.excludedAttachmentIds as string[])
      : [];

    // ----------------------------------------------------------------------------
    // ПРАКТИЧЕСКИЕ ЛИМИТЫ (защита от “очень большого холста”)
    // ----------------------------------------------------------------------------
    //
    // Важно:
    // - это НЕ “безопасность”, а UX/производительность/контроль токенов;
    // - лимиты мягкие: мы не ломаем логику, а аккуратно срезаем хвост и
    //   оставляем метку, что контекст обрезан.
    //
    // Если понадобятся настройки — их можно вынести в Settings позже,
    // но в MVP достаточно констант (простота и предсказуемость).
    const MAX_ANCESTORS = 50; // дальние предки (grandparents) в строковом контексте
    const MAX_ATTACHMENTS_PER_OWNER = 10; // вложения на одного владельца (родитель/предок)
    const MAX_NEUROSEARCH_RESULTS = 10; // результаты NeuroSearch для текущей карточки
    const MAX_NEUROSEARCH_TEXT_CHARS = 2000; // “разумный” максимум текста на один виртуальный блок

    // Три секции в порядке важности.
    const lineageBlocks: string[] = [];
    const attachmentBlocks: string[] = [];
    const neuroSearchBlocks: string[] = [];

    // Безопасный "string map" (Record<string,string>) из unknown.
    // Используем для attachmentSummaries/attachmentExcerpts.
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
     * Укорачиваем "документный" текст для контекста.
     *
     * Почему это нужно:
     * - суммаризации/OCR описания могут быть длинными;
     * - мы хотим, чтобы контекст оставался управляемым;
     * - лимиты на токены в /api/chat уже есть для вложений самой карточки,
     *   но "контекст предков" мы формируем на клиенте и должны быть осторожны.
     */
    const clampContextText = (text: string, maxChars: number): string => {
      const t = (text || '').trim();
      if (!t) return '';
      if (t.length <= maxChars) return t;
      return t.slice(0, maxChars) + '...';
    };

    /**
     * Нормализация “описания изображения” для потомков.
     *
     * Новая семантика (актуальная):
     * - мы храним в node.data.attachmentImageDescriptions[attachmentId] УЖЕ ГОТОВОЕ описание (caption-only),
     *   без OCR и без маркеров. Его можно передавать потомкам напрямую.
     *
     * Backward-compat (старые данные):
     * - раньше там могла лежать строка combined формата:
     *   "OCR:\n...\n\nОписание:\n..."
     * - или вариант с "DESCRIPTION:"/"OCR_TEXT:".
     *
     * Правило безопасности (критично):
     * - потомкам нельзя протаскивать OCR/текст с картинки (особенно скриншоты кода/логов),
     *   поэтому если видим OCR-маркеры, но НЕ видим маркер описания — возвращаем пусто.
     */
    const normalizeImageDescriptionForDescendants = (storedText: string): string => {
      const raw = (storedText || '').trim();
      if (!raw) return '';

      // Legacy маркер на русском.
      const descMarkerRu = /(^|\n)Описание:\s*/i;
      const descIdxRu = raw.search(descMarkerRu);
      if (descIdxRu !== -1) return raw.slice(descIdxRu).replace(descMarkerRu, '').trim();

      // Legacy маркер на английском.
      const descMarkerEn = /(^|\n)DESCRIPTION:\s*/i;
      const descIdxEn = raw.search(descMarkerEn);
      if (descIdxEn !== -1) return raw.slice(descIdxEn).replace(descMarkerEn, '').trim();

      // Если видим OCR-маркеры — не рискуем.
      const hasOcrMarker = /(^|\n)\s*OCR(_TEXT)?:\s*/i.test(raw);
      if (hasOcrMarker) return '';

      // Новая версия: это уже чистое description.
      return raw;
    };

    /**
     * Минимальный тип вложения, который нам нужен в контексте.
     *
     * Мы специально не используем "полный" NodeAttachment, потому что:
     * - данные могут быть старыми/повреждёнными,
     * - в buildParentContext мы хотим быть максимально устойчивыми к мусору.
     */
    type AttachmentLike = {
      attachmentId: string;
      kind?: unknown;
      originalName?: unknown;
    };

    const isAttachmentLike = (v: unknown): v is AttachmentLike => {
      if (!v || typeof v !== 'object') return false;
      const o = v as Record<string, unknown>;
      return typeof o.attachmentId === 'string' && o.attachmentId.length > 0;
    };

    /**
     * Достаём "суть" вложения для передачи потомкам.
     *
     * Правило продукта:
     * - ПОЛНЫЙ контент вложения должен быть только у карточки-владельца (там, где прикреплено напрямую).
     * - Для всех остальных (дети/предки) мы передаём только суммаризацию/выжимку:
     *   - text: attachmentSummaries → fallback attachmentExcerpts
     *   - image: attachmentImageDescriptions (в ноде хранится описание изображения (caption-only))
     *
     * Важно:
     * - Мы всегда возвращаем КОРОТКИЙ текст, чтобы не раздувать контекст.
     */
    const getAttachmentContextSnippet = (
      owner: NeuroNode,
      att: AttachmentLike
    ): string => {
      const attachmentId = att.attachmentId;
      const kind = typeof att.kind === 'string' ? att.kind : '';

      // Текстовые вложения: summary → excerpt
      if (kind === 'text') {
        const summaries = normalizeStringMap(owner.data.attachmentSummaries);
        const excerpts = normalizeStringMap(owner.data.attachmentExcerpts);

        const summary = (summaries[attachmentId] || '').trim();
        const excerpt = (excerpts[attachmentId] || '').trim();

        // В потомков уходит всегда "суть": сначала summary, иначе excerpt.
        const chosen = summary || excerpt;
        return clampContextText(chosen, 1200);
      }

      // Изображения: description-only (caption-only).
      if (kind === 'image') {
        const imageDescriptions = normalizeStringMap(owner.data.attachmentImageDescriptions);
        const stored = (imageDescriptions[attachmentId] || '').trim();

        // Для потомков используем только безопасное описание:
        // - новая версия: сразу description
        // - старая версия: вырезаем часть “Описание:” из combined (если можем)
        const descriptionOnly = normalizeImageDescriptionForDescendants(stored);
        return clampContextText(descriptionOnly, 1200);
      }

      return '';
    };

    // =========================================================================
    // ЧАСТЬ 1: РОДОСЛОВНАЯ (ВЫСОКИЙ ПРИОРИТЕТ)
    // =========================================================================
    directParents.forEach((parent, index) => {
        if (!parent || excludedIds.includes(parent.id)) return;

        const parentParts: string[] = [];
        const isNote = parent.type === 'note';
        
        // Заголовок
        let headerTitle = '';
        if (directParents.length === 1) {
             headerTitle = isNote ? '=== КОНТЕКСТ ИЗ ЗАМЕТКИ ===' : '=== КОНТЕКСТ ИЗ РОДИТЕЛЬСКОЙ КАРТОЧКИ ===';
        } else {
             headerTitle = isNote 
                ? `=== КОНТЕКСТ ИЗ ЗАМЕТКИ №${index + 1} ===` 
                : `=== КОНТЕКСТ ИЗ РОДИТЕЛЬСКОЙ КАРТОЧКИ №${index + 1} ===`;
        }
        parentParts.push(headerTitle);

        // Prompt
        if (parent.data.prompt) {
          const promptLabel = isNote ? 'Note Title' : 'Вопрос';
          parentParts.push(`${promptLabel}: ${parent.data.prompt}`);
        }

        // Цитата или Полный ответ
        if (data.quote && data.quoteSourceNodeId === parent.id) {
            parentParts.push(`[Цитата]: "${data.quote}"`);
            // Добавляем контекст источника цитаты
            if (useSummarization && parent.data.summary) {
                parentParts.push(`[Контекст]: ${parent.data.summary}`);
            } else if (parent.data.response) {
                parentParts.push(`[Контекст]: ${parent.data.response}`);
            }
        } else if (parent.data.response) {
            const responseLabel = isNote ? 'Note Content' : 'Ответ';
            parentParts.push(`${responseLabel}: ${parent.data.response}`);
        }
        lineageBlocks.push(parentParts.join('\n'));
    });

    // =========================================================================
    // ЧАСТЬ 2: ДАЛЬНИЕ ПРЕДКИ (РОДОСЛОВНАЯ, продолжение)
    // =========================================================================
    const grandparents = ancestorChain.filter(
        (node) => !directParents.some((p) => p.id === node.id) && !excludedIds.includes(node.id)
    );

    const limitedGrandparents = grandparents.slice(0, MAX_ANCESTORS);
    const wasGrandparentsTruncated = grandparents.length > limitedGrandparents.length;

    limitedGrandparents.forEach((ancestor, index) => {
        if (!ancestor) return;

        const ancestorParts: string[] = [];
        ancestorParts.push(`=== КОНТЕКСТ ПРЕДКА (Уровень -${index + 2}) ===`);

        if (ancestor.data.prompt) {
            ancestorParts.push(`Вопрос: ${ancestor.data.prompt}`);
        }

        const quoteFromDescendant = findQuoteForAncestor(ancestor.id, excludedIds);
        
        if (quoteFromDescendant) {
            ancestorParts.push(`[Цитата (из потомка)]: "${quoteFromDescendant}"`);
            if (useSummarization && ancestor.data.summary) {
                ancestorParts.push(`[Контекст]: ${ancestor.data.summary}`);
            } else if (ancestor.data.response) {
                const text = !useSummarization 
                    ? ancestor.data.response 
                    : (ancestor.data.response.slice(0, 500) + '...');
                ancestorParts.push(`[Контекст]: ${text}`);
            }
        } else if (!useSummarization && ancestor.data.response) {
            // Full context mode
            ancestorParts.push(`Ответ: ${ancestor.data.response}`);
        } else if (ancestor.data.summary) {
            ancestorParts.push(`Суть ответа: ${ancestor.data.summary}`);
        } else if (ancestor.data.response) {
            // Fallback summary
            ancestorParts.push(`Суть ответа: ${ancestor.data.response.slice(0, 300)}...`);
        }
        lineageBlocks.push(ancestorParts.join('\n'));
    });

    // =========================================================================
    // ЧАСТЬ 3: ВЛОЖЕНИЯ ПРЕДКОВ (ВТОРОСТЕПЕННО)
    // =========================================================================
    //
    // Почему отдельной секцией:
    // - вложения важны, но часто являются “дополнительной справкой”;
    // - при огромном количестве вложений они не должны размывать родословную.
    // =========================================================================
    // ДЕДУПЛИКАЦИЯ ВЛОЖЕНИЙ ПО docId (attachmentId)
    // =========================================================================
    //
    // Проблема из задачи:
    // - один и тот же документ (docId) может встречаться у нескольких предков,
    //   потому что у нас ссылочная модель вложений (через file manager);
    // - следовательно, summary/excerpt/description по этому docId будет одинаковым;
    // - если мы не делаем дедуп, то в контекст LLM “утекает” один и тот же текст многократно,
    //   что:
    //   - тратит токены,
    //   - ухудшает сигнал/шум,
    //   - иногда реально смещает ответ модели из‑за повторов.
    //
    // Правило:
    // - ключ = attachmentId (он же docId).
    // - приоритет “первого появления” (ближайшего источника):
    //   directParents → limitedGrandparents.
    //
    // Дополнительная эвристика “best snippet wins”:
    // - если мы впервые встретили docId, но у этого владельца нет snippet'а,
    //   а позже встретился тот же docId с непустым snippet'ом — мы заменяем snippet.
    // - при этом порядок (первое появление) НЕ меняем, чтобы сохранять предсказуемость.
    type UniqueAttachmentEntry = {
      docId: string;
      displayName: string;
      kind: string; // 'text' | 'image' | '' (на случай мусорных данных)
      snippet: string; // может быть пустым, тогда используем нейтральный fallback
    };

    const uniqueAttachmentOrder: string[] = [];
    const uniqueAttachments = new Map<string, UniqueAttachmentEntry>();

    // Флаг: если у каких-то предков много вложений, мы всё равно не хотим читать их бесконечно.
    // Это сохраняет текущую идею “лимитов” из прошлого кода, но уже в режиме дедупликации.
    let wasAnyOwnerTruncatedByPerOwnerLimit = false;

    const getDisplayName = (a: AttachmentLike): string => {
      const name = (typeof a.originalName === 'string' ? a.originalName.trim() : '') || '';
      return name || a.attachmentId;
    };

    const upsertUniqueAttachment = (owner: NeuroNode, a: AttachmentLike) => {
      const docId = a.attachmentId;
      if (!docId) return;
      if (excludedAttachmentIds.includes(docId)) return;

      const name = getDisplayName(a);
      const kind = typeof a.kind === 'string' ? a.kind : '';

      // “Суть” вложения для потомков (summary/excerpt/description).
      const snippet = getAttachmentContextSnippet(owner, a);

      const existing = uniqueAttachments.get(docId) || null;
      if (!existing) {
        uniqueAttachments.set(docId, {
          docId,
          displayName: name,
          kind,
          snippet,
        });
        uniqueAttachmentOrder.push(docId);
        return;
      }

      // Если ранее у нас не было “человеческого” имени, а теперь оно появилось — улучшаем.
      const existingLooksLikeDocId = existing.displayName === existing.docId;
      const newLooksBetterName = name && name !== docId;
      if (existingLooksLikeDocId && newLooksBetterName) {
        existing.displayName = name;
      }

      // Если раньше не знали kind, а теперь знаем — улучшаем (для fallback-сообщения).
      if (!existing.kind && kind) {
        existing.kind = kind;
      }

      // Best snippet wins: если раньше snippet был пустым, а теперь стал непустым — обновляем.
      if (!existing.snippet && snippet) {
        existing.snippet = snippet;
      }
    };

    const scanOwner = (owner: NeuroNode) => {
      const raw = Array.isArray(owner.data.attachments) ? owner.data.attachments : [];
      const atts = raw.filter(isAttachmentLike);
      // Фильтруем выключенные docId, чтобы лимит считался по “реально разрешённым” вложениям.
      const visible = atts.filter((a) => !excludedAttachmentIds.includes(a.attachmentId));
      if (visible.length === 0) return;

      // Отмечаем, что у этого владельца было больше вложений, чем мы готовы читать в контекст.
      // Даже при дедупликации это важно: иначе на огромном холсте мы будем “перебирать всё”.
      if (visible.length > MAX_ATTACHMENTS_PER_OWNER) {
        wasAnyOwnerTruncatedByPerOwnerLimit = true;
      }

      for (const a of visible.slice(0, MAX_ATTACHMENTS_PER_OWNER)) {
        upsertUniqueAttachment(owner, a);
      }
    };

    // 3.1 Сканируем вложения прямых родителей (ближайший приоритет)
    directParents.forEach((parent) => {
      if (!parent || excludedIds.includes(parent.id)) return;
      scanOwner(parent);
    });

    // 3.2 Сканируем вложения дальних предков (в пределах лимита MAX_ANCESTORS)
    limitedGrandparents.forEach((ancestor) => {
      if (!ancestor) return;
      scanOwner(ancestor);
    });

    // 3.3 Формируем одну (дедуплицированную) секцию вложений для LLM
    if (uniqueAttachmentOrder.length > 0) {
      const lines: string[] = [];
      lines.push('--- Уникальные вложения предков (дедуп по docId) ---');

      for (const docId of uniqueAttachmentOrder) {
        const entry = uniqueAttachments.get(docId);
        if (!entry) continue;

        // Если snippet есть — отдаём его как есть (он уже ограничен clampContextText()).
        if (entry.snippet) {
          lines.push(`- ${entry.displayName}: ${entry.snippet}`);
          continue;
        }

        // Нейтральный fallback (не упоминаем OCR в контексте потомков).
        const missingWhat =
          entry.kind === 'image'
            ? 'описания изображения'
            : entry.kind === 'text'
              ? 'выжимки/суммаризации текста'
              : 'текстовой сути';
        lines.push(`- ${entry.displayName}: (нет сохранённой ${missingWhat}; откройте превью в карточке-источнике)`);
      }

      // Если мы резали владельцев по MAX_ATTACHMENTS_PER_OWNER — сообщаем одним маркером, без дублей.
      if (wasAnyOwnerTruncatedByPerOwnerLimit) {
        lines.push(`(для некоторых предков показаны только первые ${MAX_ATTACHMENTS_PER_OWNER} вложений; остальное скрыто для экономии контекста)`);
      }

      attachmentBlocks.push(lines.join('\n'));
    }

    // Если мы обрезали цепочку предков — возможно, мы также “отрезали” вложения.
    // Мы стараемся не шуметь лишними сообщениями:
    // - показываем маркер ТОЛЬКО если в “хвосте” действительно были вложения.
    if (wasGrandparentsTruncated) {
      const tail = grandparents.slice(MAX_ANCESTORS);
      const hasAttachmentsInTail = tail.some((a) => {
        const raw = Array.isArray(a.data.attachments) ? a.data.attachments : [];
        for (const v of raw) {
          if (!isAttachmentLike(v)) continue;
          if (excludedAttachmentIds.includes(v.attachmentId)) continue;
          // Дедуп-логика: если этот docId уже попал в уникальный набор, то “хвост”
          // не добавляет НОВОЙ информации про вложения — значит, маркер можно не показывать.
          if (uniqueAttachments.has(v.attachmentId)) continue;
          return true;
        }
        return false;
      });

      if (hasAttachmentsInTail) {
        attachmentBlocks.push(
          `(вложения более дальних предков скрыты; всего предков: ${grandparents.length}, лимит: ${MAX_ANCESTORS})`
        );
      }
    }

    // =========================================================================
    // ЧАСТЬ 4: NEUROSEARCH (НИЗКИЙ ПРИОРИТЕТ)
    // =========================================================================
    //
    // Важно:
    // - мы намеренно кладём это в конец, чтобы модель не “переоценивала”
    //   виртуальный контекст относительно родословной.
    //
    // Дополнительная защита:
    // - ограничиваем размер текста и количество блоков.
    const pushNeuroSearchFromOwner = (owner: NeuroNode, ownerLabel: string) => {
      const ids = Array.isArray(owner.data.neuroSearchNodeIds) ? owner.data.neuroSearchNodeIds : [];
      if (ids.length === 0) return;

      const lines: string[] = [];
      lines.push(`--- ${ownerLabel} ---`);

      ids.forEach((nsNodeId, nsIndex) => {
        if (excludedIds.includes(nsNodeId)) return;
        const nsNode = nodes.find((n) => n.id === nsNodeId);
        if (!nsNode) return;

        const nsLines: string[] = [];
        nsLines.push(`[NeuroSearch №${nsIndex + 1}]`);
        if (nsNode.data.prompt) nsLines.push(`Вопрос: ${nsNode.data.prompt}`);

        // Для “унаследованного” виртуального контекста — только суть.
        if (nsNode.data.summary) {
          nsLines.push(`Суть: ${clampContextText(nsNode.data.summary, MAX_NEUROSEARCH_TEXT_CHARS)}`);
        } else if (nsNode.data.response) {
          const text = useSummarization
            ? clampContextText(nsNode.data.response, 300)
            : clampContextText(nsNode.data.response, MAX_NEUROSEARCH_TEXT_CHARS);
          nsLines.push(`Суть: ${text}`);
        }

        lines.push(nsLines.join('\n'));
      });

      neuroSearchBlocks.push(lines.join('\n'));
    };

    // 4.1 NeuroSearch результаты “для этой карточки”
    if (hasNeuroSearch) {
      const limited = neuroSearchResults.slice(0, MAX_NEUROSEARCH_RESULTS);
      const wasTruncated = neuroSearchResults.length > limited.length;

      const lines: string[] = [];
      lines.push('--- NeuroSearch: результаты для этой карточки ---');

      limited.forEach((result, index) => {
        if (excludedIds.includes(result.nodeId)) return;

        const parts: string[] = [];
        parts.push(`[Результат #${index + 1}] ${result.similarityPercent}% совпадение`);
        if (result.prompt) parts.push(`Вопрос: ${result.prompt}`);
        if (result.responsePreview) {
          parts.push(`Суть: ${clampContextText(result.responsePreview, MAX_NEUROSEARCH_TEXT_CHARS)}`);
        }
        lines.push(parts.join('\n'));
      });

      if (wasTruncated) {
        lines.push(`(показаны первые ${MAX_NEUROSEARCH_RESULTS} результатов; остальное скрыто для экономии контекста)`);
      }

      neuroSearchBlocks.push(lines.join('\n'));
    }

    // 4.2 Виртуальный контекст, который “тащат” родители/предки
    directParents.forEach((parent, idx) => {
      if (!parent || excludedIds.includes(parent.id)) return;
      pushNeuroSearchFromOwner(
        parent,
        directParents.length > 1
          ? `NeuroSearch: виртуальный контекст Родителя №${idx + 1}`
          : `NeuroSearch: виртуальный контекст Родителя`
      );
    });
    limitedGrandparents.forEach((ancestor, idx) => {
      if (!ancestor) return;
      pushNeuroSearchFromOwner(ancestor, `NeuroSearch: виртуальный контекст Предка (уровень -${idx + 2})`);
    });

    // =========================================================================
    // СКЛЕЙКА СЕКЦИЙ В ФИНАЛЬНУЮ СТРОКУ
    // =========================================================================
    const sections: string[] = [];

    if (lineageBlocks.length > 0) {
      const header = [
        '=== ВАЖНО: РОДОСЛОВНАЯ (ОСНОВНОЙ КОНТЕКСТ) ===',
        'Здесь находятся реальные родители/предки и (при необходимости) цитаты.',
        'Используй это как основной источник истины.',
      ].join('\n');

      // Если предки были обрезаны — уведомляем модель (и человека при отладке).
      const tail = wasGrandparentsTruncated
        ? `(родословная обрезана: всего предков ${grandparents.length}, лимит ${MAX_ANCESTORS})`
        : null;

      sections.push([header, ...lineageBlocks, tail].filter(Boolean).join('\n\n'));
    }

    if (attachmentBlocks.length > 0) {
      const header = [
        '=== ДОПОЛНИТЕЛЬНО: ВЛОЖЕНИЯ ПРЕДКОВ (ВТОРОСТЕПЕННЫЙ КОНТЕКСТ) ===',
        'Это НЕ полные файлы, а только “суть” (summary/excerpt или описание изображения).',
        'Если блоки конфликтуют с родословной — доверяй родословной.',
      ].join('\n');
      sections.push([header, ...attachmentBlocks].join('\n\n'));
    }

    if (neuroSearchBlocks.length > 0) {
      const header = [
        '=== НИЗКИЙ ПРИОРИТЕТ: NEUROSEARCH (ВИРТУАЛЬНЫЙ КОНТЕКСТ) ===',
        'Это похожие по смыслу карточки, которые могут быть шумом.',
        'НЕ считай этот раздел более важным, чем родословную.',
      ].join('\n');
      sections.push([header, ...neuroSearchBlocks].join('\n\n'));
    }

    const final = sections.join('\n\n').trim();
    return final ? final : undefined;
  }, [
    directParents, 
    ancestorChain, 
    neuroSearchResults,
    nodes,
    data.excludedContextNodeIds, 
    data.excludedAttachmentIds,
    data.quote, 
    data.quoteSourceNodeId, 
    useSummarization, 
    findQuoteForAncestor
  ]);

  return {
    directParents,
    ancestorChain,
    buildParentContext,
    parentNode: directParents[0] || null,
  };
};

