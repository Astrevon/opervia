/* eslint-disable @next/next/no-img-element -- previews are short-lived signed URLs from private storage */
import { Download, FileText, Film, FileSpreadsheet, Presentation } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { AttachmentRow } from "@/lib/data";

function FileIcon({ mime }: { mime: string }) {
  const cls = "size-8";
  if (mime.startsWith("video/")) return <Film className={cls} />;
  if (mime.includes("spreadsheet")) return <FileSpreadsheet className={cls} />;
  if (mime.includes("presentation")) return <Presentation className={cls} />;
  return <FileText className={cls} />;
}

/** A file card. Images get an inline preview; everything opens via a short-lived signed link. */
export function AttachmentTile({ a, large = false }: { a: AttachmentRow; large?: boolean }) {
  const href = `/api/attachments/${a.id}`;
  const isImage = a.mime_type.startsWith("image/");
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2 transition-colors hover:border-line-strong">
      <a href={href} target="_blank" rel="noreferrer" className="block">
        <div className={large ? "aspect-[4/3] bg-[#050913]" : "aspect-square bg-[#050913]"}>
          {isImage ? (
            <img src={href} alt={a.file_name} loading="lazy" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-subtle">
              <FileIcon mime={a.mime_type} />
            </div>
          )}
        </div>
      </a>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-ink-2" title={a.file_name}>
            {a.file_name}
          </div>
          <div className="text-[11px] text-subtle">{formatBytes(a.size_bytes)}</div>
        </div>
        <a href={`${href}?download=1`} className="rounded-md p-1 text-subtle hover:bg-surface-3 hover:text-ink" aria-label={`Download ${a.file_name}`}>
          <Download className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
