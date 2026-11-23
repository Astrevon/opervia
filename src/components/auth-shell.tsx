import type { ReactNode } from "react";
import { CheckCircle2, FileCheck2, History, ShieldCheck } from "lucide-react";
import { MadeByOpervia, OperviaMark } from "@/components/ui";

const points = [
  { icon: FileCheck2, title: "One approval package", text: "Copy, files and publish details reviewed together, version by version." },
  { icon: CheckCircle2, title: "Explicit client approval", text: "Nothing moves to publishing without the named approver's decision." },
  { icon: History, title: "Traceable history", text: "Who decided what, on which version, and when — recorded for good." },
  { icon: ShieldCheck, title: "Private by design", text: "Each agency and each client sees only what belongs to them." },
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-[#050913] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(700px 420px at 20% 10%, #155eef26, transparent 60%), radial-gradient(600px 400px at 90% 90%, #071b42, transparent 70%)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(#ffffff06_1px,transparent_1px),linear-gradient(90deg,#ffffff06_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="relative flex items-center gap-3">
          <OperviaMark className="size-9" />
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Opervia Approval Portal</div>
            <div className="text-xs text-muted">Client content approval & publishing</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-[34px] font-semibold leading-[1.1] tracking-tight">
            From submission to <span className="text-brand-bright">scheduled</span>, without the email chase.
          </h2>
          <ul className="mt-10 space-y-6">
            {points.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[#1e3a70] bg-[#0b1730] text-[#8fb8ff]">
                  <Icon className="size-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-0.5 text-sm text-muted">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <MadeByOpervia className="relative self-start" />
      </aside>
      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <OperviaMark className="size-9" />
          <div className="text-[15px] font-semibold tracking-tight">Opervia Approval Portal</div>
        </div>
        <div className="w-full max-w-[400px] animate-slide-up">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </div>
        <MadeByOpervia className="mt-12 lg:hidden" />
      </main>
    </div>
  );
}
