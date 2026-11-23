import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";
import { db } from "@/lib/demo/engine";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/constants";

/** DEMO MODE only: receives a file for a one-time upload token (mirrors the private storage bucket rules). */
export async function PUT(request: NextRequest) {
  if (!isDemoMode()) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const d = db();
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const t = d.tokens.get(token);
  if (!t || t.kind !== "upload" || t.exp < Date.now()) return NextResponse.json({ message: "Upload link expired" }, { status: 400 });
  const mime = (request.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!ALLOWED_UPLOAD_TYPES.includes(mime)) return NextResponse.json({ message: `mime type ${mime} is not supported` }, { status: 415 });
  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) return NextResponse.json({ message: "The object exceeded the maximum allowed size" }, { status: 413 });
  d.tokens.delete(token);
  d.objects.set(t.path, { bytes, mime, size: bytes.length });
  return NextResponse.json({ Key: `attachments/${t.path}` });
}
