"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <EmptyState
        icon={<AlertTriangle className="size-5 text-warn" />}
        title="Something went wrong"
        description="The page couldn't be loaded. This is usually temporary — try again. If it keeps happening, check that the database is reachable."
        action={<Button onClick={reset}>Try again</Button>}
      />
    </div>
  );
}
