import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/constants";
import type { SubscriptionStatus, SuspensionReason } from "@/lib/billing";
import { isDemoMode } from "@/lib/demo/mode";

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
  /** Opervia staff who verify payments and manage subscriptions (/admin). */
  isBillingAdmin: boolean;
};

export type WorkspaceAccess = {
  hasSubscription: boolean;
  status: SubscriptionStatus | null;
  serviceActive: boolean;
  suspensionReason: SuspensionReason | null;
  suspendedAt: string | null;
  nextPaymentDueDate: string | null;
};

/** Loads the signed-in user, their membership and organisation once per request. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: membership, error: membershipError }, billingAdmin] = await Promise.all([
    supabase.from("profiles").select("full_name,email").eq("id", userId).maybeSingle(),
    supabase.from("memberships").select("role,org_id,client_id,is_active").eq("user_id", userId).maybeSingle(),
    isDemoMode() ? Promise.resolve({ data: false }) : supabase.rpc("am_i_billing_admin"),
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
    isBillingAdmin: billingAdmin?.data === true,
  };
});

/**
 * Subscription state of the signed-in member's workspace. Display only — the
 * database enforces suspension itself (RLS + every workflow function).
 */
export const getWorkspaceAccess = cache(async (): Promise<WorkspaceAccess | null> => {
  if (isDemoMode()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_workspace_access");
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    | { has_subscription: boolean; subscription_status: SubscriptionStatus | null; service_active: boolean; suspension_reason: SuspensionReason | null; suspended_at: string | null; next_payment_due_date: string | null }
    | undefined;
  if (!row) return null;
  return {
    hasSubscription: row.has_subscription,
    status: row.subscription_status,
    serviceActive: row.service_active,
    suspensionReason: row.suspension_reason,
    suspendedAt: row.suspended_at,
    nextPaymentDueDate: row.next_payment_due_date,
  };
});

export function homeFor(session: SessionContext | null) {
  if (!session) return "/login";
  if (!session.role) return session.isBillingAdmin ? "/admin" : "/onboarding";
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

/** Opervia billing administrators only (the /admin console). */
export async function requireBillingAdmin() {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (!session.isBillingAdmin) redirect(homeFor(session));
  return session;
}
