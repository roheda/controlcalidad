import React from "react";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-bold text-sm px-4 py-2.5 min-h-[44px] " +
  "transition-all duration-150 border disabled:opacity-50 disabled:cursor-not-allowed disabled:saturate-75 " +
  "focus-visible:outline focus-visible:outline-3 focus-visible:outline-brand-gold/30 focus-visible:outline-offset-2";

const variants = {
  primary: "bg-brand-gold border-brand-gold text-ink shadow-soft hover:brightness-105 active:scale-[0.985]",
  secondary: "bg-white border-line text-ink hover:border-brand-gold/60 active:scale-[0.985]",
  danger: "bg-white border-state-danger/30 text-state-danger hover:bg-state-danger/5 active:scale-[0.985]",
  success: "bg-state-success border-state-success text-white shadow-soft hover:brightness-105 active:scale-[0.985]",
  ghost: "bg-transparent border-transparent text-ink-muted hover:bg-black/5 active:scale-[0.985]",
};

const sizes = {
  sm: "text-xs px-3 py-2 min-h-[36px]",
  md: "text-sm px-4 py-2.5 min-h-[44px]",
  lg: "text-base px-5 py-3 min-h-[48px]",
};

export default function Button({ variant = "primary", size = "md", className = "", children, ...props }) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
