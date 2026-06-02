"use client";

import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";

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
  /** Resolves true/void on success; sync errors are surfaced via console. */
  onConfirm: () => void | boolean | Promise<void | boolean>;
  ariaLabel: string;
  confirmLabel?: string;
  cancelLabel?: string;
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
 */
export function ConfirmDeleteButton({
  title,
  description,
  onConfirm,
  ariaLabel,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  disabled = false,
  triggerClassName,
  triggerIcon,
}: ConfirmDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handleConfirm = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // Hold the dialog open until the async work resolves so the user sees a
    // pending state instead of an instant close that hides any error.
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      console.error("[confirm-delete] action failed", err);
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={pending}>
            {pending ? `${confirmLabel}…` : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
