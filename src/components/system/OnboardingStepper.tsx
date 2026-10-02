import { cn } from "@/lib/utils";

interface OnboardingStepperProps {
  step: number; // 1-based
  total: number;
  labels?: string[];
  className?: string;
}

/**
 * Minimal, mobile-first progress bar for multi-step onboarding flows.
 * Uses semantic tokens — adapts to light and dark themes automatically.
 */
export function OnboardingStepper({ step, total, labels, className }: OnboardingStepperProps) {
  const idx = Math.max(0, Math.min(step - 1, total - 1));
  return (
    <div className={cn("space-y-2", className)} aria-label={`Step ${step} of ${total}`}>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-300",
              i <= idx ? "bg-primary" : "bg-secondary",
            )}
          />
        ))}
      </div>
      {labels && labels[idx] && (
        <p className="text-xs text-muted-foreground">
          Step {step} of {total} — <span className="text-foreground font-medium">{labels[idx]}</span>
        </p>
      )}
    </div>
  );
}
