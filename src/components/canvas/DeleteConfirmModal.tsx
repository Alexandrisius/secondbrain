/**
 * @file DeleteConfirmModal.tsx
 * @description Modal for confirming deletion of nodes/edges via Delete key
 */

'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation, format } from '@/lib/i18n';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  nodeCount: number;
  edgeCount: number;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  nodeCount,
  edgeCount,
}: DeleteConfirmModalProps) {
  const { t } = useTranslation();

  // Определяем заголовок и описание в зависимости от того, что удаляем
  const isEdgesOnly = nodeCount === 0 && edgeCount > 0;
  
  let title: string;
  let description: string;

  if (isEdgesOnly) {
    // Удаляем только связи
    title = edgeCount === 1 
      ? t.canvas.deleteEdgeTitle 
      : t.canvas.deleteEdgeTitlePlural;
    description = edgeCount === 1
      ? format(t.canvas.deleteEdgeDescription, { count: edgeCount })
      : format(t.canvas.deleteEdgeDescriptionPlural, { count: edgeCount });
  } else {
    // Удаляем карточки (возможно со связями)
    title = nodeCount === 1 
      ? t.canvas.deleteConfirmTitle 
      : t.canvas.deleteConfirmTitlePlural;
    description = nodeCount === 1
      ? format(t.canvas.deleteConfirmDescription, { count: nodeCount })
      : format(t.canvas.deleteConfirmDescriptionPlural, { count: nodeCount });
  }

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription className="pt-2">
            {description}
            {/* Показываем примечание о связях только когда удаляем карточки + связи */}
            {!isEdgesOnly && edgeCount > 0 && (
              <span className="block mt-2 text-muted-foreground">
                {format(t.canvas.deleteConfirmEdgesNote, { count: edgeCount })}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onClose}
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
          >
            {t.common.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
