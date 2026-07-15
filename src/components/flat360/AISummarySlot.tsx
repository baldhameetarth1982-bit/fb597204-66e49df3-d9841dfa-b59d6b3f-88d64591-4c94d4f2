/**
 * AI Unit Summary — display slot for the strict Flat 360 AI response.
 *
 * Renders the safe Flat360AISummaryResponse contract from
 * `src/lib/flat360-ai.server.ts`. Never displays raw provider output,
 * prompts, model names, tokens, stack traces, or internal reason codes.
 */
import { Link } from "@tanstack/react-router";
import { Sparkles, Lock, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AISummaryResult,
  Flat360AISummaryResponse,
} from "@/lib/flat360-ai.server";
import { AI_ALLOWED_ROUTES } from "@/lib/flat360-types";

export type AISummaryUiState =
  | { kind: "locked" }
  | { kind: "loading" }
  | { kind: "response"; response: Flat360AISummaryResponse }
  | { kind: "error" };

function reasonCopy(reason: Flat360AISummaryResponse["reason"]): string | null {
  switch (reason) {
    case "provider_unavailable":
      return "AI service is temporarily unavailable — showing a deterministic summary instead.";
    case "rate_limited":
      return "Refresh limit reached — showing the most recent summary. Try again shortly.";
    case "validation_failed":
      return "Latest AI result didn't meet safety checks — showing a deterministic summary instead.";
    case "financial_data_unavailable":
      return "Financial data is unavailable for this unit right now.";
    case "temporarily_unavailable":
      return "AI Summary is temporarily unavailable for this unit.";
    default:
      return null;
  }
}

function ActionButton({
  type,
  label,
  route,
}: {
  type: AISummaryResult["recommendedActions"][number]["type"];
  label: string;
  route?: string;
}) {
  const allowed = route && (AI_ALLOWED_ROUTES as readonly string[]).includes(route);
  if (!allowed || type === "none") {
    return (
      <Badge variant="outline" className="rounded-full text-[11px]">
        {label}
      </Badge>
    );
  }
  return (
    <Button asChild size="sm" variant="outline" className="rounded-xl h-9 min-h-[36px]">
      {/* Route is validated against AI_ALLOWED_ROUTES; safe to cast for typed Link. */}
      <Link to={route as never}>{label}</Link>
    </Button>
  );
}

export function AISummarySlot({
  state,
  canRefresh,
  onRefresh,
}: {
  state: AISummaryUiState;
  canRefresh?: boolean;
  onRefresh?: () => void;
}) {
  const isLoading = state.kind === "loading";
  const response = state.kind === "response" ? state.response : null;
  const result = response?.result;
  const reasonText = response?.reason ? reasonCopy(response.reason) : null;
  const cached = !!response?.cached;
  const fallback = response?.source === "deterministic_fallback";

  return (
    <Card
      className="rounded-2xl border-primary/20"
      aria-busy={isLoading || undefined}
      aria-live="polite"
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold truncate">AI Unit Summary</h3>
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                <Badge variant="outline" className="rounded-full text-[10px]">Pro</Badge>
                {cached && (
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    Cached result
                  </Badge>
                )}
                {fallback && (
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    Deterministic fallback
                  </Badge>
                )}
              </div>
            </div>
          </div>
          {state.kind === "response" && onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl h-9 min-h-[36px] px-3"
              onClick={onRefresh}
              disabled={!canRefresh || isLoading}
              aria-label="Refresh AI summary"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              <span className="ml-1.5 text-xs">Refresh</span>
            </Button>
          )}
        </div>

        {state.kind === "locked" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Lock className="h-4 w-4" aria-hidden="true" />
            <span>AI Summary is available on Pro and Premium plans.</span>
          </div>
        )}

        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Preparing AI summary…</span>
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <span>AI Summary is temporarily unavailable.</span>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{result.headline}</p>
            {result.overview && (
              <p className="text-sm text-muted-foreground">{result.overview}</p>
            )}
            {result.highlights.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                {result.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
            {result.warnings.length > 0 && (
              <ul className="text-xs text-amber-600 list-disc pl-4 space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {result.recommendedActions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {result.recommendedActions.map((a, i) => (
                  <ActionButton key={i} type={a.type} label={a.label} route={a.route} />
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
              <span>
                {response?.generatedAt
                  ? `Updated ${new Date(response.generatedAt).toLocaleString("en-IN")}`
                  : fallback
                    ? "Generated from operational records"
                    : ""}
              </span>
              {reasonText && <span className="text-right ml-2">{reasonText}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
