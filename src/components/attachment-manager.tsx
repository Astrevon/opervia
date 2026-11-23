"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Trash2, UploadCloud } from "lucide-react";
import { Button, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/toast";
import { AttachmentTile } from "@/components/attachment-tile";
import { createClient } from "@/lib/supabase/client";
import { DEMO_MODE_CLIENT } from "@/lib/demo/mode";
import { ALLOWED_UPLOAD_ACCEPT, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { prepareUploadAction, registerAttachmentAction, removeAttachmentAction } from "@/app/actions/content";
import type { AttachmentRow } from "@/lib/data";

/** Upload + remove files on the working (unsent) version. */
export function AttachmentManager({ itemId, attachments }: { itemId: string; attachments: AttachmentRow[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [removing, startRemove] = useTransition();
  const toast = useToast();
  const router = useRouter();

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (attachments.length + list.length > 10) {
      toast("error", "A version can have at most 10 attachments.");
      return;
    }
    const supabase = DEMO_MODE_CLIENT ? null : createClient();
    for (const file of list) {
      const type = file.type || "application/octet-stream";
      if (!ALLOWED_UPLOAD_TYPES.includes(type)) {
        toast("error", `${file.name}: this file type isn't allowed.`);
        continue;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast("error", `${file.name}: files must be 25 MB or smaller.`);
        continue;
      }
      setUploading((u) => [...u, file.name]);
      try {
        const prep = await prepareUploadAction({ itemId, fileName: file.name, size: file.size, type });
        if (!prep.ok) throw new Error(prep.error);
        if (supabase) {
          const { error } = await supabase.storage
            .from("attachments")
            .uploadToSignedUrl(prep.path, prep.token, await file.arrayBuffer(), { contentType: type });
          if (error) throw new Error(error.message);
        } else {
          // DEMO MODE: store the file in the local in-memory demo store.
          const res = await fetch(`/api/demo/upload?token=${prep.token}`, { method: "PUT", body: file, headers: { "content-type": type } });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "Upload failed");
        }
        const reg = await registerAttachmentAction({ itemId, path: prep.path, fileName: file.name });
        if (!reg.ok) throw new Error(reg.error);
        toast("success", `Uploaded ${file.name}`);
      } catch (e) {
        toast("error", `${file.name}: ${e instanceof Error ? e.message : "upload failed"}`);
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
    router.refresh();
  }

  function remove(id: string, name: string) {
    startRemove(async () => {
      const res = await removeAttachmentAction(itemId, id);
      if (res.ok) toast("success", `Removed ${name} from this version`);
      else toast("error", res.error ?? "Could not remove file");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {attachments.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {attachments.map((a) => (
            <li key={a.id} className="group relative">
              <AttachmentTile a={a} />
              <button
                type="button"
                onClick={() => remove(a.id, a.file_name)}
                disabled={removing}
                className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white/80 opacity-100 backdrop-blur transition hover:bg-[#4a181d] hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
                aria-label={`Remove ${a.file_name}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
        }}
        className={cx(
          "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
          drag ? "border-brand-bright bg-brand-soft" : "border-line-strong bg-surface-2/50",
        )}
      >
        {uploading.length ? (
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <Spinner /> Uploading {uploading.join(", ")}…
          </div>
        ) : (
          <>
            <UploadCloud className="size-6 text-subtle" />
            <div className="text-sm text-ink-2">Drag files here, or</div>
            <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              <Paperclip className="size-3.5" /> Choose files
            </Button>
            <div className="text-xs text-subtle">Images, video, PDF or Office files · up to {formatBytes(MAX_UPLOAD_BYTES)} each · max 10</div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
