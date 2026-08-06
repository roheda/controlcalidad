import React from "react";

const tones = {
  neutral: "bg-black/5 text-ink-muted",
  success: "bg-state-success/10 text-state-success",
  warning: "bg-state-warning/10 text-state-warning",
  danger: "bg-state-danger/10 text-state-danger",
  info: "bg-state-info/10 text-state-info",
  brand: "bg-brand-soft text-brand-gold-dark",
};

export default function Badge({ tone = "neutral", className = "", children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${
        tones[tone] || tones.neutral
      } ${className}`}
    >
      {children}
    </span>
  );
}
