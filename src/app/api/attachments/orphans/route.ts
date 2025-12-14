/**
 * @file route.ts
 * @description "Якорный" endpoint для будущего файлового менеджера:
 * показывает файлы вложений, которые потенциально можно почистить.
 *
 * Почему это нужно:
 * - Мы перевели удаление файлов на "soft-delete" (корзина .trash) ради корректного undo/redo.
 * - Это означает, что файлы могут оставаться на диске даже после удаления ссылок.
 * - Чтобы они не копились бесконечно, нужен механизм обнаружения "сирот"
 *   и последующей очистки (GC).
 *
 * Этот endpoint НЕ удаляет ничего.
 * Он только:
 * - находит файлы в live-директории, на которые нет ссылок в canvas JSON
 * - показывает содержимое корзины `.trash` и возраст файлов
 *
 * В будущем UI сможет:
 * - показывать список сирот при запуске
 * - предлагать удалить их “навсегда”
 * - восстанавливать из корзины
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getAttachmentTrashFilePath, getCanvasAttachmentsDirectory, getCanvasAttachmentsTrashDirectory, getCanvasFilePath } from '@/lib/paths';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Regex-валидация (anti path traversal и "только наши файлы").
const CANVAS_ID_RE = /^[a-zA-Z0-9_-]+$/;
const ATTACHMENT_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]+$/;

type OrphansResponse = {
  canvasId: string;
  referencedAttachmentIdsCount: number;
  live: {
    totalFiles: number;
    orphanAttachmentIds: string[];
  };
  trash: {
    totalFiles: number;
    items: Array<{
      attachmentId: string;
      sizeBytes: number;
      mtimeMs: number;
      ageDaysApprox: number;
    }>;
  };
  notes: string[];
};

/**
 * Считывает attachmentId, которые реально используются в canvas JSON.
 *
 * Важно:
 * - Мы берём только node.data.attachments[].attachmentId (это "истинные ссылки").
 * - excludedAttachmentIds и другие поля не считаем ссылками, потому что они не гарантируют,
 *   что файл должен существовать на диске.
 */
const readReferencedAttachmentIds = async (canvasId: string): Promise<Set<string>> => {
  const filePath = getCanvasFilePath(canvasId);
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as { nodes?: Array<{ data?: Record<string, unknown> }> };
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];

  const out = new Set<string>();
  for (const n of nodes) {
    const data = n && typeof n === 'object' ? (n.data as Record<string, unknown> | undefined) : undefined;
    const attachments = data && Array.isArray(data.attachments) ? data.attachments : [];
    for (const a of attachments) {
      if (!a || typeof a !== 'object') continue;
      const ao = a as Record<string, unknown>;
      const id = typeof ao.attachmentId === 'string' ? ao.attachmentId.trim() : '';
      if (id && ATTACHMENT_ID_RE.test(id)) out.add(id);
    }
  }
  return out;
};

/**
 * Безопасно читает директорию. Если её нет — возвращаем пустой список.
 */
const safeReadDir = async (dirPath: string): Promise<string[]> => {
  try {
    return await fs.readdir(dirPath);
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === 'ENOENT') return [];
    throw err;
  }
};

export async function GET(request: NextRequest) {
  try {
    const canvasId = String(request.nextUrl.searchParams.get('canvasId') || '').trim();
    if (!canvasId || !CANVAS_ID_RE.test(canvasId)) {
      return NextResponse.json({ error: 'Некорректный canvasId' }, { status: 400 });
    }

    const notes: string[] = [];
    notes.push('Это "диагностический" endpoint: он ничего не удаляет.');
    notes.push('Удаление файлов делается отдельным POST /api/attachments/gc (или будущим файловым менеджером).');
    notes.push('Корзина `.trash` нужна, чтобы undo/redo никогда не ломал вложения.');

    const referenced = await readReferencedAttachmentIds(canvasId).catch((err) => {
      // Если canvas JSON не читается — это серьёзнее, но мы отдаём понятную ошибку.
      // (В будущем можно вернуть { referenced: [] } и всё считать “неизвестным”.)
      throw err;
    });

    // -----------------------------
    // LIVE: data/attachments/<canvasId>/*
    // -----------------------------
    const liveDir = getCanvasAttachmentsDirectory(canvasId);
    const liveEntries = await safeReadDir(liveDir);

    // В live папке могут быть:
    // - вложения (attachmentId)
    // - attachments-index.json
    // - .trash (директория)
    const liveAttachmentIds = liveEntries
      .map((name) => String(name || '').trim())
      .filter((name) => ATTACHMENT_ID_RE.test(name));

    const orphanLive = liveAttachmentIds.filter((id) => !referenced.has(id));

    // -----------------------------
    // TRASH: data/attachments/<canvasId>/.trash/*
    // -----------------------------
    const trashDir = getCanvasAttachmentsTrashDirectory(canvasId);
    const trashEntries = await safeReadDir(trashDir);

    // Ограничим размер ответа, чтобы случайно не отдать мегабайты JSON.
    const MAX_TRASH_ITEMS = 500;
    const trashFiles = trashEntries
      .map((name) => String(name || '').trim())
      .filter((name) => ATTACHMENT_ID_RE.test(name))
      .slice(0, MAX_TRASH_ITEMS);

    const now = Date.now();
    const trashItems: OrphansResponse['trash']['items'] = [];
    for (const attachmentId of trashFiles) {
      const p = getAttachmentTrashFilePath(canvasId, attachmentId);
      try {
        const st = await fs.stat(p);
        const ageDaysApprox = Math.max(0, Math.round((now - st.mtimeMs) / (1000 * 60 * 60 * 24)));
        trashItems.push({
          attachmentId,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          ageDaysApprox,
        });
      } catch {
        // ignore: файл мог исчезнуть между readdir и stat
      }
    }

    const resp: OrphansResponse = {
      canvasId,
      referencedAttachmentIdsCount: referenced.size,
      live: {
        totalFiles: liveAttachmentIds.length,
        orphanAttachmentIds: orphanLive,
      },
      trash: {
        totalFiles: trashEntries.filter((x) => ATTACHMENT_ID_RE.test(String(x || '').trim())).length,
        items: trashItems,
      },
      notes,
    };

    return NextResponse.json(resp);
  } catch (error) {
    console.error('[Attachments Orphans API] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Не удалось собрать список сирот', details: message }, { status: 500 });
  }
}

