/**
 * @file route.ts
 * @description Preflight API для загрузки вложений.
 *
 * Зачем нужен этот endpoint:
 * - На холсте действует правило "файлового менеджера":
 *   - файл один на холст (по имени, с дедупликацией),
 *   - карточки хранят только ссылки (attachmentId).
 *
 * Новая продуктовая логика (улучшение UX):
 * - Раньше мы показывали диалог "Заменить?" просто по совпадению имени.
 * - Теперь мы хотим показывать диалог ТОЛЬКО если файл ДЕЙСТВИТЕЛЬНО ДРУГОЙ
 *   (содержимое изменилось → SHA-256 отличается).
 * - Если файл идентичен (SHA-256 совпал), то его НЕ нужно загружать повторно —
 *   достаточно прикрепить существующий attachmentId к карточке (attach-only).
 *
 * Эта ручка:
 * - получает canvasId и:
 *   - (legacy) список имён файлов `names[]` → возвращает конфликты "по имени" (как раньше)
 *   - (новый режим) список `files[]` с `name + sha256` → возвращает:
 *     - `attachable[]`: какие файлы уже есть и ИДЕНТИЧНЫ по контенту
 *     - `conflicts[]`: какие файлы уже есть, но ОТЛИЧАЮТСЯ по контенту (нужен выбор: заменить/переименовать)
 *     - `analysis`: кеш excerpt/summary/описаний изображений для `attachable[]`
 *
 * Важно:
 * - Мы проверяем именно "ключ имени" (case-insensitive, без управляющих символов),
 *   чтобы поведение было одинаковым на Windows/macOS/Linux.
 * - Это "preflight": никаких изменений на диске здесь не происходит.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { readCanvasAttachmentsIndex } from '@/lib/attachmentsIndex';
import { readAttachmentFile } from '@/lib/attachmentsFs';
import type { NodeAttachment } from '@/types/canvas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Regex-валидация (anti path traversal)
const CANVAS_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Возвращает “безопасное” имя для отображения/сравнения:
 * - trim
 * - удаление управляющих символов
 * - ограничение длины
 */
const normalizeOriginalName = (name: string): string => {
  const trimmed = (name || '').trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed || 'file';
};

/** Нормализованный ключ имени файла (для сравнения "одинаковых" имён). */
const normalizeNameKey = (originalName: string): string => {
  return normalizeOriginalName(originalName).toLowerCase();
};

/**
 * Проверка SHA-256 (hex).
 *
 * ВАЖНО:
 * - Мы НЕ пытаемся быть супер-строгими по регистру: приводим к lower-case.
 * - Если формат неверный — считаем sha256 "неизвестным" и не делаем attach-only.
 */
const normalizeSha256Hex = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (!/^[0-9a-f]{64}$/.test(s)) return null;
  return s;
};

/**
 * Best-effort: получить "фактический" хэш существующего файла.
 *
 * Зачем это нужно:
 * - старые индексы/повреждённые данные могут иметь пустой fileHash
 * - но пользователю всё равно хочется корректного UX "спросить только при изменении"
 *
 * Поведение:
 * - если не смогли прочитать файл (ENOENT и т.п.) → возвращаем null (тогда attach-only невозможен)
 */
