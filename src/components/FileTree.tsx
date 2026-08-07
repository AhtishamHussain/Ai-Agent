"use client";

import type { ProjectFile } from "@/lib/types";

export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: ProjectFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  if (!files.length) {
    return (
      <div className="file-empty">
        Project files will appear here once the Engineer delivers code.
      </div>
    );
  }

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <ul className="file-tree">
      {sorted.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            className={`file-item${selected === f.path ? " selected" : ""}`}
            onClick={() => onSelect(f.path)}
          >
            {f.path}
          </button>
        </li>
      ))}
    </ul>
  );
}
