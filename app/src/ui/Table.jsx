import React from "react";
import EmptyState from "./EmptyState.jsx";

export default function Table({ columns = [], rows = [], rowKey = (row, i) => row.id ?? i, emptyLabel = "Sin registros" }) {
  if (!rows.length) return <EmptyState title={emptyLabel} />;

  return (
    <div className="overflow-auto rounded-md">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface-strong/95 px-3 py-3 text-left text-xs font-extrabold uppercase tracking-wide text-ink-muted"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="hover:bg-black/[0.02]">
              {columns.map((col) => (
                <td key={col.key} className="border-b border-line/60 px-3 py-3 align-top text-ink">
                  {typeof col.render === "function" ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
