import type { LucideIcon } from "lucide-react";

/** Generic empty-state used while modules are still being built. */
export function Placeholder({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="px-4 md:px-8 py-12 md:py-20 max-w-xl mx-auto text-center">
      <div className="mx-auto h-16 w-16 rounded-2xl bg-secondary grid place-items-center">
        <Icon className="h-7 w-7 text-primary" />
      </div>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">{description}</p>
    </div>
  );
}
