import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  showSupport?: boolean;
  className?: string;
}

/** Reusable error surface — explanation + retry + optional support link. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this section. Please try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  showSupport = true,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}
      role="alert"
    >
      <div className="grid h-16 w-16 place-items-center rounded-full bg-danger-container text-danger-container-foreground">
        <AlertTriangle className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="mt-4 type-title">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden />
            {retryLabel}
          </Button>
        )}
        {showSupport && (
          <Button asChild variant="outline">
            <Link to="/contact">Contact support</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
