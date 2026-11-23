import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/constants";

export type SessionContext = {
  userId: string;
  email: string;
  fullName: string;
  role: Role | null;
  orgId: string | null;
  clientId: string | null;
  isActive: boolean;
  org: { id: string; name: string; is_demo: boolean; require_four_eyes: boolean } | null;
  client: { id: string; name: string; timezone: string } | null;
};

/** Loads the signed-in user, their membership and organisation once per request. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: membership, error: membershipError }] = await Promise.all([
    supabase.from("profiles").select("full_name,email").eq("id", userId).maybeSingle(),
    supabase.from("memberships").select("role,org_id,client_id,is_active").eq("user_id", userId).maybeSingle(),
  ]);
  // Never treat a failed lookup as "no workspace" — show the error page instead.
  if (membershipError) throw new Error(`Could not load your workspace: ${membershipError.message}`);

  const active = Boolean(membership?.is_active);
  let org: SessionContext["org"] = null;
  let client: SessionContext["client"] = null;
  if (membership && active) {
    const [{ data: o }, c] = await Promise.all([
      supabase.from("organizations").select("id,name,is_demo,require_four_eyes").eq("id", membership.org_id).maybeSingle(),
      membership.client_id
        ? supabase.from("clients").select("id,name,timezone").eq("id", membership.client_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    org = o ?? null;
    client = c.data ?? null;
  }

  return {
    userId,
    email: profile?.email ?? String(claimsData?.claims?.email ?? ""),
    fullName: profile?.full_name ?? "",
    role: active ? ((membership?.role as Role) ?? null) : null,
    orgId: active ? (membership?.org_id ?? null) : null,
    clientId: active ? (membership?.client_id ?? null) : null,
    isActive: active,
    org,
    client,
  };
});

export function homeFor(session: SessionContext | null) {
  if (!session) return "/login";
  if (!session.role) return "/onboarding";
  return session.role === "client" ? "/portal" : "/dashboard";
}

type Ctx = SessionContext & { role: Role; orgId: string; org: NonNullable<SessionContext["org"]> };

async function requireRole(allowed: Role[]): Promise<Ctx> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role || !session.orgId || !session.org) redirect("/onboarding");
  if (!allowed.includes(session.role)) redirect(homeFor(session));
  return session as Ctx;
}

export const requireAgency = () => requireRole(["admin", "team"]);
export const requireAdmin = () => requireRole(["admin"]);
export const requireClientUser = () => requireRole(["client"]);
