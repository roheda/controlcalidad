import React, { useId, useState } from "react";

export function HelpIcon({ text }) {
  if (!text) return null;
  return (
    <Tooltip text={text}>
      <span
        tabIndex={0}
        role="button"
        aria-label="Ayuda"
        className="ml-1 inline-grid h-4 w-4 shrink-0 cursor-help place-items-center rounded-full bg-black/10 text-[10px] font-black leading-none text-ink-muted"
      >
        ?
      </span>
    </Tooltip>
  );
}

export default function Tooltip({ text, children, side = "top" }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  if (!text) return children;

  const sideClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {React.cloneElement(children, { "aria-describedby": visible ? id : undefined })}
      {visible ? (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute z-[2147483647] w-max max-w-[240px] rounded-xl bg-ink px-2.5 py-1.5 text-xs font-semibold leading-snug text-white shadow-elevated ${sideClasses[side] || sideClasses.top}`}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
