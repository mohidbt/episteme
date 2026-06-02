"use client";

import { useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "./button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { cn } from "../../lib/utils";

interface ConfirmDeleteButtonProps {
  title: string;
  description?: ReactNode;
  /**
   * Returning `false` keeps the dialog open (e.g. the action failed and the
   * caller surfaced its own error UI). Returning `void` / `true` closes it.
   * Thrown errors keep the dialog open and surface a generic toast.
   */
  onConfirm: () => void | boolean | Promise<void | boolean>;
  ariaLabel: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Toast shown when onConfirm throws. */
  failureMessage?: string;
  disabled?: boolean;
  /** Style passthrough for the trigger button only. */
  triggerClassName?: string;
  /** Override default trigger glyph (defaults to <Trash2 />). */
  triggerIcon?: ReactNode;
}

/**
 * Reusable destructive-confirmation button. Wraps base-ui AlertDialog so
 * delete actions render as an accessible, themeable modal instead of the
 * browser's native window.confirm() (which can't be mocked in tests and
 * doesn't match the design system).
 *
 * Implementation notes:
 *   - The destructive action is a plain <button>, NOT a DialogClose
 *     wrapper. We control `open` ourselves so async handlers can keep the
 *     dialog mounted while work resolves and reopen on failure.
 *   - `initialFocus` defaults to the cancel button per WCAG guidance for
 *     destructive alertdialogs (the safer default).
 */
export function ConfirmDeleteButton({
  title,
  description,
  onConfirm,
  ariaLabel,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  failureMessage = "Action failed. Please try again.",
  disabled = false,
  triggerClassName,
  triggerIcon,
}: ConfirmDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      const outcome = await onConfirm();
      if (outcome !== false) setOpen(false);
    } catch (err) {
      console.error("[confirm-delete] action failed", err);
      toast.error(failureMessage);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "text-muted-foreground hover:text-destructive",
              triggerClassName,
            )}
          >
            {triggerIcon ?? <Trash2 className="size-3.5" />}
          </Button>
        }
      />
      <AlertDialogContent initialFocus={cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancelRef} disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={pending}>
            {pending ? `${confirmLabel}…` : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
