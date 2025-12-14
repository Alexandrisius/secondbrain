/**
 * @file attachmentsIndex.ts
 * @description Безопасные helper-функции для работы с `attachments-index.json` (индексом файлов холста).
 *
 * Почему этот модуль появился:
 * - Раньше логика чтения/записи индекса жила внутри `/api/attachments` (upload).
 * - Теперь индекс нужен в нескольких местах:
 *   - upload: записать метаданные файла (hash/size/mime/kind) и быстрый excerpt
 *   - on-demand анализ: дописывать LLM-атрибуты (summary / image description) в фоне
 * - Поэтому мы выносим эту логику в общую библиотеку, чтобы:
 *   1) не дублировать код,
 *   2) гарантировать одинаковые правила миграции (v1 → v2),
 *   3) централизованно держать формат и комментарии.
 *
 * Важно про безопасность:
 * - Этот модуль НЕ валидирует canvasId (anti path traversal).
 * - Валидация (regex) должна быть в API-роутах ДО вызова функций здесь.
 */

import { promises as fs } from 'fs';
import {
  getCanvasAttachmentsDirectory,
  getCanvasAttachmentsIndexPath,
} from '@/lib/paths';
import type { AttachmentKind, AttachmentIngestionMode } from '@/types/canvas';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Индекс вложений одного холста (на диске).
 *
 * Задача индекса:
 * - upsert по имени файла (nameKey): если загружают файл с тем же именем — обновляем существующий
 * - хранение "версии" файла: fileHash/fileUpdatedAt
 * - хранение результата анализа (excerpt/summary/описание изображения) на уровне файла холста
 *
 * Важно:
 * - ключом служит nameKey (lowercase исходного имени)
 * - значением — attachmentId (UUID + ext) + мета "версии"
 */
export type CanvasAttachmentsIndex = {
  version: 2;
  byNameKey: Record<
    string,
    {
      attachmentId: string;
      fileCreatedAt: number;
      fileUpdatedAt: number;
      fileHash: string;

      // Доп. мета для UX/файлового менеджера
      kind?: AttachmentKind;
      mime?: string;
      sizeBytes?: number;
      ingestionMode?: AttachmentIngestionMode;

      // =====================================================================
      // РЕЗУЛЬТАТЫ ОБРАБОТКИ ФАЙЛА
      // =====================================================================
      //
      // Ключевой принцип:
      // - "дешёвые" метаданные (excerpt) можно считать при upload
      // - "дорогие" метаданные (summary, описание изображения) считаются лениво (on-demand)
      //   и должны храниться здесь, единоразово на уровне файла холста
      analysis?: {
        /** Быстрый excerpt для текстовых файлов (fallback для потомков). */
        excerpt?: string;

        /** Суммаризация текста (2–3 предложения). */
        summary?: string;

        /**
         * Метаданные изображения (vision).
         *
         * ВАЖНОЕ ПОВЕДЕНИЕ (по решению продукта):
         * - Мы НЕ храним отдельный OCR-слой как отдельное поле/артефакт.
         * - Мы храним только единый текст `description`, который:
         *   - пригоден для контекста потомков/предков,
         *   - НЕ содержит дословных цитат текста с изображения,
         *   - НЕ переписывает код/логи из скриншотов, а объясняет смысл.
         *
         * Почему не OCR:
         * - цель: дать LLM “понять контекст картинки” в текстовой форме,
         *   а не обеспечить копирование/поиск по тексту на изображении.
         */
        image?: {
          /**
           * Главный текстовый артефакт: подробное описание изображения.
           *
           * Требования:
           * - Plain text, без маркеров, без code blocks, без списков (по возможности).
           * - НЕ цитировать текст с изображения дословно (включая код).
           * - Если на изображении есть текст, то в описание включается только СМЫСЛ текста.
           */
          description?: string;

          /**
           * Язык, на котором сгенерировано description.
           *
           * Ключевое правило:
           * - описание генерируется ОДИН раз “на файл” (per attachmentId/fileHash),
           * - язык фиксируется по ПЕРВОМУ запросу, который впервые потребовал анализ этого изображения.
           *
           * Почему так:
           * - мы двигаемся к файловому менеджеру: карточки лишь “ссылаются” на единый файл и его метаданные.
           * - перевод/мультиязычность можно добавить позже как отдельный слой.
           */
          descriptionLanguage?: string;

          // -------------------------------------------------------------------
          // LEGACY ПОЛЯ (backward-compat)
          // -------------------------------------------------------------------
          //
          // Раньше мы хранили OCR+Описание в combined/caption.
          // Эти поля могут быть в старых данных и мы их НЕ ломаем.
          // Новый код должен писать в `description`, а эти поля рассматривать как fallback.
          combined?: string;
          caption?: string;
        };

        /**
         * "К какой версии файла относится summary".
         *
         * Почему отдельное поле:
         * - `attachmentId` может быть стабильным при upsert по имени
         * - значит файл может поменяться, а summary остаться от прошлой версии
         * - по fileHash мы можем понять, актуальна ли суммаризация
         */
        summaryForFileHash?: string;

        /**
         * "К какой версии файла относится image description".
         *
         * Исторически поле называлось `imageForFileHash` и относилось к OCR+caption.
         * Мы оставляем название без изменения ради совместимости формата индекса:
         * - переименование поля = миграция и больше рисков.
         * - семантика теперь: “к какой версии файла относится image.description”.
         */
        imageForFileHash?: string;

        /** Когда последний раз пересчитывали LLM-часть анализа (epoch ms). */
        updatedAt?: number;

        /** Какая модель использовалась для LLM-анализа (если применимо). */
        model?: string;
      };
    }
  >;
};

