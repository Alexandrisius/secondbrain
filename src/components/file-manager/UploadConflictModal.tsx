'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { UploadConflict } from '@/store/useLibraryStore';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

interface UploadConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: UploadConflict[];
  onApply: (actions: ConflictAction[]) => void;
}

/**
 * Стратегии разрешения конфликта имён:
 * - replace: заменить существующий документ (docId не меняется)
 * - uploadAsNew: загрузить как новый документ под новым именем (новый docId)
 * - skip: пропустить этот файл
 */
export type ConflictStrategy = 'replace' | 'uploadAsNew' | 'skip';

export type ConflictAction = {
  /**
   * Файл, который пользователь пытается загрузить.
   *
   * Важно:
   * - этот File объект будет либо отправлен на replace (multipart),
   * - либо будет переименован (new File([...], newName)) и отправлен на upload.
   */
  file: File;
  /**
   * target docId для replace.
   *
   * Обязателен только если strategy === 'replace'.
   * Если совпадений несколько (редкий кейс), пользователь выбирает конкретный docId в UI.
   */
  existingDocId?: string;
  strategy: ConflictStrategy;
  /**
   * Новое имя для upload-as-new (только если strategy === 'uploadAsNew').
   *
   * Важно:
   * - имя будет использовано в FormData и попадёт в `doc.name`,
   * - сервер сам создаст новый docId и сохранит файл.
   */
  newName?: string;
};

