import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/origin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Opens an attachment through a 2-minute signed URL. Access is checked twice:
 * the attachments row is read under RLS, and Storage checks its own policies
 * before signing the URL.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: att } = await supabase.from("attachments").select("storage_path,file_name").eq("id", id).maybeSingle();
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download = request.nextUrl.searchParams.has("download");
  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(att.storage_path, 120, download ? { download: att.file_name } : undefined);
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const res = NextResponse.redirect(new URL(data.signedUrl, requestOrigin(request)), 302);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
