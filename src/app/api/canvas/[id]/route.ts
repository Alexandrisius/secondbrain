/**
 * @file route.ts
 * @description API endpoints для работы с отдельными холстами
 * 
 * Эндпоинты:
 * - GET /api/canvas/[id] - загрузка данных холста (ноды, связи)
 * - POST /api/canvas/[id] - сохранение данных холста
 * - DELETE /api/canvas/[id] - удаление холста
 * 
 * Данные хранятся в пользовательской папке:
 * - Electron: %APPDATA%\NeuroCanvas\data\canvases\
 * - Dev режим: ./data/canvases/
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import type { WorkspaceIndex } from '@/types/workspace';
import { 
  getDataDirectory, 
  getCanvasesDirectory, 
  getCanvasFilePath,
  getIndexFilePath,
} from '@/lib/paths';
import { readLibraryIndex } from '@/lib/libraryIndex';
import { isValidDocId } from '@/lib/libraryFs';
import { readUsageIndex, replaceCanvasUsage, removeCanvasUsage, writeUsageIndex } from '@/lib/libraryUsageIndex';
import type { NodeAttachment } from '@/types/canvas';

// =============================================================================
// ТИПЫ
// =============================================================================

/**
 * Структура данных холста (ноды, связи, системная инструкция)
 */
interface CanvasData {
  /** Массив нод */
  nodes: unknown[];
  /** Массив связей */
  edges: unknown[];
  /** Временная метка последнего сохранения */
  lastSaved: number;
  /** Системная инструкция для холста (опционально) */
  systemPrompt?: string | null;
}

/**
 * Параметры роута
 */
interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

// =============================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================================================

/**
 * Проверяет существование директории и создаёт её при необходимости
 * @param dirPath - путь к директории
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    console.log('[Canvas API] Создана директория:', dirPath);
  }
}

/**
 * Читает данные холста из файла
 * @param canvasId - ID холста
 * @returns Данные холста или null если файл не существует
 */
async function readCanvasData(canvasId: string): Promise<CanvasData | null> {
  const filePath = getCanvasFilePath(canvasId);
  
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as CanvasData;
  } catch {
    console.log('[Canvas API] Файл холста не найден:', filePath);
    return null;
  }
}

/**
 * Записывает данные холста в файл
 * @param canvasId - ID холста
 * @param data - данные для записи
 */
async function writeCanvasData(canvasId: string, data: CanvasData): Promise<void> {
  const canvasesDir = getCanvasesDirectory();
  await ensureDirectoryExists(canvasesDir);
  
  const filePath = getCanvasFilePath(canvasId);
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
  
  console.log('[Canvas API] Сохранён холст:', filePath);
}

/**
 * Удаляет файл холста
 * @param canvasId - ID холста
 */
async function deleteCanvasFile(canvasId: string): Promise<void> {
  const filePath = getCanvasFilePath(canvasId);
  
  try {
    await fs.access(filePath);
    await fs.unlink(filePath);
    console.log('[Canvas API] Удалён файл:', filePath);
  } catch {
    // Файл не существует - ничего не делаем
  }
}

/**
 * Читает индекс workspace
 * @returns Данные workspace
 */
async function readWorkspaceIndex(): Promise<WorkspaceIndex | null> {
  const indexFile = getIndexFilePath();
  
  try {
    await fs.access(indexFile);
    const content = await fs.readFile(indexFile, 'utf-8');
    return JSON.parse(content) as WorkspaceIndex;
  } catch {
    return null;
  }
}

/**
 * Записывает индекс workspace
 * @param data - данные для записи
 */
async function writeWorkspaceIndex(data: WorkspaceIndex): Promise<void> {
  const dataDir = getDataDirectory();
  await ensureDirectoryExists(dataDir);
  
  const indexFile = getIndexFilePath();
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(indexFile, content, 'utf-8');
}

