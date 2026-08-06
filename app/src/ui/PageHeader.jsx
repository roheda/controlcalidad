import React from "react";
import Card from "./Card.jsx";
import Badge from "./Badge.jsx";

export default function PageHeader({ icon, title, description, tag, actions }) {
  return (
    <Card className="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon ? (
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-brand-soft text-lg text-brand-gold-dark">
            {icon}
          </div>
        ) : null}
        <div>
          <h1 className="text-xl font-extrabold text-ink">{title}</h1>
          {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {tag ? <Badge tone="brand">{tag}</Badge> : null}
        {actions}
      </div>
    </Card>
  );
}
