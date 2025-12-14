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
   * Структура контекста:
   * 1. NeuroSearch (виртуальные родители) - полный response
   * 2. Прямые родители - полный response или цитата
   * 3. Дальние предки - суммаризация
   * 4. NeuroSearch предков - суммаризация (виртуальные дедушки)
   */
  const buildParentContext = useCallback((): string | undefined => {
    // Проверяем наличие контекста: родители ИЛИ нейропоиск
    const hasNeuroSearch = neuroSearchResults.length > 0;
    if (directParents.length === 0 && !hasNeuroSearch) return undefined;

    const excludedIds = data.excludedContextNodeIds || [];
    const excludedAttachmentIds = Array.isArray(data.excludedAttachmentIds)
      ? (data.excludedAttachmentIds as string[])
      : [];
    const contextParts: string[] = [];

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
    // ЧАСТЬ 0: NEUROSEARCH КОНТЕКСТ (ВИРТУАЛЬНЫЕ РОДИТЕЛИ)
    // 
    // Результаты нейропоиска добавляются как "виртуальные родители"
    // с полным response (как у реальных родителей)
    // =========================================================================
    if (hasNeuroSearch) {
      neuroSearchResults.forEach((result, index) => {
        // Пропускаем исключённые
        if (excludedIds.includes(result.nodeId)) return;

        const parts: string[] = [];
        
        // Заголовок с процентом схожести
        parts.push(`=== КОНТЕКСТ ИЗ НЕЙРОПОИСКА №${index + 1} (${result.similarityPercent}% совпадение) ===`);
        
        // Вопрос
        if (result.prompt) {
          parts.push(`Вопрос: ${result.prompt}`);
        }
        
        // Полный ответ (responsePreview теперь содержит полный текст)
        if (result.responsePreview) {
          parts.push(`Ответ: ${result.responsePreview}`);
        }

        contextParts.push(parts.join('\n'));
      });
    }

    // =========================================================================
    // ЧАСТЬ 1: ПРЯМЫЕ РОДИТЕЛИ
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

        // ---------------------------------------------------------------------
        // ВЛОЖЕНИЯ ПРЯМОГО РОДИТЕЛЯ (как "контекст предка" уровня 1)
        // ---------------------------------------------------------------------
        //
        // КЛЮЧЕВОЕ ПРОДУКТОВОЕ ПРАВИЛО:
        // - ПОЛНЫЙ контент вложений получает только карточка-владелец (где файл прикреплён напрямую).
        // - Потомки (включая прямого ребёнка) получают ТОЛЬКО суммаризацию/суть:
        //   - text: summary/excerpt
        //   - image: описание изображения (caption-only)
        //
        // Поэтому здесь мы НЕ подмешиваем файлы через /api/chat attachments,
        // а добавляем в строковый контекст короткие выдержки.
        const parentAttsRaw = Array.isArray(parent.data.attachments) ? parent.data.attachments : [];
        const parentAtts = parentAttsRaw.filter(isAttachmentLike);
        const visibleParentAtts = parentAtts.filter((a) => !excludedAttachmentIds.includes(a.attachmentId));
        if (visibleParentAtts.length > 0) {
          parentParts.push(`[Вложения родителя]:`);
          visibleParentAtts.slice(0, 10).forEach((a) => {
            const name =
              (typeof a.originalName === 'string' && a.originalName.trim())
                ? a.originalName.trim()
                : a.attachmentId;
            const snippet = getAttachmentContextSnippet(parent, a);
            if (snippet) {
              parentParts.push(`- ${name}: ${snippet}`);
            } else {
              // Мы пишем максимально нейтрально и без "OCR" в тексте,
              // потому что по требованию продукта OCR НЕ должен попадать потомкам.
              const attKind = typeof a.kind === 'string' ? a.kind : '';
              const missingWhat =
                attKind === 'image'
                  ? 'описания изображения'
                  : attKind === 'text'
                    ? 'выжимки/суммаризации текста'
                    : 'текстовой сути';
              parentParts.push(`- ${name}: (нет сохранённой ${missingWhat}; откройте превью в карточке-источнике)`);
            }
          });
        }

        // =====================================================================
        // ЧАСТЬ 1.5: NEUROSEARCH КОНТЕКСТ ИЗ РОДИТЕЛЯ (КАК ВИРТУАЛЬНЫЕ ДЕДУШКИ)
        // 
        // Если у родителя есть neuroSearchNodeIds - добавляем их как суммаризацию
        // Это позволяет потомкам понимать, откуда у родителя могла появиться информация
        // =====================================================================
        if (parent.data.neuroSearchNodeIds && parent.data.neuroSearchNodeIds.length > 0) {
          parent.data.neuroSearchNodeIds.forEach((nsNodeId, nsIndex) => {
            // Пропускаем исключённые
            if (excludedIds.includes(nsNodeId)) return;
            
            // Находим карточку в nodes
            const nsNode = nodes.find(n => n.id === nsNodeId);
            if (!nsNode) return;
            
            const nsParts: string[] = [];
            nsParts.push(`  [Виртуальный контекст родителя - NeuroSearch №${nsIndex + 1}]`);
            
            if (nsNode.data.prompt) {
              nsParts.push(`  Вопрос: ${nsNode.data.prompt}`);
            }
            
            // Для виртуальных дедушек используем суммаризацию
            if (useSummarization && nsNode.data.summary) {
              nsParts.push(`  Суть: ${nsNode.data.summary}`);
            } else if (nsNode.data.response) {
              // Fallback - краткий ответ
              const shortResponse = nsNode.data.response.length > 300 
                ? nsNode.data.response.slice(0, 300) + '...'
                : nsNode.data.response;
              nsParts.push(`  Суть: ${shortResponse}`);
            }
            
            parentParts.push(nsParts.join('\n'));
          });
        }

        contextParts.push(parentParts.join('\n'));
    });

    // =========================================================================
    // ЧАСТЬ 2: ДАЛЬНИЕ ПРЕДКИ (GRANDPARENTS)
    // =========================================================================
    const grandparents = ancestorChain.filter(
        (node) => !directParents.some((p) => p.id === node.id) && !excludedIds.includes(node.id)
    );

    grandparents.forEach((ancestor, index) => {
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

        // ---------------------------------------------------------------------
        // ВЛОЖЕНИЯ ДАЛЬНЕГО ПРЕДКА (2+ поколения): только summary/excerpt
        // ---------------------------------------------------------------------
        //
        // Требование:
        // - "вложения ведут себя как предки"
        // - для дальних потомков мы НЕ передаём полный документ, только суть
        //
        // Здесь мы используем:
        // - attachmentSummaries[attachmentId] (если есть)
        // - иначе attachmentExcerpts[attachmentId] (fallback)
        //
        // Важно:
        // - Это работает только если мы ранее сохранили excerpts/summaries на ноде-владельце
        //   (см. QuestionSection.uploadAttachments).
        const ancestorAttsRaw = Array.isArray(ancestor.data.attachments) ? ancestor.data.attachments : [];
        const ancestorAtts = ancestorAttsRaw.filter(isAttachmentLike);
        const visibleAtts = ancestorAtts.filter((a) => !excludedAttachmentIds.includes(a.attachmentId));

        if (visibleAtts.length > 0) {
          ancestorParts.push(`[Вложения предка]:`);
          visibleAtts.slice(0, 10).forEach((a) => {
            const name =
              (typeof a.originalName === 'string' && a.originalName.trim())
                ? a.originalName.trim()
                : a.attachmentId;
            const snippet = getAttachmentContextSnippet(ancestor, a);
            if (snippet) {
              ancestorParts.push(`- ${name}: ${snippet}`);
            } else {
              // Аналогично блоку выше: не упоминаем OCR, чтобы не закреплять его как "норму"
              // в контексте потомков. OCR может существовать в данных владельца, но не в наследовании.
              const attKind = typeof a.kind === 'string' ? a.kind : '';
              const missingWhat =
                attKind === 'image'
                  ? 'описания изображения'
                  : attKind === 'text'
                    ? 'выжимки/суммаризации текста'
                    : 'текстовой сути';
              ancestorParts.push(`- ${name}: (нет сохранённой ${missingWhat}; откройте превью в карточке-источнике)`);
            }
          });
        }

        // =====================================================================
        // NEUROSEARCH КОНТЕКСТ ИЗ ПРЕДКА (КАК ВИРТУАЛЬНЫЕ ПРАДЕДУШКИ)
        // =====================================================================
        if (ancestor.data.neuroSearchNodeIds && ancestor.data.neuroSearchNodeIds.length > 0) {
          ancestor.data.neuroSearchNodeIds.forEach((nsNodeId, nsIndex) => {
            if (excludedIds.includes(nsNodeId)) return;
            
            const nsNode = nodes.find(n => n.id === nsNodeId);
            if (!nsNode) return;
            
            const nsParts: string[] = [];
            nsParts.push(`  [Виртуальный контекст предка - NeuroSearch №${nsIndex + 1}]`);
            
            if (nsNode.data.prompt) {
              nsParts.push(`  Вопрос: ${nsNode.data.prompt}`);
            }
            
            // Для дальних виртуальных предков - только краткая суть
            if (nsNode.data.summary) {
              nsParts.push(`  Суть: ${nsNode.data.summary}`);
            } else if (nsNode.data.response) {
              nsParts.push(`  Суть: ${nsNode.data.response.slice(0, 200)}...`);
            }
            
            ancestorParts.push(nsParts.join('\n'));
          });
        }

        contextParts.push(ancestorParts.join('\n'));
    });

    return contextParts.join('\n\n');
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

