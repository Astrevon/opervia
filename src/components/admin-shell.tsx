"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Ban, ClipboardCheck, History, Landmark, LayoutDashboard, LogOut, Menu, Receipt, ScrollText, Users, X, Wallet, ArrowLeftRight } from "lucide-react";
import { Avatar, cx, MadeByOpervia, OperviaMark } from "@/components/ui";
import { NotificationBell } from "@/components/notification-bell";
import { signOutAction } from "@/app/actions/auth";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean; badge?: "verify" | "suspended" };

const NAV: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: Users },
  { href: "/admin/invoices", label: "Invoices", icon: Receipt },
  { href: "/admin/verification", label: "Payment Verification", icon: ClipboardCheck, badge: "verify" },
  { href: "/admin/suspended", label: "Suspended Clients", icon: Ban, badge: "suspended" },
  { href: "/admin/history/payments", label: "Payment History", icon: Wallet },
  { href: "/admin/history/subscriptions", label: "Subscription History", icon: History },
  { href: "/admin/history/audit", label: "Audit Trail", icon: ScrollText },
  { href: "/admin/settings", label: "Bank Account Settings", icon: Landmark },
];

export function AdminShell({
  children,
  userName,
  userEmail,
  pendingCount,
  suspendedCount,
  hasWorkspace,
}: {
  children: ReactNode;
  userName: string;
  userEmail: string;
  pendingCount: number;
  suspendedCount: number;
  hasWorkspace: boolean;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMobileOpen(false);
  }
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-6 pt-5">
        <OperviaMark className="size-8" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold tracking-tight">Opervia Billing</div>
          <div className="text-[11px] text-subtle">Admin console</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Billing admin">
        {NAV.map(({ href, label, icon: Icon, exact, badge }) => {
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          const count = badge === "verify" ? pendingCount : badge === "suspended" ? suspendedCount : 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors",
                active ? "bg-surface-3 text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-bright" /> : null}
              <Icon className={cx("size-[17px]", active ? "text-brand-bright" : "text-subtle group-hover:text-ink-2")} />
              <span className="truncate">{label}</span>
              {count > 0 ? (
                <span
                  className={cx(
                    "ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5",
                    badge === "verify" ? "bg-brand text-white" : "bg-[#3a1418] text-[#fca5a5]",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
        {hasWorkspace ? (
          <Link href="/dashboard" className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-subtle hover:bg-surface-2 hover:text-ink">
            <ArrowLeftRight className="size-[17px]" /> Back to my workspace
          </Link>
        ) : null}
      </nav>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <Avatar name={userName || userEmail} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{userName || userEmail}</div>
            <div className="truncate text-[11px] text-subtle">Opervia billing admin</div>
          </div>
          <form action={signOutAction}>
            <button className="rounded-md p-1.5 text-subtle transition-colors hover:bg-surface-3 hover:text-ink" aria-label="Sign out" title="Sign out">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
        <MadeByOpervia className="w-full justify-center" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-[#070c18]/95 lg:block">{sidebar}</aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 animate-slide-up border-r border-line bg-[#070c18]">
            <button className="absolute right-3 top-4 rounded-lg p-2 text-muted hover:text-ink" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
        <button className="-ml-1 rounded-lg p-2 text-ink-2 hover:bg-surface-3 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2 lg:hidden">
          <OperviaMark className="size-6" />
          <span className="truncate text-sm font-semibold">Opervia Billing</span>
        </div>
        <div className="flex-1" />
        <NotificationBell itemHref="admin" />
      </header>
      <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
    </div>
  );
}
