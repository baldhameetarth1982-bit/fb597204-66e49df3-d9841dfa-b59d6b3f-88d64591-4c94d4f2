import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";

const toneClass: Record<Tone, string> = {
  success: "bg-success-container text-success-container-foreground",
  warning: "bg-warning-container text-warning-container-foreground",
  danger: "bg-danger-container text-danger-container-foreground",
  info: "bg-info-container text-info-container-foreground",
  primary: "bg-primary-container text-primary-container-foreground",
  neutral: "bg-muted text-muted-foreground",
};

/** Semantic status chip that inherits from design tokens (light + dark safe). */
export function StatusChip({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {icon && <span className="grid place-items-center h-3.5 w-3.5">{icon}</span>}
      {children}
    </span>
  );
}
