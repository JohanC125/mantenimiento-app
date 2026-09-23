"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AppIcon } from "@/components/ui/AppIcon";

export function Modal({
  title,
  description,
  icon,
  closeDisabled = false,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  closeDisabled?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const closingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled]);

  const requestClose = () => {
    if (closeDisabledRef.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timerRef.current = window.setTimeout(() => {
      if (closeDisabledRef.current) {
        closingRef.current = false;
        setClosing(false);
        return;
      }
      onCloseRef.current();
    }, 180);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      previouslyFocused?.focus();
    };
  }, []);
  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-50 flex items-end p-0 sm:items-center sm:justify-center sm:p-6"
      data-closing={closing}
      onMouseDown={requestClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className="app-modal-panel max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-3xl outline-none sm:max-h-[calc(100dvh-3rem)] sm:max-w-2xl sm:rounded-2xl"
        data-closing={closing}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/12 text-blue-300">{icon}</span>}
            <div><h2 id={titleId} className="text-lg font-bold text-slate-50">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-slate-400">{description}</p>
            )}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={closeDisabled || closing}
            className="app-button-secondary h-10 w-10 shrink-0 text-slate-400"
            aria-label="Cerrar"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
