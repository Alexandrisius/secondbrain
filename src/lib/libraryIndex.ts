/**
 * @file libraryIndex.ts
 * @description Чтение/запись и операции над `library-index.json` (глобальная библиотека документов).
 *
 * Этот файл — "источник истины" по метаданным документов:
 * - где документ лежит в дереве папок,
 * - какой у него mime/size/hash,
 * - когда он обновлялся,
 * - какие быстрые/LLM-метаданные (excerpt/summary/image.description) уже вычислены.
 *
 * ВАЖНО:
 * - Файл на диске: data/library/library-index.json (см. src/lib/paths.ts).
 * - Это локальное приложение; мы используем best-effort атомарную запись JSON.
 * - Любые операции должны быть максимально “мягкими” к повреждённым данным:
 *   лучше создать пустой индекс, чем уронить весь UI.
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import {
  getLibraryDirectory,
  getLibraryFilesDirectory,
  getLibraryIndexPath,
  getLibraryTrashDirectory,
} from '@/lib/paths';
import { normalizeDocDisplayName, readJsonOrNull, writeJsonPrettyAtomic } from '@/lib/libraryFs';

// =============================================================================
// TYPES (v1)
// =============================================================================

export type LibraryFolder = {
  /** ID папки (UUID). */
  id: string;
  /** parentId === null означает "root". */
  parentId: string | null;
  /** Отображаемое имя папки. */
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type LibraryDocKind = 'image' | 'text';

export type LibraryDocAnalysis = {
  /**
   * Быстрый excerpt для текста (без LLM).
   * Нужен для превью и как fallback контекст.
   */
  excerpt?: string;

  /**
   * Суммаризация (LLM). Храним только одну, как agreed.
   * Чтобы понимать актуальность при replace, рядом держим summaryForFileHash.
   */
  summary?: string;
  summaryForFileHash?: string;

  /**
   * Анализ изображения (LLM).
   * Здесь лежит "caption-only" описание изображения.
   */
  image?: {
    description?: string;
    descriptionLanguage?: string;
  };
  imageForFileHash?: string;

  /** Когда последний раз обновлялась LLM-часть анализа (epoch ms). */
  updatedAt?: number;
  /** Какая модель использовалась для анализа (если применимо). */
  model?: string;
};

export type LibraryDoc = {
  /** Стабильный идентификатор документа: UUID + '.' + ext. */
  docId: string;

  /** Отображаемое имя (rename меняет только это). */
  name: string;

  /** folderId === null означает "root". */
  folderId: string | null;

  kind: LibraryDocKind;
  mime: string;
  sizeBytes: number;

  /**
   * “Версия файла”:
   * - при replace docId не меняется, но fileHash/fileUpdatedAt меняются
   * - по ним карточки смогут понять stale (на следующем этапе)
   */
  fileHash: string;
  fileUpdatedAt: number;
  createdAt: number;

  /** Если документ в корзине, то trashedAt установлен. */
  trashedAt?: number;

  analysis?: LibraryDocAnalysis;
};

export type LibraryIndexV1 = {
  version: 1;
  folders: LibraryFolder[];
  docs: LibraryDoc[];
};

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

const now = () => Date.now();

/**
 * Создаёт пустой индекс (v1).
 *
 * Важно:
 * - root папку мы НЕ храним явно; root = folderId:null.
 */
export function createEmptyLibraryIndex(): LibraryIndexV1 {
  return { version: 1, folders: [], docs: [] };
}

/**
 * Гарантирует, что базовые директории библиотеки существуют.
 *
 * Почему это в одном месте:
 * - чтобы каждый API route мог безопасно вызвать ensureLibraryDirectories()
 *   и не думать о том, создана ли структура на диске.
 */
export async function ensureLibraryDirectories(): Promise<void> {
  await fs.mkdir(getLibraryDirectory(), { recursive: true });
  await fs.mkdir(getLibraryFilesDirectory(), { recursive: true });
  await fs.mkdir(getLibraryTrashDirectory(), { recursive: true });
}

// =============================================================================
// READ / WRITE
// =============================================================================

/**
 * Читает library-index.json.
 *
 * Поведение:
 * - если файла нет → возвращаем пустой индекс (v1)
 * - если файл повреждён (JSON.parse упал) → пробрасываем ошибку
 *   (это сознательно, чтобы не скрыть silent corruption)
 *
 * Почему мы не "чинить автоматически":
 * - автоматическое “чинить и переписать” может потерять данные.
 * - лучше вернуть ошибку в API (500) и дать пользователю возможность восстановить файл/бэкап.
 */
