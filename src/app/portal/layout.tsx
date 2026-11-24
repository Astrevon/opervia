import Link from "next/link";
import { LogOut, ShieldAlert, UserRound } from "lucide-react";
import { MadeByOpervia, Notice, OperviaMark } from "@/components/ui";
import { NotificationBell } from "@/components/notification-bell";
import { signOutAction } from "@/app/actions/auth";
import { getWorkspaceAccess, requireClientUser } from "@/lib/session";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const s = await requireClientUser();
  const access = await getWorkspaceAccess();
  const suspended = access ? !access.serviceActive : false;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-3">
            <OperviaMark className="size-8 shrink-0" />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-tight">{s.client?.name ?? "Client portal"}</div>
              <div className="truncate text-[11px] text-subtle">Content review · {s.org.name}</div>
            </div>
          </Link>
          <div className="flex-1" />
          <NotificationBell itemHref="client" />
          <Link href="/portal/account" className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-3 hover:text-ink" aria-label="Your account" title={s.fullName}>
            <UserRound className="size-[18px]" />
          </Link>
          <form action={signOutAction}>
            <button className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-3 hover:text-ink" aria-label="Sign out" title="Sign out">
              <LogOut className="size-[18px]" />
            </button>
          </form>
        </div>
        {s.org.is_demo ? (
          <div className="border-t border-[#5a4513] bg-[#1f190b] px-4 py-1.5 text-center text-[11.5px] text-[#f5d58a]">
            Demo workspace — Northstar Digital and its clients are fictional.
          </div>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {suspended ? (
          <div className="mx-auto max-w-xl py-6">
            <Notice tone="amber" icon={<ShieldAlert className="size-5 text-[#fcd34d]" />} title="Content review is temporarily unavailable">
              {s.org.name}&apos;s portal access is paused right now, so there&apos;s nothing to review. Nothing you approved earlier has been lost. Please
              contact {s.org.name} if you have questions.
            </Notice>
          </div>
        ) : (
          children
        )}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-5 text-xs text-subtle sm:flex-row sm:px-6">
          <span>Content prepared for you by {s.org.name}.</span>
          <MadeByOpervia />
        </div>
      </footer>
    </div>
  );
}
