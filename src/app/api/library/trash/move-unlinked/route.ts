/**
 * @file route.ts
 * @description API: POST /api/library/trash/move-unlinked
 *
 * Перемещает в корзину ВСЕ "живые" документы, у которых НЕТ ссылок (unlinked).
 *
 * Зачем нужен этот endpoint:
 * - В UI есть отдельная кнопка "убрать файлы без ссылок".
 * - По требованиям продукта эта кнопка НЕ должна:
 *   - удалять файлы навсегда,
 *   - дублировать "Очистить корзину",
 *   - показывать "галочку" (checkbox) или сложный режим.
 * - Вместо этого кнопка должна:
 *   - найти все документы без ссылок,
 *   - переместить их в корзину (soft-delete),
 *   - и показать счётчик, сколько файлов будет перемещено.
 *
 * Важно про ссылки:
 * - Мы перемещаем ТОЛЬКО документы без ссылок, поэтому unlink не требуется.
 * - Источник истины "есть ли ссылка" — usage-index.json.
 * - Если usage-index устарел, пользователь может нажать "Пересчитать ссылки (usage-index)" в UI.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { getLibraryFilePath, getLibraryTrashFilePath } from '@/lib/paths';
import { ensureLibraryDirectories, readLibraryIndex, trashDoc, writeLibraryIndex } from '@/lib/libraryIndex';
import { readUsageIndex, hasAnyUsage } from '@/lib/libraryUsageIndex';

// Next.js распознаёт `runtime`/`dynamic` только как литералы в `route.ts`.
// Ре-экспорт из другого файла приводит к warning и игнорированию настройки.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort rename/move с overwrite:
 * - если target существует — удаляем его и повторяем rename
 * - если source не существует — возвращаем { moved:false, missing:true }
 *
 * Почему мы используем rename:
 * - это "атомарное перемещение" в рамках одного файлового раздела,
 * - быстрее, чем копирование + удаление.
 *
 * Почему "overwrite":
 * - в edge-case docId может уже существовать в .trash (например, пользователь вручную
 *   копировал файлы/восстанавливал), и мы не хотим падать всей операцией.
 */
async function moveFileOverwrite(from: string, to: string): Promise<{ moved: boolean; missing: boolean }> {
  try {
    await fs.rename(from, to);
    return { moved: true, missing: false };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : null;
    if (code === 'ENOENT') return { moved: false, missing: true };
    if (code === 'EEXIST' || code === 'ENOTEMPTY') {
      try {
        await fs.rm(to, { force: true });
        await fs.rename(from, to);
        return { moved: true, missing: false };
      } catch {
        // fallthrough to throw below
      }
    }
    throw err;
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    await ensureLibraryDirectories();

    // Читаем index + usage, чтобы:
    // - найти кандидатов (живые, без ссылок),
    // - и потом обновить index (trashedAt).
    const [index, usage] = await Promise.all([readLibraryIndex(), readUsageIndex()]);

    // Находим docIds, которые можно переместить:
    // - документ НЕ в корзине,
    // - и usage-index не содержит по нему ссылок.
    const candidates = index.docs.filter((d) => !d.trashedAt && !hasAnyUsage(usage, d.docId));

    if (candidates.length === 0) {
      // Нечего делать — возвращаем "успех" с нулём, чтобы UI мог спокойно отобразить.
      return NextResponse.json({ success: true, movedCount: 0, movedDocIds: [], fileMissingDocIds: [] });
    }

    const movedDocIds: string[] = [];
    const fileMissingDocIds: string[] = [];

    // Последовательно переносим файлы и помечаем документы как trashed.
    //
    // Почему последовательно:
    // - локальное приложение, объёмы обычно небольшие,
    // - проще логика и меньше риск гонок записи index.
    for (const d of candidates) {
      const docId = String(d.docId || '').trim();
      if (!docId) continue;

      const from = getLibraryFilePath(docId);
      const to = getLibraryTrashFilePath(docId);

      const moveRes = await moveFileOverwrite(from, to);
      if (moveRes.missing) fileMissingDocIds.push(docId);

      // Важно:
      // - даже если файл физически отсутствует, мы всё равно помечаем документ как trashed,
      //   чтобы UI отображал консистентное состояние индекса.
      // - это помогает "вылечить" битые ситуации (например, если файл удалили вручную).
      trashDoc(index, docId, Date.now());

      movedDocIds.push(docId);
    }

    // Записываем обновлённый library-index одним атомарным write.
    await writeLibraryIndex(index);

    return NextResponse.json({
      success: true,
      movedCount: movedDocIds.length,
      movedDocIds,
      fileMissingDocIds,
    });
  } catch (error) {
    console.error('[Library API] POST /api/library/trash/move-unlinked error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'Не удалось переместить документы без ссылок в корзину', details: message }, { status: 500 });
  }
}