/**
 * Копирует холст
 * @param sourceId - ID исходного холста
 * @param newId - ID копии
 */
async function copyCanvasFile(sourceId: string, newId: string): Promise<void> {
  const sourceData = await readCanvasData(sourceId);
  
  if (sourceData) {
    await writeCanvasData(newId, {
      ...sourceData,
      lastSaved: Date.now(),
    });
  } else {
    // Если исходный файл не найден - создаём пустой
    await writeCanvasData(newId, {
      nodes: [
        {
          id: 'node-initial',
          type: 'neuro',
          position: { x: 250, y: 200 },
          data: {
            prompt: '',
            response: null,
            summary: null,
            isGenerating: false,
            isSummarizing: false,
            isStale: false,
            isAnswerExpanded: false,
            mode: 'input',
            quote: null,
            quoteSourceNodeId: null,
            quoteOriginalResponse: null,
            isQuoteInvalidated: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      ],
      edges: [],
      lastSaved: Date.now(),
    });
  }
}

// =============================================================================
// LIBRARY USAGE INDEX (data/library/usage-index.json)
// =============================================================================
//
// Важно:
// - Глобальная библиотека документов хранит файлы по docId (UUID+ext),
// - Карточки по плану будут хранить `node.data.attachments[]`, где `attachmentId` трактуется как docId,
// - Раньше в проекте существовал legacy слой вложений, привязанный к холсту.
//   Сейчас он удалён, но старые canvas.json теоретически могут содержать "старые" attachmentId.
//
// Поэтому обновление usage-index делаем осторожно:
// - Мы сканируем attachments у нод,
// - Берём только те attachmentId, которые:
//   1) выглядят как docId (isValidDocId),
//   2) реально существуют в library-index.json (иначе это legacy/мусор/битые данные).
//
// Такое поведение:
// - не засоряет usage-index “старыми” attachmentId,
// - позволяет постепенно мигрировать систему без ломания текущего чата/превью.

/**
 * Best-effort: извлекает usage docId -> nodeIds[] из массива nodes (canvas.json).
 *
 * Важно:
 * - nodes типизированы как unknown[] (из-за React Flow),
 * - поэтому мы используем максимально "защитный" парсинг.
 */
function extractLibraryDocUsageFromNodes(
  nodes: unknown[],
  validDocIds: Set<string>
): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  if (!Array.isArray(nodes) || validDocIds.size === 0) return usage;

  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    const node = n as { id?: unknown; data?: unknown };
    const nodeId = typeof node.id === 'string' ? node.id : '';
    if (!nodeId) continue;

    const data = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>) : null;
    const attachments = data && Array.isArray(data.attachments) ? (data.attachments as unknown[]) : null;
    if (!attachments) continue;

    for (const a of attachments) {
      if (!a || typeof a !== 'object') continue;
      const att = a as { attachmentId?: unknown };
      const docId = typeof att.attachmentId === 'string' ? att.attachmentId.trim() : '';
      if (!docId) continue;

      // 1) Быстрая защита формата
      if (!isValidDocId(docId)) continue;

      // 2) Защита от legacy/битых ссылок: docId должен реально существовать в библиотеке.
      if (!validDocIds.has(docId)) continue;

      const list = usage.get(docId) || [];
      list.push(nodeId);
      usage.set(docId, list);
    }
  }

  // Дедуп nodeIds (на случай дублей в данных).
  for (const [docId, nodeIds] of usage.entries()) {
    usage.set(docId, Array.from(new Set(nodeIds)));
  }

  return usage;
}

