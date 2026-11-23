import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ContentForm } from "@/components/content-form";
import { createContentAction } from "@/app/actions/content";
import { contentFormOptions } from "@/lib/form-options";
import { requireAgency } from "@/lib/session";

export const metadata: Metadata = { title: "New submission" };

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams;
  const session = await requireAgency();
  const { clients, members } = await contentFormOptions();

  return (
    <>
      <PageHeader
        eyebrow="Content"
        title="New submission"
        description="Build the approval package. It's saved as a draft (v1) — attach files on the next screen, then send it to the client."
      />
      {clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="size-5" />}
            title="No active clients yet"
            description={session.role === "admin" ? "Add a client account before creating content." : "Ask an admin to add a client account first."}
            action={session.role === "admin" ? <LinkButton href="/clients">Add a client</LinkButton> : undefined}
          />
        </Card>
      ) : (
        <ContentForm
          action={createContentAction}
          clients={clients}
          members={members}
          initial={{ client_id: clients.some((c) => c.id === client) ? client : "", assignee_id: session.userId }}
          cancelHref="/content"
          submitLabel="Save draft"
          versionLabel="v1 · draft"
        />
      )}
    </>
  );
}
