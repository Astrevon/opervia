import { FileQuestion } from "lucide-react";
import { EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <EmptyState
        icon={<FileQuestion className="size-5" />}
        title="Not found"
        description="This page doesn't exist, or you don't have access to it."
        action={<LinkButton href="/">Go to your home page</LinkButton>}
      />
    </div>
  );
}
