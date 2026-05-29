"use client";

import { useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body text explaining the consequence of confirming. */
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true (default) the confirm button reads as a dangerous action. */
  destructive?: boolean;
  /** Disable the buttons while the confirm action is in flight. */
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Reusable "Are you sure?" dialog for destructive actions. Matches the app's
 * sheet overlay pattern (backdrop click + Escape cancel) but renders above
 * sheets so it can be invoked from within an open sheet.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus to the confirm button when opening, and close on Escape.
  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay confirm-overlay"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="sheet confirm-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title" id="confirm-dialog-title">
          {title}
        </div>
        {message && <div className="sheet-subtitle">{message}</div>}
        <div className="sheet-actions" style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={destructive ? "btn danger" : "btn primary"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
