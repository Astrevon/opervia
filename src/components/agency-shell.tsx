"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Building2, CreditCard, FileText, LayoutDashboard, LogOut, Menu, Settings, ShieldAlert, ShieldCheck, Users, X, FlaskConical } from "lucide-react";
import { Avatar, cx, LinkButton, MadeByOpervia, Notice, OperviaMark } from "@/components/ui";
import { NotificationBell } from "@/components/notification-bell";
import { signOutAction } from "@/app/actions/auth";
import { ROLES, type Role } from "@/lib/constants";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/content", label: "Content", icon: FileText },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
  { href: "/billing", label: "Billing", icon: CreditCard, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Subscription state shown by the shell. Enforcement itself happens in the database. */
export type ShellAccess = { status: string | null; serviceActive: boolean; isBillingAdmin: boolean } | null;

export function AgencyShell({
  children,
  orgName,
  isDemo,
  userName,
  userEmail,
  role,
  access = null,
}: {
  children: ReactNode;
  orgName: string;
  isDemo: boolean;
  userName: string;
  userEmail: string;
  role: Role;
  access?: ShellAccess;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    // Close the mobile drawer after navigation.
    setLastPath(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const nav = NAV.filter((n) => !n.adminOnly || role === "admin");
  const suspended = access ? !access.serviceActive : false;
  const onBilling = pathname === "/billing" || pathname.startsWith("/billing/");

  // While the subscription is suspended the database already returns no
  // content and refuses every workflow action; this explains why.
  const gate = suspended && !onBilling ? (
    <div className="mx-auto max-w-xl py-10">
      <Notice tone="red" icon={<ShieldAlert className="size-5 text-[#fca5a5]" />} title="This workspace is suspended">
        <p>
          {access?.status === "cancelled"
            ? "The Opervia subscription for this workspace has been cancelled, so the approval workflow is unavailable."
            : "The Opervia subscription for this workspace is suspended, so content, approvals and scheduling are paused."}{" "}
          Your content, settings and history are safe and nothing has been deleted.
        </p>
        <p className="mt-2">
          {role === "admin"
            ? "Open Billing to see why, which invoice is unpaid and how to submit your payment proof."
            : "Please ask your workspace admin to check the Billing page."}
        </p>
        {role === "admin" ? (
          <LinkButton href="/billing" className="mt-4" size="sm">
            Open Billing
          </LinkButton>
        ) : null}
      </Notice>
    </div>
  ) : null;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pb-6 pt-5">
        <OperviaMark className="size-8" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold tracking-tight">{orgName}</div>
          <div className="text-[11px] text-subtle">Approval Portal</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
        {access?.isBillingAdmin ? (
          <Link
            href="/admin"
            className="mb-2 flex items-center gap-3 rounded-lg border border-[#1e3a70] bg-[#0b1730] px-3 py-2 text-[13px] font-medium text-[#8fb8ff] hover:text-ink"
          >
            <ShieldCheck className="size-[17px]" /> Opervia billing admin
          </Link>
        ) : null}
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
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
              {label}
              {href === "/billing" && access && (access.status === "overdue" || suspended) ? (
                <span className="ml-auto size-2 rounded-full bg-[#f87171]" aria-label="Needs attention" />
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 p-3">
        {isDemo ? (
          <div className="flex gap-2.5 rounded-lg border border-[#5a4513] bg-[#1f190b] px-3 py-2.5 text-[11.5px] leading-snug text-[#f5d58a]">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            <span>Demo workspace with fictional data. Northstar Digital is not a real company.</span>
          </div>
        ) : null}
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <Avatar name={userName} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{userName || userEmail}</div>
            <div className="truncate text-[11px] text-subtle">{ROLES[role].label}</div>
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
          <span className="truncate text-sm font-semibold">{orgName}</span>
        </div>
        <div className="flex-1" />
        <NotificationBell itemHref="agency" />
      </header>

      {access?.status === "overdue" && role === "admin" && !onBilling ? (
        <div className="border-b border-[#5c2330] bg-[#220f15] px-4 py-2 text-center text-[12.5px] text-[#fda4af]">
          A payment is overdue.{" "}
          <Link href="/billing" className="font-medium underline">
            Pay now
          </Link>{" "}
          to avoid suspension after the grace period.
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{gate ?? children}</main>
    </div>
  );
}