export function UploadConflictModal({
  isOpen,
  onClose,
  conflicts,
  onApply,
}: UploadConflictModalProps) {
  // Локализация: конфликт-диалог — часть File Manager, поэтому берём ключи из fileManager.conflicts.
  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager.conflicts : en.fileManager.conflicts;
  const c = language === 'ru' ? ru.common : en.common;
  /**
   * Внутренний ключ строки конфликта.
   *
   * Почему не используем file.name:
   * - пользователь может выбрать два файла с одинаковым именем (редко, но возможно),
   * - тогда file.name перестаёт быть уникальным ключом.
   *
   * Поэтому используем индекс + имя для стабильности.
   */
  const makeRowKey = (idx: number, name: string) => `${idx}:${name}`;

  // strategy по каждой строке конфликта
  const [strategies, setStrategies] = React.useState<Record<string, ConflictStrategy>>({});
  // выбранный target docId (когда strategy === 'replace')
  const [selectedDocId, setSelectedDocId] = React.useState<Record<string, string>>({});
  // введённое новое имя (когда strategy === 'uploadAsNew')
  const [newNames, setNewNames] = React.useState<Record<string, string>>({});

  /**
   * Автогенерация "безопасного" нового имени (simple heuristic).
   *
   * Важно:
   * - мы НЕ проверяем здесь, что имя 100% уникально, т.к. это требует второго preflight,
   *   а UX будет усложнён. Наша цель — дать пользователю хороший стартовый вариант.
   */
  const suggestNewName = (fileName: string) => {
    const raw = String(fileName || '').trim();
    // Важно: даже для пустого имени даём “разумный” fallback,
    // чтобы UI не показывал пустую строку.
    if (!raw) return `${t.defaultFileBaseName} ${t.copySuffix}`;
    const lastDot = raw.lastIndexOf('.');
    if (lastDot > 0 && lastDot < raw.length - 1) {
      const base = raw.slice(0, lastDot);
      const ext = raw.slice(lastDot + 1);
      return `${base} ${t.copySuffix}.${ext}`;
    }
    return `${raw} ${t.copySuffix}`;
  };

  // Инициализация state при открытии модалки
  React.useEffect(() => {
    if (isOpen) {
      const init: Record<string, ConflictStrategy> = {};
      const initSelected: Record<string, string> = {};
      const initNames: Record<string, string> = {};

      conflicts.forEach((c, idx) => {
        const key = makeRowKey(idx, c.file.name);
        // По умолчанию — replace (как в плане: "по умолчанию заменить")
        init[key] = 'replace';
        // По умолчанию выбираем первого кандидата (если есть)
        const first = c.candidates?.[0]?.docId;
        if (first) initSelected[key] = first;
        // Предзаполняем новое имя на случай "upload as new"
        initNames[key] = suggestNewName(c.file.name);
      });

      setStrategies(init);
      setSelectedDocId(initSelected);
      setNewNames(initNames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conflicts]);

  const handleStrategyChange = (rowKey: string, strategy: ConflictStrategy) => {
    setStrategies((prev) => ({ ...prev, [rowKey]: strategy }));
  };

  const handleApply = () => {
    const actions: ConflictAction[] = [];

    conflicts.forEach((c, idx) => {
      const rowKey = makeRowKey(idx, c.file.name);
      const strategy = strategies[rowKey] || 'replace';

      if (strategy === 'skip') return;

      if (strategy === 'replace') {
        const docId = selectedDocId[rowKey] || c.candidates?.[0]?.docId || '';
        // Если почему-то docId пустой (поломанные данные) — безопасно пропускаем.
        if (!docId) return;
        actions.push({ file: c.file, strategy, existingDocId: docId });
        return;
      }

      // uploadAsNew
      const nm = String(newNames[rowKey] || '').trim();
      actions.push({ file: c.file, strategy, newName: nm || undefined });
    });

    onApply(actions);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {t.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-2">
          {conflicts.map((c, idx) => {
            const rowKey = makeRowKey(idx, c.file.name);
            const strategy = strategies[rowKey] || 'replace';
            const firstCandidate = c.candidates?.[0] || null;
            const currentDocId = selectedDocId[rowKey] || firstCandidate?.docId || '';
            const currentNewName = newNames[rowKey] || '';

            // Для иконки/визуала берём kind первого кандидата (лучшее, что можно сделать без доп. API).
            const kind = firstCandidate?.kind;

            return (
              <div key={rowKey} className="p-3 border rounded-lg bg-card/50 space-y-2">
                {/* Верхняя строка: имя файла + краткая инфа по существующему документу */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 overflow-hidden flex-1">
                    {kind === 'image' ? (
                      <ImageIcon className="w-8 h-8 text-blue-400 shrink-0" />
                    ) : (
                      <FileText className="w-8 h-8 text-gray-400 shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-medium text-sm" title={c.file.name}>
                        {c.file.name}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {t.matchesInFolder.replace(
                          '{count}',
                          String(Array.isArray(c.candidates) ? c.candidates.length : 0)
                        )}
                        {firstCandidate
                          ? ` • ${Math.round((firstCandidate.sizeBytes || 0) / 1024)} KB • ${
                              firstCandidate.fileUpdatedAt
                                ? new Date(firstCandidate.fileUpdatedAt).toLocaleDateString()
                                : new Date(firstCandidate.createdAt).toLocaleDateString()
                            }`
                          : ''}
                      </span>
                    </div>
                  </div>

                  {/* Кнопки стратегий */}
                  <div className="flex gap-1 shrink-0 bg-muted/50 p-1 rounded-md">
                    <Button
                      variant={strategy === 'replace' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleStrategyChange(rowKey, 'replace')}
                    >
                      {t.strategyReplace}
                    </Button>
                    <Button
                      variant={strategy === 'uploadAsNew' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleStrategyChange(rowKey, 'uploadAsNew')}
                    >
                      {t.strategyUploadAsNew}
                    </Button>
                    <Button
                      variant={strategy === 'skip' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleStrategyChange(rowKey, 'skip')}
                    >
                      {t.strategySkip}
                    </Button>
                  </div>
                </div>

                {/* Детали стратегии */}
                {strategy === 'replace' && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>{t.replaceHint}</div>

                    {/* Если кандидатов несколько — дадим выбрать конкретный docId */}
                    {Array.isArray(c.candidates) && c.candidates.length > 1 && (
                      <div className="flex items-center gap-2">
                        <span className="shrink-0">{t.replaceTarget}</span>
                        <select
                          className="h-8 px-2 rounded-md border bg-background text-xs"
                          value={currentDocId}
                          onChange={(e) => setSelectedDocId((prev) => ({ ...prev, [rowKey]: e.target.value }))}
                        >
                          {c.candidates.map((cand) => (
                            <option key={cand.docId} value={cand.docId}>
                              {cand.name} — {cand.docId}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {strategy === 'uploadAsNew' && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>{t.uploadAsNewHint}</div>
                    <input
                      className="w-full h-8 px-2 rounded-md border bg-background text-xs"
                      value={currentNewName}
                      onChange={(e) => setNewNames((prev) => ({ ...prev, [rowKey]: e.target.value }))}
                      placeholder={t.newNamePlaceholder.replace('{example}', `report ${t.copySuffix}.md`)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            {c.cancel}
          </Button>
          <Button onClick={handleApply}>{t.apply}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
