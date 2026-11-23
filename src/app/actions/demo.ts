"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_COOKIE, isDemoMode } from "@/lib/demo/mode";
import { DEMO_PEOPLE } from "@/lib/demo/store";

/** DEMO MODE only: "sign in" as one of the fictional demo people (no password). */
export async function demoSignInAction(formData: FormData) {
  if (!isDemoMode()) throw new Error("Demo mode is not enabled.");
  const id = String(formData.get("person") ?? "");
  if (!DEMO_PEOPLE.some((p) => p.id === id)) throw new Error("Unknown demo person.");
  const store = await cookies();
  store.set(DEMO_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
  redirect("/");
}
