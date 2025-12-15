import React, { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLibraryStore, UploadConflict } from '@/store/useLibraryStore';
import { UploadConflictModal, ConflictAction } from './UploadConflictModal';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ru } from '@/lib/i18n/ru';
import { en } from '@/lib/i18n/en';

interface UploadZoneProps {
  /**
   * В какую папку загружать новые документы.
   *
   * Семантика:
   * - null/undefined → корень
   * - string → конкретная folderId
   *
   * Почему это нужно:
   * - в менеджере есть дерево папок,
   * - пользователю естественно "выделить папку и загрузить туда".
   *
   * Важно:
   * - На вкладке "Корзина" загрузка блокируется полностью (см. activeTab check).
   */
  targetFolderId?: string | null;
}

export function UploadZone({ targetFolderId = null }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { upload, activeTab, checkUploadConflicts, replace } = useLibraryStore();
  const language = useSettingsStore((s) => s.language);
  const t = language === 'ru' ? ru.fileManager : en.fileManager;

  const [conflicts, setConflicts] = useState<UploadConflict[]>([]);
  const [safeFiles, setSafeFiles] = useState<File[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  /**
   * Единая точка входа для upload с проверкой конфликтов.
   */
  const processUpload = useCallback(
    async (files: File[]) => {
    if (activeTab === 'trash') return;
    
    // 1. Проверяем конфликты
    const { conflicts: foundConflicts, safe } = await checkUploadConflicts(files, targetFolderId);
    
    if (foundConflicts.length > 0) {
      setConflicts(foundConflicts);
      setSafeFiles(safe);
      setIsModalOpen(true);
    } else {
      // Конфликтов нет — грузим всё сразу
      await upload(files, { folderId: targetFolderId });
    }
    },
    [activeTab, checkUploadConflicts, targetFolderId, upload]
  );

  /**
   * Применение решений пользователя по конфликтам.
   *
   * Важно:
   * - replace делаем последовательно (без параллельности), чтобы:
   *   - уменьшить шанс гонок на сервере,
   *   - и держать UX более предсказуемым.
   * - upload-as-new можно батчить в один upload.
   */
  const handleApplyConflicts = useCallback(
    async (actions: ConflictAction[]) => {
      // 1) Replace (последовательно)
      const replacements = actions.filter((a) => a.strategy === 'replace');
      for (const r of replacements) {
        const docId = String(r.existingDocId || '').trim();
        if (!docId) continue;
        await replace(docId, r.file);
      }

      // 2) Upload-as-new (переименовываем File объект)
      const uploadAsNew = actions.filter((a) => a.strategy === 'uploadAsNew');
      const renamedFiles = uploadAsNew.map((r) => {
        const newName = String(r.newName || '').trim() || r.file.name;
        // Создаём новый File с новым именем.
        // Важно:
        // - это не копирует файл “на диск”, это просто новый JS-объект с теми же байтами,
        // - FormData возьмёт именно `file.name`, что и нужно для server-side normalizeDocDisplayName().
        return new File([r.file], newName, { type: r.file.type });
      });

      // 3) Upload safe + renamed батчом
      const toUpload = [...safeFiles, ...renamedFiles];
      if (toUpload.length > 0) {
        await upload(toUpload, { folderId: targetFolderId });
      }

      // 4) Чистим состояние модалки
      setConflicts([]);
      setSafeFiles([]);
      setIsModalOpen(false);
    },
    [replace, safeFiles, upload, targetFolderId]
  );

  /**
   * Открывает системный file picker.
   *
   * Важно:
   * - Мы блокируем upload на вкладке "Корзина", чтобы UX был понятнее:
   *   корзина — место для восстановления/удаления, а не для добавления.
   */
  const handlePick = useCallback(() => {
    if (activeTab === 'trash') return;
    inputRef.current?.click();
  }, [activeTab]);

  /**
   * Обработка выбора файлов через input[type=file].
   */
  const handleInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list || list.length === 0) return;
      await processUpload(Array.from(list));
      // Сбрасываем value, чтобы выбор тех же файлов снова триггерил change.
      e.target.value = '';
    },
    [processUpload]
  );

  /**
   * Drag&Drop upload (MVP).
   *
   * Важно:
   * - Здесь мы принимаем "всё, что браузер дал" как FileList.
   * - Сервер (/api/library/upload) сам решит, что поддерживается.
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeTab === 'trash') return;

      const list = e.dataTransfer.files;
      if (!list || list.length === 0) return;
      await processUpload(Array.from(list));
    },
    [activeTab, processUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  return (
    <>
      <div
        onClick={handlePick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={cn(
        "relative mx-3 mb-3 p-4 rounded-xl",
        "border-2 border-dashed border-[#313244]",
        "bg-[#181825]/30 hover:bg-[#181825]/50 hover:border-[#89b4fa]/40",
        "flex flex-col items-center justify-center gap-2",
        "cursor-pointer transition-all duration-200 group"
      )}
      >
        {/* Скрытый input для выбора файлов. */}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleInputChange}
        />

        <div className="p-2 rounded-full bg-[#313244]/50 group-hover:bg-[#89b4fa]/20 transition-colors">
          <UploadCloud className="w-5 h-5 text-[#6c7086] group-hover:text-[#89b4fa] transition-colors" />
        </div>
        <div className="text-center">
          <p className="text-xs font-medium text-[#cdd6f4]">{t.dropFiles}</p>
          <p className="text-[10px] text-[#6c7086] mt-0.5">{t.clickToUpload}</p>
        </div>
      </div>

      <UploadConflictModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        conflicts={conflicts}
        onApply={handleApplyConflicts}
      />
    </>
  );
}
