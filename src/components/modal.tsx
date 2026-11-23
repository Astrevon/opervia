"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "@/components/ui";

/** Accessible modal built on the native <dialog> element (focus trap + Esc). */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line-strong bg-surface p-0 text-ink shadow-[var(--shadow-pop)] backdrop:bg-transparent",
        size === "sm" ? "max-w-md" : size === "lg" ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open ? (
        <div className="max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              {description ? <div className="mt-1 text-sm text-muted">{description}</div> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-2 rounded-lg p-1.5 text-subtle transition-colors hover:bg-surface-3 hover:text-ink"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="px-6 pb-6 pt-3">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
