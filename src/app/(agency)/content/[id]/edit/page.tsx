import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ContentForm } from "@/components/content-form";
import { updateContentAction } from "@/app/actions/content";
import { contentFormOptions } from "@/lib/form-options";
import { getItemBundle } from "@/lib/data";
import { requireAgency } from "@/lib/session";

export const metadata: Metadata = { title: "Edit submission" };

export default async function EditContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAgency();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const bundle = await getItemBundle(id);
  if (!bundle) notFound();
  const { item, versions } = bundle;
  if (!["draft", "revision_required"].includes(item.status)) redirect(`/content/${id}`);
  const working = versions.find((v) => v.version_number === item.current_version);
  const { clients, members } = await contentFormOptions(item.client_id);

  return (
    <>
      <PageHeader
        eyebrow={item.status === "revision_required" ? "Revision" : "Draft"}
        title={`Edit “${item.title}”`}
        description={
          item.status === "revision_required"
            ? `You're editing v${item.current_version}, a new version. Earlier versions stay exactly as the client saw them.`
            : "Changes are saved to the draft. Nothing is sent until you choose “Send for approval”."
        }
      />
      <ContentForm
        action={updateContentAction.bind(null, id)}
        clients={clients}
        members={members}
        lockClient={item.status === "revision_required"}
        initial={{
          client_id: item.client_id,
          title: item.title,
          content_type: item.content_type,
          platform: item.platform,
          assignee_id: item.assignee_id,
          due_date: item.due_date,
          planned_publish_at: item.planned_publish_at,
          description: working?.description ?? "",
          body: working?.body ?? "",
        }}
        cancelHref={`/content/${id}`}
        submitLabel="Save changes"
        versionLabel={`v${item.current_version} · working version`}
      />
    </>
  );
}
