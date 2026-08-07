"use client";

import JSZip from "jszip";
import type { ProjectFile } from "@/lib/types";

export function DownloadZip({
  files,
  disabled,
}: {
  files: ProjectFile[];
  disabled?: boolean;
}) {
  async function handleDownload() {
    if (!files.length) return;
    const zip = new JSZip();
    for (const f of files) {
      zip.file(f.path, f.content);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "digitalsofts-project.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      className="btn-download"
      disabled={disabled || !files.length}
      onClick={handleDownload}
    >
      Download ZIP
    </button>
  );
}
