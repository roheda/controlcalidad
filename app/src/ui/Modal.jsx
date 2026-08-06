import React, { useEffect } from "react";

export default function Modal({ open, onClose, title, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2147483647] grid place-items-center bg-black/35 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full overflow-auto rounded-lg border border-line bg-surface-strong p-5 shadow-elevated"
        style={{ maxWidth: width }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title ? (
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-line pb-3">
            <h2 className="text-base font-extrabold text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white font-extrabold text-ink hover:border-brand-gold/50"
            >
              ×
            </button>
          </div>
        ) : null}
        <div>{children}</div>
        {footer ? <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">{footer}</div> : null}
      </div>
    </div>
  );
}
