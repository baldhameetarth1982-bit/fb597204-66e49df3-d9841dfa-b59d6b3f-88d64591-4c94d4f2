import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void } | ReactNode;
  className?: string;
}

/** Reusable empty state — icon + title + description + primary action. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}
    >
      <div className="grid h-16 w-16 place-items-center rounded-full bg-primary-container text-primary-container-foreground">
        <Icon className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="mt-4 type-title">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-5">
          {typeof action === "object" && action !== null && "label" in (action as any) ? (
            <Button onClick={(action as any).onClick}>{(action as any).label}</Button>
          ) : (
            (action as ReactNode)
          )}
        </div>
      )}
    </div>
  );
}
