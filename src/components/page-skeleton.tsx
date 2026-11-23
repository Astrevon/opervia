import { Skeleton } from "@/components/ui";

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-fade-in">
      <Skeleton className="mb-3 h-4 w-24" />
      <Skeleton className="mb-8 h-8 w-72" />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-[14px]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Skeleton className="h-72 rounded-[14px]" />
        <Skeleton className="h-72 rounded-[14px]" />
      </div>
    </div>
  );
}
