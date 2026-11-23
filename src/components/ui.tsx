import Link from "next/link";
import { clsx } from "clsx";
import type { ComponentProps, ReactNode } from "react";
import { STATUS, type Status, type Tone } from "@/lib/constants";
import { initials } from "@/lib/format";

export const cx = clsx;

/* Buttons ------------------------------------------------------------------ */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-all duration-150 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-bright/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
  "disabled:pointer-events-none disabled:opacity-50 active:translate-y-px select-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-[0_1px_0_0_#ffffff26_inset,0_8px_20px_-10px_#155eef] hover:bg-brand-bright",
  secondary: "bg-surface-3 text-ink border border-line-strong hover:bg-[#1a2843] hover:border-[#33446a]",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-3",
  danger: "bg-[#3a1418] text-[#ffb4b4] border border-[#5c1f26] hover:bg-[#4a181d]",
  success: "bg-emerald-500 text-[#03140d] shadow-[0_8px_20px_-10px_#34d399] hover:bg-emerald-400",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cx(buttonBase, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* Surfaces ----------------------------------------------------------------- */

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)}
      {...props}
    />
  );
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-subtle">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* Status ------------------------------------------------------------------- */

const toneClass: Record<Tone, string> = {
  slate: "bg-[#8391ab14] text-[#b4bfd3] ring-[#8391ab33]",
  amber: "bg-[#fbbf2414] text-[#fcd34d] ring-[#fbbf2433]",
  rose: "bg-[#fb718514] text-[#fda4af] ring-[#fb718533]",
  emerald: "bg-[#34d39914] text-[#6ee7b7] ring-[#34d39933]",
  blue: "bg-[#2878f01a] text-[#8fb8ff] ring-[#2878f040]",
  red: "bg-[#f8717114] text-[#fca5a5] ring-[#f8717133]",
};

const dotClass: Record<Tone, string> = {
  slate: "bg-[#8391ab]",
  amber: "bg-[#fbbf24]",
  rose: "bg-[#fb7185]",
  emerald: "bg-[#34d399]",
  blue: "bg-[#2878f0]",
  red: "bg-[#f87171]",
};

export function Badge({ tone = "slate", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span className={cx("size-1.5 rounded-full", dotClass[tone])} /> : null}
      {children}
    </span>
  );
}

export function StatusBadge({ status, audience = "agency", className }: { status: Status; audience?: "agency" | "client"; className?: string }) {
  const meta = STATUS[status];
  return (
    <Badge tone={meta.tone} dot className={className}>
      {audience === "client" ? meta.clientLabel : meta.label}
    </Badge>
  );
}

export function statusDot(status: Status) {
  return dotClass[STATUS[status].tone];
}

/* Form fields -------------------------------------------------------------- */

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink placeholder:text-subtle transition-colors " +
  "hover:border-[#33446a] focus:border-brand-bright focus:outline-none focus:ring-2 focus:ring-brand-bright/25 disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(fieldBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldBase, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cx(fieldBase, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238391ab' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
        {required ? <span className="ml-0.5 text-brand-bright">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error)
    return (
      <div role="alert" className="rounded-lg border border-[#5c1f26] bg-[#2a0f13] px-3.5 py-2.5 text-sm text-[#ffc2c2]">
        {error}
      </div>
    );
  if (success)
    return (
      <div role="status" className="rounded-lg border border-[#1f5c45] bg-[#0b2a20] px-3.5 py-2.5 text-sm text-[#a7f3d0]">
        {success}
      </div>
    );
  return null;
}

/* Misc --------------------------------------------------------------------- */

export function Avatar({ name, size = "md", className }: { name: string | null | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const s = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-sm" : "size-8 text-xs";
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1b3a7a] to-[#0e1f45] font-semibold text-[#cfe0ff] ring-1 ring-[#2a4a8a66]",
        s,
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted">{icon}</div>
      ) : null}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("size-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-3/70", className)} />;
}

export function Notice({
  tone = "blue",
  title,
  children,
  icon,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    slate: "border-line-strong bg-surface-2",
    amber: "border-[#5a4513] bg-[#1f190b]",
    rose: "border-[#5c2330] bg-[#220f15]",
    emerald: "border-[#1f5c45] bg-[#0a211a]",
    blue: "border-[#1e3a70] bg-[#0b1730]",
    red: "border-[#5c1f26] bg-[#230e11]",
  };
  return (
    <div className={cx("flex gap-3 rounded-xl border px-4 py-3.5", border[tone], className)}>
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0 text-sm">
        {title ? <div className="font-semibold text-ink">{title}</div> : null}
        {children ? <div className={cx("text-ink-2", title ? "mt-1" : "")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function OperviaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="om" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2878F0" />
          <stop offset="1" stopColor="#155EEF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#071B42" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="url(#om)" strokeWidth="3.2" />
      <path d="M16 7.5a8.5 8.5 0 0 1 8.5 8.5" fill="none" stroke="#9cc2ff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

/** "Made by Opervia" credit. Links to NEXT_PUBLIC_OPERVIA_URL when it is set. */
export function MadeByOpervia({ className }: { className?: string }) {
  const href = process.env.NEXT_PUBLIC_OPERVIA_URL;
  const classes = cx(
    "group inline-flex items-center gap-2 rounded-full border border-line bg-surface-2/80 py-1 pl-1 pr-3 text-xs text-muted transition-colors hover:border-[#2a4a8a] hover:text-ink-2",
    className,
  );
  const inner = (
    <>
      <OperviaMark className="size-5" />
      <span>
        Made by <span className="font-semibold text-ink-2 group-hover:text-ink">Opervia</span>
      </span>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={classes}>
      {inner}
    </a>
  ) : (
    <span className={classes}>{inner}</span>
  );
}
