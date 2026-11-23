"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, success, type ActionState } from "@/lib/actions";
import { fieldErrors } from "@/lib/validation";

const INVITE_TOKEN = /^[a-f0-9]{64}$/;

/** Only allow redirects to paths inside this app. */
function safeNext(next: FormDataEntryValue | null) {
  const v = typeof next === "string" ? next : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}

async function siteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export async function signInAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (/email not confirmed/i.test(error.message)) return fail("Please confirm your email address first — check your inbox for the confirmation link.");
    return fail("Incorrect email or password.");
  }
  redirect(safeNext(formData.get("next")));
}

const signUpSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z
    .string()
    .min(10, "Use at least 10 characters")
    .max(72, "Use at most 72 characters")
    .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Include at least one letter and one number"),
  workspace: z.string().trim().max(120).optional().default(""),
  invite: z.string().optional().default(""),
});

export async function signUpAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    password: formData.get("password"),
    workspace: formData.get("workspace") ?? "",
    invite: formData.get("invite") ?? "",
  });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const v = parsed.data;
  const invite = INVITE_TOKEN.test(v.invite) ? v.invite : "";
  if (!invite && v.workspace.length < 2) return fail("Please fix the highlighted fields.", { workspace: "Name your agency workspace" });

  const next = invite ? `/onboarding?invite=${invite}` : "/onboarding";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: v.email,
    password: v.password,
    options: {
      data: { full_name: v.full_name, ...(invite ? {} : { workspace_name: v.workspace }) },
      emailRedirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) return fail("An account with this email already exists. Sign in instead.");
    if (/password/i.test(error.message)) return fail(error.message, { password: error.message });
    return fail(error.message);
  }
  // Email confirmation is required by the Supabase project: no session yet.
  if (!data.session) {
    return success("Check your inbox to confirm your email address, then continue from the link.", { confirm: true });
  }
  redirect(next);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordResetAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const email = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!email.success) return fail("Enter a valid email address.", { email: "Enter a valid email address" });
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await siteUrl()}/auth/callback?next=/reset-password`,
  });
  // Same response whether or not the account exists (prevents account discovery).
  if (error && !/rate limit/i.test(error.message)) console.error("password reset:", error.message);
  if (error && /rate limit/i.test(error.message)) return fail("Too many requests. Please wait a minute and try again.");
  return success("If an account exists for that email, a reset link is on its way.");
}

export async function updatePasswordAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const pw = signUpSchema.shape.password.safeParse(formData.get("password"));
  if (!pw.success) return fail(pw.error.issues[0].message, { password: pw.error.issues[0].message });
  if (formData.get("password") !== formData.get("confirm")) return fail("Passwords don't match.", { confirm: "Passwords don't match" });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return fail("Your reset link has expired. Request a new one.");
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) return fail(error.message);
  redirect("/?flash=password");
}
