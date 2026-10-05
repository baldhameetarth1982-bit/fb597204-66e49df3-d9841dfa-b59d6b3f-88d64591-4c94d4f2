import { useTranslation } from "react-i18next";
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
  title,
  description,
  onRetry,
  retryLabel,
  showSupport = true,
  className = "",
}: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-10 ${className}`}
      role="alert"
    >
      <div className="grid h-16 w-16 place-items-center rounded-full bg-danger-container text-danger-container-foreground">
        <AlertTriangle className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="mt-4 type-title">{title ?? t("state.error.title")}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground leading-relaxed">
        {description ?? t("state.error.body")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden />
            {retryLabel ?? t("common.tryAgain")}
          </Button>
        )}
        {showSupport && (
          <Button asChild variant="outline">
            <Link to="/contact">{t("common.contactSupport")}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
