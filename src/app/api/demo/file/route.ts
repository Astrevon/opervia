import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";
import { db } from "@/lib/demo/engine";

/** DEMO MODE only: serves a stored demo file for a short-lived signed token. */
export async function GET(request: NextRequest) {
  if (!isDemoMode()) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const d = db();
  const t = d.tokens.get(request.nextUrl.searchParams.get("token") ?? "");
  const obj = t && t.kind === "download" && t.exp > Date.now() ? d.objects.get(t.path) : undefined;
  if (!obj) return NextResponse.json({ message: "Object not found" }, { status: 404 });
  const download = request.nextUrl.searchParams.get("download");
  return new NextResponse(new Uint8Array(obj.bytes), {
    headers: {
      "content-type": obj.mime,
      "cache-control": "private, no-store",
      ...(download ? { "content-disposition": `attachment; filename="${download.replace(/["\r\n]/g, "")}"` } : {}),
    },
  });
}