const tryComputeExistingSha256Hex = async (canvasId: string, attachmentId: string): Promise<string | null> => {
  try {
    const { buf } = await readAttachmentFile(canvasId, attachmentId);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      canvasId?: unknown;
      /**
       * Legacy режим: UI отправляет только имена.
       * Мы возвращаем "конфликты по имени" (поведение как раньше).
       */
      names?: unknown;
      /**
       * Новый режим: UI отправляет (name + sha256) для каждого файла.
       * Тогда мы можем отличить "тот же файл" от "новая версия".
       */
      files?: unknown;
    };

    const canvasId = String(body.canvasId || '').trim();
    if (!canvasId || !CANVAS_ID_RE.test(canvasId)) {
      return NextResponse.json({ error: 'Некорректный canvasId' }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // 1) Нормализуем вход: files[] (новый режим) или names[] (legacy)
    // -------------------------------------------------------------------------
    type Incoming = { originalName: string; nameKey: string; sha256: string | null };
    const incoming: Incoming[] = [];

    const filesRaw = Array.isArray(body.files) ? body.files : null;
    if (filesRaw && filesRaw.length > 0) {
      for (const f of filesRaw) {
        if (!f || typeof f !== 'object') continue;
        const o = f as Record<string, unknown>;
        const originalName = normalizeOriginalName(typeof o.name === 'string' ? o.name : '');
        if (!originalName) continue;
        incoming.push({
          originalName,
          nameKey: normalizeNameKey(originalName),
          sha256: normalizeSha256Hex(o.sha256),
        });
      }
    } else {
      const namesRaw = Array.isArray(body.names) ? body.names : [];
      const names = namesRaw
        .filter((n): n is string => typeof n === 'string')
        .map((n) => normalizeOriginalName(n))
        .filter(Boolean);
      for (const originalName of names) {
        incoming.push({ originalName, nameKey: normalizeNameKey(originalName), sha256: null });
      }
    }

    if (incoming.length === 0) {
      return NextResponse.json({
        conflicts: [],
        attachable: [],
        analysis: { attachmentExcerpts: {}, attachmentSummaries: {}, attachmentImageDescriptions: {} },
      });
    }

    // -------------------------------------------------------------------------
    // 2) Читаем индекс (v1 → v2 поддержан) и классифицируем результаты
    // -------------------------------------------------------------------------
    //
    // Важно:
    // - Если индекс недоступен/повреждён, readCanvasAttachmentsIndex может бросить.
    // - Это ОК: лучше вернуть 500, чем случайно сделать "тихую замену".
    const index = await readCanvasAttachmentsIndex(canvasId);

    const conflicts: Array<{ originalName: string; attachmentId: string }> = [];
    const attachable: NodeAttachment[] = [];

    // Метаданные анализа вернём картами по attachmentId, чтобы UI мог сразу обновить кеш.
    const attachmentExcerpts: Record<string, string> = {};
    const attachmentSummaries: Record<string, string> = {};
    const attachmentImageDescriptions: Record<string, string> = {};

    for (const item of incoming) {
      const entry = index.byNameKey[item.nameKey];
      if (!entry?.attachmentId) continue;

      // Legacy режим (names[]) — не знаем SHA-256 входного файла → считаем конфликтом "по имени".
      if (!item.sha256) {
        conflicts.push({ originalName: item.originalName, attachmentId: entry.attachmentId });
        continue;
      }

      // Сравниваем хэши.
      // Если в индексе пусто (редкий кейс) — пытаемся посчитать хэш существующего файла.
      const existingHash =
        entry.fileHash && typeof entry.fileHash === 'string' && entry.fileHash.trim()
          ? entry.fileHash.trim().toLowerCase()
          : (await tryComputeExistingSha256Hex(canvasId, entry.attachmentId));

      // Если не удалось понять "существующий хэш" — безопаснее считать конфликтом:
      // пользователь всё равно сможет решить (заменить/переименовать).
      if (!existingHash) {
        conflicts.push({ originalName: item.originalName, attachmentId: entry.attachmentId });
        continue;
      }

      // 1) Идентичный файл: attach-only (без upload байт).
      if (existingHash === item.sha256) {
        // Мы обязаны вернуть полноценный NodeAttachment, потому что UI хранит именно метаданные на ноде.
        //
        // Важно:
        // - originalName берём от пользователя (после sanitize): это то, что он ожидал увидеть в UI.
        // - createdAt — это fileCreatedAt (история файла на холсте).
        // - fileHash/fileUpdatedAt нужны для stale/версий.
        attachable.push({
          attachmentId: entry.attachmentId,
          kind: (entry.kind as NodeAttachment['kind']) || 'text',
          originalName: item.originalName,
          mime: String(entry.mime || 'application/octet-stream'),
          sizeBytes: typeof entry.sizeBytes === 'number' ? entry.sizeBytes : 0,
          createdAt: typeof entry.fileCreatedAt === 'number' ? entry.fileCreatedAt : Date.now(),
          ingestionMode: (entry.ingestionMode as NodeAttachment['ingestionMode']) || 'inline',
          fileHash: existingHash,
          fileUpdatedAt: typeof entry.fileUpdatedAt === 'number' ? entry.fileUpdatedAt : undefined,
        });

        // Также возвращаем "быстрый кеш" анализа (если есть), чтобы UI мог сразу показать excerpt/summary/описание.
        const analysis = entry.analysis || undefined;
        if (analysis?.excerpt && typeof analysis.excerpt === 'string') {
          attachmentExcerpts[entry.attachmentId] = analysis.excerpt;
        }
        if (analysis?.summary && typeof analysis.summary === 'string') {
          attachmentSummaries[entry.attachmentId] = analysis.summary;
        }

        // Для изображений встречаются разные исторические форматы:
        // - combined (OCR + Описание) — старый формат
        // - caption/description — новый формат (description-only)
        const img = analysis?.image;
        const imgText =
          (img && typeof img.combined === 'string' && img.combined.trim()) ||
          (img && typeof img.caption === 'string' && img.caption.trim()) ||
          (img && typeof (img as Record<string, unknown>).description === 'string' && String((img as Record<string, unknown>).description).trim()) ||
          '';
        if (imgText) {
          attachmentImageDescriptions[entry.attachmentId] = imgText;
        }

        continue;
      }

      // 2) Имя совпало, но контент отличается: реальный конфликт.
      conflicts.push({ originalName: item.originalName, attachmentId: entry.attachmentId });
    }

    return NextResponse.json({
      conflicts,
      attachable,
      analysis: {
        attachmentExcerpts,
        attachmentSummaries,
        attachmentImageDescriptions,
      },
    });
  } catch (error) {
    console.error('[Attachments Preflight API] error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Не удалось выполнить preflight', details: message },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