/**
 * Best-effort сверка вложений (docId) при загрузке холста.
 *
 * Зачем это нужно (требование stale-propagation):
 * - Даже если сервер “правильно” пропатчил все холсты при replace, могут быть сценарии:
 *   - пользователь открыл холст до того, как успели обновиться все файлы/индексы,
 *   - usage-index мог быть временно неактуален (холст давно не сохраняли),
 *   - файл/индекс мог быть обновлён вручную.
 *
 * Поэтому при GET /api/canvas/[id] мы делаем быструю best-effort сверку:
 * - если attachmentId выглядит как docId и существует в library-index,
 *   то обновляем snapshot (mime/size/hash/updatedAt/name),
 * - если snapshot отличался от актуального — помечаем ноду stale (если у неё есть response).
 *
 * Важно:
 * - Мы НЕ пишем изменения обратно на диск (GET должен быть “чистым”).
 * - Это только “поддержка консистентности” для UI и для того, чтобы stale не пропускался.
 */
/**
 * Снимок документа из library-index, который нужен нам для reconcile на GET /api/canvas/[id].
 *
 * Важно:
 * - Мы намеренно НЕ тянем сюда "полный" тип LibraryDoc с сервера,
 *   а описываем только то, что реально используем.
 * - Это позволяет:
 *   - не использовать `any`,
 *   - не зависеть от внутренних деталей lib/libraryIndex.ts,
 *   - и держать API route типобезопасным.
 */
type LibraryDocSnapshot = {
  docId: string;
  name: string;
  kind: 'image' | 'text';
  mime: string;
  sizeBytes: number;
  fileHash: string;
  fileUpdatedAt: number;
  analysis?: {
    excerpt?: string;
    summary?: string;
    image?: { description?: string };
  };
};

function reconcileLibraryAttachmentSnapshotsOnLoad(nodes: unknown[], docsById: Map<string, LibraryDocSnapshot>): void {
  if (!Array.isArray(nodes) || docsById.size === 0) return;

  for (const n of nodes) {
    if (!n || typeof n !== 'object') continue;
    // Canvas node "shape" в JSON может меняться, поэтому работаем через unknown + runtime checks.
    const node = n as { data?: unknown };
    const data = node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>) : null;
    if (!data) continue;

    const atts = Array.isArray(data['attachments']) ? (data['attachments'] as NodeAttachment[]) : null;
    if (!atts || atts.length === 0) continue;

    let nodeNeedsStale = false;

    for (const att of atts) {
      if (!att || typeof att !== 'object') continue;
      const id = String(att.attachmentId || '').trim();
      if (!id) continue;

      // Мы считаем библиотечным только то, что:
      // 1) похоже на docId по формату
      // 2) реально существует в library-index.json
      if (!isValidDocId(id)) continue;
      const doc = docsById.get(id);
      if (!doc) continue;

      // Если snapshot отличался — это сигнал, что контекст “сменился”.
      // Ставим stale владельцу (если есть response).
      const oldHash = typeof att.fileHash === 'string' ? att.fileHash : '';
      const oldUpdatedAt = typeof att.fileUpdatedAt === 'number' ? att.fileUpdatedAt : 0;
      if ((oldHash && oldHash !== doc.fileHash) || (oldUpdatedAt && oldUpdatedAt !== doc.fileUpdatedAt)) {
        nodeNeedsStale = true;
      }

      // Обновляем snapshot до актуального (чтобы UI/контекст дальше работали на новой версии).
      att.kind = doc.kind;
      att.mime = doc.mime;
      att.sizeBytes = doc.sizeBytes;
      att.fileHash = doc.fileHash;
      att.fileUpdatedAt = doc.fileUpdatedAt;
      att.originalName = doc.name;

      // Best-effort синхронизируем derived метаданные (если они есть в библиотеке).
      // Это полезно для будущего контекста потомков и превью.
      const excerpts =
        data['attachmentExcerpts'] && typeof data['attachmentExcerpts'] === 'object' ? (data['attachmentExcerpts'] as Record<string, unknown>) : {};
      const summaries =
        data['attachmentSummaries'] && typeof data['attachmentSummaries'] === 'object' ? (data['attachmentSummaries'] as Record<string, unknown>) : {};
      const imageDescs =
        data['attachmentImageDescriptions'] && typeof data['attachmentImageDescriptions'] === 'object'
          ? (data['attachmentImageDescriptions'] as Record<string, unknown>)
          : {};

      if (doc.kind === 'text') {
        if (doc.analysis?.excerpt) excerpts[id] = doc.analysis.excerpt;
        else delete excerpts[id];

        if (doc.analysis?.summary) summaries[id] = doc.analysis.summary;
        else delete summaries[id];

        delete imageDescs[id];
      } else {
        delete excerpts[id];
        delete summaries[id];
        if (doc.analysis?.image?.description) imageDescs[id] = doc.analysis.image.description;
        else delete imageDescs[id];
      }

      // Сохраняем обратно как "optional" поля (undefined = не хранить пустые объекты в JSON).
      data['attachmentExcerpts'] = Object.keys(excerpts).length > 0 ? excerpts : undefined;
      data['attachmentSummaries'] = Object.keys(summaries).length > 0 ? summaries : undefined;
      data['attachmentImageDescriptions'] = Object.keys(imageDescs).length > 0 ? imageDescs : undefined;
    }

    if (nodeNeedsStale && data['response']) {
      data['isStale'] = true;
    }
  }
}

