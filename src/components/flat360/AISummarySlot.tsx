/**
 * AI Summary slot — Pro section placeholder.
 *
 * The provider is not implemented in this turn. This component defines the
 * typed boundary for the next dedicated turn (secure Pro AI Summary with
 * caching, rate limiting, and prompt-injection resistance).
 *
 * Rules:
 *   - no fake generated text
 *   - no working-looking refresh button
 *   - dev-only "coming soon" copy
 */
import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type AISummaryProviderState = "not_implemented" | "loading" | "ready" | "error";

export type AISummaryContract = {
  state: AISummaryProviderState;
  text?: string;
  updated_at?: string | null;
};

export function AISummarySlot({ contract }: { contract: AISummaryContract }) {
  const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
  return (
    <Card className="rounded-2xl border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-primary" /> AI Summary
          </h3>
          <Badge variant="outline" className="rounded-full text-[10px]">
            Pro
          </Badge>
        </div>
        {contract.state === "not_implemented" && (
          <p className="text-xs text-muted-foreground">
            {isDev
              ? "Coming in the next implementation stage."
              : "Not available yet."}
          </p>
        )}
        {contract.state === "loading" && (
          <p className="text-xs text-muted-foreground">Preparing summary…</p>
        )}
        {contract.state === "ready" && contract.text && (
          <p className="text-sm">{contract.text}</p>
        )}
        {contract.state === "error" && (
          <p className="text-xs text-muted-foreground">
            AI Summary is temporarily unavailable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
