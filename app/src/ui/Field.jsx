import React from "react";

const fieldBase =
  "w-full min-h-[46px] rounded-2xl border border-line bg-white/90 px-3.5 py-2.5 text-sm text-ink " +
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] outline-none transition-colors " +
  "focus:border-line-strong focus:ring-4 focus:ring-brand-gold/15 " +
  "placeholder:text-ink-muted/70 disabled:opacity-60";

function Wrapper({ label, hint, error, children }) {
  return (
    <label className="grid gap-1.5 text-sm">
      {label ? <span className="font-bold text-ink">{label}</span> : null}
      {children}
      {error ? (
        <span className="text-xs font-semibold text-state-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ label, hint, error, className = "", ...props }) {
  return (
    <Wrapper label={label} hint={hint} error={error}>
      <input className={`${fieldBase} ${error ? "border-state-danger/50" : ""} ${className}`} {...props} />
    </Wrapper>
  );
}

export function Textarea({ label, hint, error, className = "", rows = 4, ...props }) {
  return (
    <Wrapper label={label} hint={hint} error={error}>
      <textarea rows={rows} className={`${fieldBase} resize-y ${error ? "border-state-danger/50" : ""} ${className}`} {...props} />
    </Wrapper>
  );
}

export function Select({ label, hint, error, className = "", children, ...props }) {
  return (
    <Wrapper label={label} hint={hint} error={error}>
      <select className={`${fieldBase} ${error ? "border-state-danger/50" : ""} ${className}`} {...props}>
        {children}
      </select>
    </Wrapper>
  );
}