// =============================================================================
// GET - Загрузка холста
// =============================================================================

/**
 * GET /api/canvas/[id]
 * Возвращает данные холста (ноды и связи)
 * 
 * @param request - входящий запрос
 * @param params - параметры роута (id холста)
 * @returns JSON с nodes, edges, lastSaved
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: canvasId } = await params;
    
    // Читаем данные холста
    const data = await readCanvasData(canvasId);
    
    if (!data) {
      // Холст не найден - возвращаем начальные данные
      console.log(`[Canvas API] Холст ${canvasId} не найден, возвращаем начальные данные`);
      
      return NextResponse.json({
        nodes: [
          {
            id: 'node-initial',
            type: 'neuro',
            position: { x: 250, y: 200 },
            data: {
              prompt: '',
              response: null,
              summary: null,
              isGenerating: false,
              isSummarizing: false,
              isStale: false,
              isAnswerExpanded: false,
              mode: 'input',
              quote: null,
              quoteSourceNodeId: null,
              quoteOriginalResponse: null,
              isQuoteInvalidated: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        ],
        edges: [],
        lastSaved: Date.now(),
      });
    }
    
    console.log(`[Canvas API] Загружен холст ${canvasId}: ${data.nodes.length} нод`);

    // =========================================================================
    // Доп. сверка "глобальных вложений" (docId) при загрузке (best-effort)
    // =========================================================================
    try {
      const libIndex = await readLibraryIndex();
      const docsById = new Map<string, LibraryDocSnapshot>();
      for (const d of libIndex.docs) {
        // libIndex.docs уже содержит docId, но мы делаем защиту от мусора.
        if (!d || typeof d !== 'object') continue;
        if (!d.docId || !isValidDocId(d.docId)) continue;
        docsById.set(d.docId, {
          docId: d.docId,
          name: d.name,
          kind: d.kind,
          mime: d.mime,
          sizeBytes: d.sizeBytes,
          fileHash: d.fileHash,
          fileUpdatedAt: d.fileUpdatedAt,
          analysis: d.analysis
            ? {
                excerpt: d.analysis.excerpt,
                summary: d.analysis.summary,
                image: d.analysis.image?.description ? { description: d.analysis.image.description } : undefined,
              }
            : undefined,
        });
      }

      reconcileLibraryAttachmentSnapshotsOnLoad(data.nodes, docsById);
    } catch (reconcileErr) {
      console.warn('[Canvas API] Не удалось сверить библиотечные вложения при GET (best-effort):', reconcileErr);
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Canvas API] Ошибка загрузки:', error);
    
    return NextResponse.json(
      { error: 'Не удалось загрузить холст' },
      { status: 500 }
    );
  }
}

// =============================================================================
// POST - Сохранение холста
// =============================================================================

/**
 * POST /api/canvas/[id]
 * Сохраняет данные холста
 * 
 * Поддерживает режимы:
 * 1. Сохранение данных - body содержит nodes и edges
 * 2. Копирование - body содержит { action: 'duplicate', newId, newName }
 * 
 * @param request - входящий запрос
 * @param params - параметры роута (id холста)
 * @returns JSON с подтверждением
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: canvasId } = await params;
    const body = await request.json();
    
    // =========================================================================
    // РЕЖИМ: Копирование холста
    // =========================================================================
    if (body.action === 'duplicate') {
      const { newId, newName } = body;

      // =========================================================================
      // ТРАНЗАКЦИОННОСТЬ (best-effort)
      //
      // Мы хотим избежать состояния:
      // - canvas файл создан
      // - или workspace index обновился частично
      //
      // Поэтому порядок такой:
      // 1) копируем canvas файл
      // 2) только после этого обновляем workspace index
      //
      // Если что-то падает — делаем cleanup (удаляем новый canvas файл).
      //
      // ВАЖНО (legacy-delete):
      // - Раньше у холста была “своя” папка вложений, привязанная к canvasId, и duplicate копировал её целиком.
      // - Теперь документы живут в глобальной библиотеке (data/library/files/<docId>),
      //   а карточки хранят ссылки (attachmentId == docId).
      // - Поэтому при duplicate холста мы НЕ копируем никаких файловых директорий:
      //   ссылки остаются ссылками, и они валидны на новом холсте.
      // =========================================================================
      try {
        // 1) Копируем файл холста
        await copyCanvasFile(canvasId, newId);

        // 2) Обновляем workspace
        const workspace = await readWorkspaceIndex();
        if (workspace) {
          const sourceCanvas = workspace.canvases.find(c => c.id === canvasId);

          if (sourceCanvas) {
            workspace.canvases.push({
              id: newId,
              name: newName || `${sourceCanvas.name} (копия)`,
              folderId: sourceCanvas.folderId,
              order: workspace.canvases.filter(c => c.folderId === sourceCanvas.folderId).length,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              nodesCount: sourceCanvas.nodesCount,
            });

            await writeWorkspaceIndex(workspace);
          }
        }

        console.log(`[Canvas API] Скопирован холст ${canvasId} -> ${newId}`);

        return NextResponse.json({
          success: true,
          message: 'Холст успешно скопирован',
        });
      } catch (dupErr) {
        console.error('[Canvas API] Ошибка копирования холста (duplicate):', dupErr);

        // Cleanup: удаляем “хвосты”
        await deleteCanvasFile(newId);

        return NextResponse.json(
          {
            error: 'Не удалось скопировать холст',
            details: dupErr instanceof Error ? dupErr.message : String(dupErr),
          },
          { status: 500 }
        );
      }
    }
    
    // =========================================================================
    // РЕЖИМ: Сохранение данных холста
    // =========================================================================
    
    // Валидация
    if (!body.nodes || !Array.isArray(body.nodes)) {
      return NextResponse.json(
        { error: 'Отсутствует или некорректное поле nodes' },
        { status: 400 }
      );
    }
    
    if (!body.edges || !Array.isArray(body.edges)) {
      return NextResponse.json(
        { error: 'Отсутствует или некорректное поле edges' },
        { status: 400 }
      );
    }
    
    // Формируем данные для записи
    // Включаем systemPrompt если он передан (может быть null или строка)
    const data: CanvasData = {
      nodes: body.nodes,
      edges: body.edges,
      lastSaved: Date.now(),
      // Сохраняем systemPrompt только если он передан в запросе
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
    };
    
    // Сохраняем в файл
    await writeCanvasData(canvasId, data);
    
    // Обновляем nodesCount в workspace
    const workspace = await readWorkspaceIndex();
    if (workspace) {
      const canvasIndex = workspace.canvases.findIndex(c => c.id === canvasId);
      if (canvasIndex !== -1) {
        workspace.canvases[canvasIndex].nodesCount = data.nodes.length;
        workspace.canvases[canvasIndex].updatedAt = Date.now();
        await writeWorkspaceIndex(workspace);
      }
    }

    // =========================================================================
    // ОБНОВЛЕНИЕ usage-index.json (best-effort)
    // =========================================================================
    //
    // Принцип:
    // - Источник истины по ссылкам на документы — canvas.json (node.data.attachments).
    // - Поэтому при каждом сохранении холста мы пересчитываем ссылки и заменяем usage для canvasId целиком.
    //
    // Важно:
    // - Если этот шаг упадёт (битый JSON индексов, проблемы с FS),
    //   мы НЕ хотим ломать сохранение холста полностью (UX важнее).
    // - Поэтому это best-effort: логируем warning и продолжаем.
    try {
      const libIndex = await readLibraryIndex();
      const validDocIds = new Set<string>(libIndex.docs.map((d) => d.docId));

      const usageByDocId = extractLibraryDocUsageFromNodes(data.nodes, validDocIds);
      const usageIndex = await readUsageIndex();
      replaceCanvasUsage(usageIndex, canvasId, usageByDocId);
      await writeUsageIndex(usageIndex);
    } catch (usageErr) {
      console.warn('[Canvas API] Не удалось обновить usage-index (best-effort):', usageErr);
    }
    
    console.log(`[Canvas API] Сохранён холст ${canvasId}: ${data.nodes.length} нод`);
    
    return NextResponse.json({
      success: true,
      message: 'Холст успешно сохранён',
      lastSaved: data.lastSaved,
    });
  } catch (error) {
    console.error('[Canvas API] Ошибка сохранения:', error);
    
    return NextResponse.json(
      { error: 'Не удалось сохранить холст' },
      { status: 500 }
    );
  }
}

// =============================================================================
// DELETE - Удаление холста
// =============================================================================

/**
 * DELETE /api/canvas/[id]
 * Удаляет холст и его файл
 * 
 * @param request - входящий запрос
 * @param params - параметры роута (id холста)
 * @returns JSON с подтверждением
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: canvasId } = await params;
    
    // Удаляем файл холста
    await deleteCanvasFile(canvasId);

    // =========================================================================
    // Удаляем usage для canvasId (best-effort)
    // =========================================================================
    //
    // Если холст удалён, ссылки на документы из этого холста должны исчезнуть из usage-index.
    // Это важно для корректной работы GC / “используется в”.
    try {
      const usageIndex = await readUsageIndex();
      removeCanvasUsage(usageIndex, canvasId);
      await writeUsageIndex(usageIndex);
    } catch (usageErr) {
      console.warn('[Canvas API] Не удалось удалить usage для canvasId (best-effort):', usageErr);
    }
    
    // Обновляем workspace
    const workspace = await readWorkspaceIndex();
    if (workspace) {
      // Удаляем холст из списка
      workspace.canvases = workspace.canvases.filter(c => c.id !== canvasId);
      
      // Удаляем из recent
      workspace.recent = workspace.recent.filter(id => id !== canvasId);
      
      // Если удалённый холст был активным - выбираем другой
      if (workspace.activeCanvasId === canvasId) {
        workspace.activeCanvasId = workspace.canvases[0]?.id || null;
      }
      
      await writeWorkspaceIndex(workspace);
    }
    
    console.log(`[Canvas API] Удалён холст: ${canvasId}`);
    
    return NextResponse.json({
      success: true,
      message: 'Холст успешно удалён',
    });
  } catch (error) {
    console.error('[Canvas API] Ошибка удаления:', error);
    
    return NextResponse.json(
      { error: 'Не удалось удалить холст' },
      { status: 500 }
    );
  }
}
