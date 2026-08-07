"use client";

import type { ProjectFile } from "@/lib/types";

export function CodePane({
  file,
}: {
  file: ProjectFile | null;
}) {
  if (!file) {
    return (
      <div className="code-empty">
        Select a file to inspect the generated source.
      </div>
    );
  }

  return (
    <div className="code-pane">
      <div className="code-path">{file.path}</div>
      <pre className="code-pre">
        <code>{file.content}</code>
      </pre>
    </div>
  );
}
