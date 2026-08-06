import React from "react";

export default function EmptyState({ title = "Sin datos", description, action, className = "" }) {
  return (
    <div className={`rounded-md border border-dashed border-line bg-white/60 p-6 text-center ${className}`}>
      <div className="font-bold text-ink">{title}</div>
      {description ? <div className="mt-1 text-sm text-ink-muted">{description}</div> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
