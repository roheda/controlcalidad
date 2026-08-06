import React from "react";

export default function Card({ selected = false, padded = true, className = "", children, ...props }) {
  return (
    <div
      className={`bg-surface rounded-lg shadow-soft backdrop-blur-xl ${padded ? "p-4" : ""} ${
        selected
          ? "border-2 border-brand-gold shadow-[0_0_0_4px_rgba(245,178,26,0.14)]"
          : "border border-line"
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
