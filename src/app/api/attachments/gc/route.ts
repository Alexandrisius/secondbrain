/**
 * @file route.ts
 * @description "Сборщик мусора" (GC) для файлов вложений одного холста.
 *
 * Это задел под будущий файловый менеджер.
 *
 * Предпосылка:
 * - DELETE вложений в приложении — это soft-delete (перенос в `.trash`),
 *   чтобы undo/redo никогда не ломал ссылки.
 *
 * Поэтому нужен отдельный механизм для “окончательного” удаления файлов:
 * - удалить старые файлы из `.trash`
 * - (опционально) удалить "сироты" из live папки, если на них нет ссылок в canvas JSON
 *
 * Важно:
 * - Этот endpoint удаляет файлы. Поэтому он intentionally "ручной".
 * - Он не запускается автоматически.
 * - В будущем UI сможет показывать список сирот (см. /api/attachments/orphans)
 *   и вызывать GC по подтверждению пользователя.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import {
  getAttachmentFilePath,
  getAttachmentTrashFilePath,
  getCanvasAttachmentsDirectory,
  getCanvasAttachmentsTrashDirectory,
  getCanvasFilePath,
} from '@/lib/paths';
import { removeAttachmentIdsFromIndex } from '@/lib/attachmentsFs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Regex-валидация (anti path traversal и "только наши файлы").
const CANVAS_ID_RE = /^[a-zA-Z0-9_-]+$/;
const ATTACHMENT_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]+$/;

type GcRequestBody = {
  canvasId?: unknown;
  /**
   * Удалить файлы из `.trash`, которые “лежали” там дольше N дней.
   *
   * По умолчанию: 7 дней.
   */
  purgeTrashOlderThanDays?: unknown;
  /**
   * Опционально: удалить сирот из live папки (НЕ из `.trash`).
   *
   * Осторожно:
   * - это “жёстче”, чем чистка trash,
   * - рекомендуется включать только после того, как появится UI подтверждения/просмотра.
   */
  purgeLiveOrphans?: unknown;
  /**
   * Dry-run:
   * - если true, мы НИЧЕГО не удаляем, а только возвращаем план действий.
   */
  dryRun?: unknown;
};

/**
 * Считывает attachmentId, которые реально используются в canvas JSON.
 * (См. подробные комментарии в /api/attachments/orphans)
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

/**
 * Безопасно удаляет файл (идемпотентно): ENOENT считаем успехом.
 */
const safeUnlink = async (filePath: string): Promise<boolean> => {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === 'ENOENT') return false;
    throw err;
  }
};

export async function POST(request: NextRequest) {
  try {
    const body: GcRequestBody = await request.json().catch(() => ({}));

    const canvasId = String(body.canvasId || '').trim();
    if (!canvasId || !CANVAS_ID_RE.test(canvasId)) {
      return NextResponse.json({ error: 'Некорректный canvasId' }, { status: 400 });
    }

    const purgeTrashOlderThanDaysRaw = Number(body.purgeTrashOlderThanDays);
    // Default: 7 дней. Минимум: 0 (удалить всё из trash).
    const purgeTrashOlderThanDays =
      Number.isFinite(purgeTrashOlderThanDaysRaw) && purgeTrashOlderThanDaysRaw >= 0
        ? Math.floor(purgeTrashOlderThanDaysRaw)
        : 7;

    const purgeLiveOrphans = String(body.purgeLiveOrphans || '').trim().toLowerCase() === 'true';
    const dryRun = String(body.dryRun || '').trim().toLowerCase() === 'true';

    // -----------------------------
    // Считаем ссылки (истина из canvas JSON)
    // -----------------------------
    const referenced = await readReferencedAttachmentIds(canvasId);

    // -----------------------------
    // LIVE
    // -----------------------------
    const liveDir = getCanvasAttachmentsDirectory(canvasId);
    const liveEntries = await safeReadDir(liveDir);
    const liveAttachmentIds = liveEntries
      .map((name) => String(name || '').trim())
      .filter((name) => ATTACHMENT_ID_RE.test(name));
    const orphanLive = liveAttachmentIds.filter((id) => !referenced.has(id));

    // -----------------------------
    // TRASH
    // -----------------------------
    const trashDir = getCanvasAttachmentsTrashDirectory(canvasId);
    const trashEntries = await safeReadDir(trashDir);
    const trashAttachmentIds = trashEntries
      .map((name) => String(name || '').trim())
      .filter((name) => ATTACHMENT_ID_RE.test(name));

    const now = Date.now();
    const cutoffMs = now - purgeTrashOlderThanDays * 24 * 60 * 60 * 1000;

    // Выбираем, что именно удалять из trash.
    // Мы ориентируемся по mtime файла в `.trash`:
    // - file move/rename обычно оставляет mtime как "последняя модификация",
    //   а rename может менять ctime.
    // - Нам важно приближённо “как давно файл лежит в корзине”.
    // - Если в будущем понадобится точность — можно завести .trash-meta.json.
    const trashToDelete: string[] = [];
    for (const attachmentId of trashAttachmentIds) {
      const p = getAttachmentTrashFilePath(canvasId, attachmentId);
      try {
        const st = await fs.stat(p);
        if (st.mtimeMs <= cutoffMs) {
          trashToDelete.push(attachmentId);
        }
      } catch {
        // ignore: файл мог исчезнуть между readdir и stat
      }
    }

    const plan = {
      canvasId,
      referencedAttachmentIdsCount: referenced.size,
      settings: {
        purgeTrashOlderThanDays,
        purgeLiveOrphans,
        dryRun,
      },
      candidates: {
        liveOrphans: orphanLive,
        trashToDelete,
      },
    };

    if (dryRun) {
      return NextResponse.json({ success: true, dryRun: true, plan });
    }

    // -----------------------------
    // Удаляем файлы (реально)
    // -----------------------------
    const deletedFromTrash: string[] = [];
    for (const attachmentId of trashToDelete) {
      const p = getAttachmentTrashFilePath(canvasId, attachmentId);
      const deleted = await safeUnlink(p);
      if (deleted) deletedFromTrash.push(attachmentId);
    }

    const deletedFromLiveOrphans: string[] = [];
    if (purgeLiveOrphans) {
      for (const attachmentId of orphanLive) {
        const p = getAttachmentFilePath(canvasId, attachmentId);
        const deleted = await safeUnlink(p);
        if (deleted) deletedFromLiveOrphans.push(attachmentId);
      }
    }

    // -----------------------------
    // Чистим индекс (best-effort)
    // -----------------------------
    const deletedIds = [...deletedFromTrash, ...deletedFromLiveOrphans];
    const indexCleanup = await removeAttachmentIdsFromIndex(canvasId, deletedIds);

    return NextResponse.json({
      success: true,
      dryRun: false,
      plan,
      deleted: {
        trashCount: deletedFromTrash.length,
        liveOrphansCount: deletedFromLiveOrphans.length,
        trashAttachmentIds: deletedFromTrash,
        liveOrphanAttachmentIds: deletedFromLiveOrphans,
      },
      index: indexCleanup,
    });
  } catch (error) {
    console.error('[Attachments GC API] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Не удалось выполнить GC', details: message }, { status: 500 });
  }
}