// =============================================================================
// BACKWARD-COMPAT NORMALIZATION (v2-in-memory)
// =============================================================================
//
// Важно:
// - Мы НЕ переписываем файл индекса автоматически при чтении.
// - Но мы хотим, чтобы весь остальной код мог опираться на единый “канонический” вид:
//   `analysis.image.description` вместо старых `caption/combined`.
// - Поэтому при read() мы делаем best-effort нормализацию В ПАМЯТИ:
//   - caption -> description
//   - combined -> description (если удаётся извлечь описание безопасно)
//
// Это снижает количество условностей в коде API/клиента и уменьшает риск “сломанного контекста”
// при смешанных данных (старые холсты + новая логика).

/**
 * Best-effort: извлекает человекочитаемое описание из legacy `combined`.
 *
 * Исторический формат combined был:
 * - "OCR:\n...\n\nОписание:\n..."
 *
 * Проблема:
 * - combined иногда содержит OCR (который мы не хотим “тащить” потомкам),
 * - combined иногда вообще не содержит “Описание:” (модель нарушила формат),
 * - combined мог быть уже “чистым описанием”.
 *
 * Решение (best-effort):
 * - если видим явный маркер описания — берём текст после него
 * - иначе:
 *   - если видим OCR-маркеры — НЕ берём весь текст (чтобы не утечь OCR)
 *   - если OCR-маркеров нет — считаем, что это уже описание
 */
const extractDescriptionFromLegacyCombined = (combined: string): string => {
  const text = String(combined || '').trim();
  if (!text) return '';

  // Маркеры “описания” — поддерживаем и старый RU вариант, и экспериментальные варианты.
  const descMarkers = [
    /(^|\n)Описание:\s*/i,
    /(^|\n)DESCRIPTION:\s*/i,
    /(^|\n)DESCRIPTION_TEXT:\s*/i,
  ];

  for (const marker of descMarkers) {
    const idx = text.search(marker);
    if (idx !== -1) {
      const extracted = text.slice(idx).replace(marker, '').trim();
      return extracted;
    }
  }

  // Если нет явного маркера описания, но есть OCR-маркеры — безопаснее вернуть пусто,
  // чем протащить OCR/текст изображения как “описание”.
  const hasOcrMarkers = /(^|\n)\s*OCR(_TEXT)?:/i.test(text) || text.toLowerCase().includes('ocr:');
  if (hasOcrMarkers) return '';

  // Иначе считаем, что combined уже является описанием.
  return text;
};

/**
 * Нормализует v2 индекс в памяти (без записи на диск).
 */
const normalizeIndexV2InMemory = (index: CanvasAttachmentsIndex): void => {
  // Максимально “мягко”: если структура неожиданная, просто не трогаем.
  if (!index || index.version !== 2 || !index.byNameKey || typeof index.byNameKey !== 'object') return;

  for (const entry of Object.values(index.byNameKey)) {
    if (!entry || typeof entry !== 'object') continue;
    const analysis = entry.analysis;
    if (!analysis || typeof analysis !== 'object') continue;
    const image = analysis.image;
    if (!image || typeof image !== 'object') continue;

    // 1) Если новый description уже есть — всё ок.
    if (typeof image.description === 'string' && image.description.trim()) continue;

    // 2) caption -> description (старое поле).
    if (typeof image.caption === 'string' && image.caption.trim()) {
      image.description = image.caption.trim();
      continue;
    }

    // 3) combined -> description (best-effort).
    if (typeof image.combined === 'string' && image.combined.trim()) {
      const extracted = extractDescriptionFromLegacyCombined(image.combined);
      if (extracted) {
        image.description = extracted;
      }
    }
  }
};

