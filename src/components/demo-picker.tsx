import { FlaskConical } from "lucide-react";
import { Avatar, Notice } from "@/components/ui";
import { demoSignInAction } from "@/app/actions/demo";
import { DEMO_PEOPLE } from "@/lib/demo/store";

/** DEMO MODE sign-in: choose a fictional person. No password, no Supabase. */
export function DemoPicker() {
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="amber" icon={<FlaskConical className="size-4 text-warn" />} title="Local demo mode">
        Fictional data kept in memory on this computer. Nothing is sent anywhere, and the data resets when you stop the demo.
      </Notice>
      <form action={demoSignInAction} className="flex flex-col gap-2">
        {DEMO_PEOPLE.map((p) => (
          <button
            key={p.id}
            name="person"
            value={p.id}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-[#2a4a8a] hover:bg-surface-2"
          >
            <Avatar name={p.name} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{p.name}</span>
              <span className="block truncate text-xs text-muted">
                {p.title} · {p.subtitle}
              </span>
            </span>
            <span className="text-xs text-brand-bright">Enter →</span>
          </button>
        ))}
      </form>
      <p className="text-center text-xs text-subtle">Tip: open a second browser (or a private window) to be the client and the agency at the same time.</p>
    </div>
  );
}
