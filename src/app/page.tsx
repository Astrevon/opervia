import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ flash?: string }> }) {
  const { flash } = await searchParams;
  const session = await getSession();
  const target = homeFor(session);
  redirect(flash && target !== "/login" ? `${target}?flash=${encodeURIComponent(flash)}` : target);
}