// =============================================================================
// READ / WRITE
// =============================================================================

/**
 * Читает attachments-index.json (v2) для данного холста.
 *
 * Поддержка старого формата:
 * - v1: { version: 1, byNameKey: { nameKey: { attachmentId, fileCreatedAt, fileUpdatedAt, fileHash } } }
 * - v2: { version: 2, byNameKey: { nameKey: { ... + kind/mime/size/analysis } } }
 *
 * Поведение при ошибках:
 * - ENOENT (файла нет) → возвращаем пустой индекс v2
 * - формат повреждён/неожиданен → тоже возвращаем пустой индекс v2 (best-effort)
 */
export async function readCanvasAttachmentsIndex(canvasId: string): Promise<CanvasAttachmentsIndex> {
  const indexPath = getCanvasAttachmentsIndexPath(canvasId);

  try {
    const raw = await fs.readFile(indexPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown; byNameKey?: unknown };

    // Уже новый формат (v2)
    if (parsed && parsed.version === 2 && parsed.byNameKey && typeof parsed.byNameKey === 'object') {
      const index: CanvasAttachmentsIndex = {
        version: 2,
        byNameKey: parsed.byNameKey as CanvasAttachmentsIndex['byNameKey'],
      };
      // Best-effort: приводим legacy поля к новому канону в памяти.
      normalizeIndexV2InMemory(index);
      return index;
    }

    // Старый формат (v1) — апгрейдим "на лету" (best-effort).
    if (parsed && parsed.version === 1 && parsed.byNameKey && typeof parsed.byNameKey === 'object') {
      const v1 = parsed.byNameKey as Record<
        string,
        { attachmentId: string; fileCreatedAt: number; fileUpdatedAt: number; fileHash: string }
      >;

      const upgraded: CanvasAttachmentsIndex['byNameKey'] = {};
      for (const [nameKey, entry] of Object.entries(v1)) {
        if (!entry || typeof entry !== 'object') continue;
        if (!entry.attachmentId || typeof entry.attachmentId !== 'string') continue;

        upgraded[nameKey] = {
          attachmentId: entry.attachmentId,
          fileCreatedAt: typeof entry.fileCreatedAt === 'number' ? entry.fileCreatedAt : Date.now(),
          fileUpdatedAt: typeof entry.fileUpdatedAt === 'number' ? entry.fileUpdatedAt : Date.now(),
          fileHash: typeof entry.fileHash === 'string' ? entry.fileHash : '',
        };
      }

      return { version: 2, byNameKey: upgraded };
    }

    // Если формат не тот — не падаем, а начинаем новый индекс (best-effort).
    return { version: 2, byNameKey: {} };
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code)
        : null;
    if (code === 'ENOENT') return { version: 2, byNameKey: {} };
    throw err;
  }
}

/**
 * Пишет индекс на диск.
 *
 * Важно:
 * - гарантируем, что папка data/attachments/<canvasId>/ существует
 * - формат JSON pretty (2 пробела) для удобства дебага
 */
export async function writeCanvasAttachmentsIndex(canvasId: string, index: CanvasAttachmentsIndex): Promise<void> {
  const indexPath = getCanvasAttachmentsIndexPath(canvasId);
  await fs.mkdir(getCanvasAttachmentsDirectory(canvasId), { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

// =============================================================================
// LOOKUPS
// =============================================================================

/**
 * Находит entry индекса по attachmentId.
 *
 * Почему это не O(1):
 * - индекс организован по имени файла (nameKey), потому что продуктовая логика — "upsert по имени".
 * - обратный индекс attachmentId → entry мы пока не храним, чтобы не усложнять формат.
 *
 * Это нормально для MVP:
 * - byNameKey обычно небольшой
 * - analyze запускается по небольшому числу attachmentId (вложения одной карточки)
 */
export function findEntryByAttachmentId(
  index: CanvasAttachmentsIndex,
  attachmentId: string
): { nameKey: string; entry: CanvasAttachmentsIndex['byNameKey'][string] } | null {
  const id = String(attachmentId || '').trim();
  if (!id) return null;

  for (const [nameKey, entry] of Object.entries(index.byNameKey || {})) {
    if (entry?.attachmentId === id) {
      return { nameKey, entry };
    }
  }
  return null;
}

