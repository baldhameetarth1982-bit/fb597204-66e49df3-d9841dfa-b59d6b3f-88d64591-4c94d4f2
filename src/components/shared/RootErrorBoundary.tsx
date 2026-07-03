import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { logClientError } from "@/lib/error-log.functions";

interface State {
  error: Error | null;
}

/**
 * Root error boundary. Catches render-time errors, logs a sanitized
 * record server-side (no PII, no third-party DSN), and shows a recovery UI.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logClientError({
      data: {
        kind: "boundary",
        message: error.message,
        stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`,
        url: typeof window !== "undefined" ? window.location.href : undefined,
      },
    }).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-dvh grid place-items-center p-6 bg-background">
        <div className="max-w-md w-full rounded-2xl border bg-card p-6 text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. Try reloading — if it keeps happening,
            sign out and back in.
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()} className="rounded-xl">
              Reload
            </Button>
            <Button
              variant="ghost"
              onClick={() => this.setState({ error: null })}
              className="rounded-xl"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** Wire global error + promise listeners once. Safe in SSR (guarded). */
let installed = false;
export function installGlobalErrorLogger() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    void logClientError({
      data: {
        kind: "error",
        message: e.message || "window.onerror",
        stack: e.error?.stack,
        url: window.location.href,
      },
    }).catch(() => {});
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    void logClientError({
      data: {
        kind: "unhandledrejection",
        message: typeof r === "string" ? r : r?.message || "unhandledrejection",
        stack: r?.stack,
        url: window.location.href,
      },
    }).catch(() => {});
  });
}