export async function readLibraryIndex(): Promise<LibraryIndexV1> {
  await ensureLibraryDirectories();

  const p = getLibraryIndexPath();
  const loaded = await readJsonOrNull<LibraryIndexV1>(p);
  if (!loaded) return createEmptyLibraryIndex();

  // Минимальная валидация структуры — best-effort.
  if (loaded.version !== 1 || !Array.isArray(loaded.folders) || !Array.isArray(loaded.docs)) {
    // Не пытаемся мигрировать неизвестные версии — возвращаем пусто.
    // (Иначе можно неправильно интерпретировать структуру и потерять данные.)
    return createEmptyLibraryIndex();
  }

  return loaded;
}

/**
 * Записывает library-index.json.
 */
export async function writeLibraryIndex(index: LibraryIndexV1): Promise<void> {
  await ensureLibraryDirectories();
  await writeJsonPrettyAtomic(getLibraryIndexPath(), index);
}

// =============================================================================
// FOLDERS CRUD
// =============================================================================

/**
 * Создаёт папку.
 *
 * Важно:
 * - root не создаём как сущность; parentId:null — это root.
 */
export function createFolder(index: LibraryIndexV1, params: { name: string; parentId: string | null }): LibraryFolder {
  const ts = now();
  const folder: LibraryFolder = {
    id: crypto.randomUUID(),
    parentId: params.parentId ?? null,
    name: normalizeDocDisplayName(params.name),
    createdAt: ts,
    updatedAt: ts,
  };
  index.folders.push(folder);
  return folder;
}

export function renameFolder(index: LibraryIndexV1, folderId: string, newName: string): LibraryFolder | null {
  const f = index.folders.find((x) => x.id === folderId) || null;
  if (!f) return null;
  f.name = normalizeDocDisplayName(newName);
  f.updatedAt = now();
  return f;
}

/**
 * Удаляет папку.
 *
 * MVP-правило безопасности:
 * - удалять можно только пустую папку (без подпапок и без docs).
 * - это снижает риск “случайно потерять структуру”.
 */
export function deleteFolderIfEmpty(index: LibraryIndexV1, folderId: string): { deleted: boolean; reason?: string } {
  const hasChildFolder = index.folders.some((f) => f.parentId === folderId);
  if (hasChildFolder) return { deleted: false, reason: 'FOLDER_NOT_EMPTY_HAS_SUBFOLDERS' };

  const hasDocs = index.docs.some((d) => d.folderId === folderId && !d.trashedAt);
  if (hasDocs) return { deleted: false, reason: 'FOLDER_NOT_EMPTY_HAS_DOCS' };

  const idx = index.folders.findIndex((f) => f.id === folderId);
  if (idx === -1) return { deleted: false, reason: 'FOLDER_NOT_FOUND' };

  index.folders.splice(idx, 1);
  return { deleted: true };
}

// =============================================================================
// DOCS CRUD (metadata only; файл на диске пишет API)
// =============================================================================

export function findDoc(index: LibraryIndexV1, docId: string): LibraryDoc | null {
  return index.docs.find((d) => d.docId === docId) || null;
}

export function upsertDoc(index: LibraryIndexV1, doc: LibraryDoc): void {
  const i = index.docs.findIndex((d) => d.docId === doc.docId);
  if (i === -1) index.docs.push(doc);
  else index.docs[i] = doc;
}

export function renameDoc(index: LibraryIndexV1, docId: string, newName: string): LibraryDoc | null {
  const d = findDoc(index, docId);
  if (!d) return null;
  d.name = normalizeDocDisplayName(newName);
  return d;
}

export function moveDoc(index: LibraryIndexV1, docId: string, folderId: string | null): LibraryDoc | null {
  const d = findDoc(index, docId);
  if (!d) return null;
  d.folderId = folderId ?? null;
  return d;
}

export function trashDoc(index: LibraryIndexV1, docId: string, trashedAt: number = now()): LibraryDoc | null {
  const d = findDoc(index, docId);
  if (!d) return null;
  d.trashedAt = trashedAt;
  return d;
}

export function restoreDoc(index: LibraryIndexV1, docId: string): LibraryDoc | null {
  const d = findDoc(index, docId);
  if (!d) return null;
  delete d.trashedAt;
  return d;
}

