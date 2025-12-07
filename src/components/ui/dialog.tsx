/**
 * @file dialog.tsx
 * @description Компонент Dialog (модальное окно) в стиле shadcn/ui
 * 
 * Основан на @radix-ui/react-dialog для доступности и правильного поведения.
 * Используется для отображения контента поверх основного UI.
 */

"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

// =============================================================================
// БАЗОВЫЕ КОМПОНЕНТЫ
// =============================================================================

/**
 * Корневой компонент Dialog
 * Управляет состоянием открытия/закрытия модального окна
 */
const Dialog = DialogPrimitive.Root

/**
 * Триггер для открытия диалога
 * Оборачивает элемент, по клику на который открывается диалог
 */
const DialogTrigger = DialogPrimitive.Trigger

/**
 * Portal для рендеринга диалога вне DOM-дерева
 * Обеспечивает правильное позиционирование поверх всего контента
 */
const DialogPortal = DialogPrimitive.Portal

/**
 * Компонент для программного закрытия диалога
 */
const DialogClose = DialogPrimitive.Close

// =============================================================================
// OVERLAY (ЗАТЕМНЕНИЕ ФОНА)
// =============================================================================

/**
 * Затемнённый фон за модальным окном
 * Клик по нему закрывает диалог
 */
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Фиксированное позиционирование на весь экран
      "fixed inset-0 z-50",
      // Полупрозрачный тёмный фон
      "bg-black/80",
      // Анимации появления/исчезновения
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// =============================================================================
// CONTENT (ОСНОВНОЙ КОНТЕНТ ДИАЛОГА)
// =============================================================================

/**
 * Контейнер для содержимого модального окна
 * Центрируется на экране, содержит кнопку закрытия
 */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    {/* Затемнённый фон */}
    <DialogOverlay />
    
    {/* Само модальное окно */}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Фиксированное позиционирование по центру
        "fixed left-[50%] top-[50%] z-50",
        "translate-x-[-50%] translate-y-[-50%]",
        
        // Сетка и размеры
        "grid w-full max-w-lg gap-4",
        
        // Стилизация карточки
        "border bg-background p-6 shadow-lg",
        "rounded-lg",
        
        // Ограничение высоты и скролл
        "max-h-[90vh] overflow-y-auto",
        
        // Анимации появления/исчезновения
        "duration-200",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
        "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
        
        className
      )}
      {...props}
    >
      {children}
      
      {/* Кнопка закрытия в правом верхнем углу */}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-4 top-4",
          "rounded-sm opacity-70 ring-offset-background",
          "transition-opacity hover:opacity-100",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:pointer-events-none",
          "data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
        )}
      >
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

// =============================================================================
// HEADER (ШАПКА ДИАЛОГА)
// =============================================================================

/**
 * Контейнер для заголовка и описания диалога
 */
const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

// =============================================================================
// FOOTER (ПОДВАЛ ДИАЛОГА)
// =============================================================================

/**
 * Контейнер для кнопок действий в нижней части диалога
 */
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

// =============================================================================
// TITLE (ЗАГОЛОВОК)
// =============================================================================

/**
 * Заголовок модального окна
 * Используется для accessibility (читается screen readers)
 */
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

// =============================================================================
// DESCRIPTION (ОПИСАНИЕ)
// =============================================================================

/**
 * Описание/подзаголовок модального окна
 * Используется для accessibility
 */
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

// =============================================================================
// ЭКСПОРТ
// =============================================================================

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}

