import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FEATURE_LABELS,
  FEATURE_MIN_PLAN,
  PLAN_LABELS,
  type FeatureKey,
} from "@/lib/plan-features";

interface Props {
  feature: FeatureKey;
  message?: string;
  href?: string;
}

/**
 * Compact locked-feature tile suitable for the More page, dashboard quick actions
 * or navigation cards. Clicking navigates to the upgrade screen.
 */
export function LockedFeatureCard({ feature, message, href = "/society/plan-required" }: Props) {
  const required = FEATURE_MIN_PLAN[feature];
  const label = FEATURE_LABELS[feature];
  return (
    <Link to={href as any} className="block">
      <Card className="rounded-2xl border-dashed border-primary/30 bg-muted/20 hover:bg-primary/5 transition">
        <CardContent className="p-4 flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
            <Lock className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate">{label}</p>
              <Badge variant="secondary" className="rounded-full text-[10px]">
                {PLAN_LABELS[required]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {message ?? `Upgrade to ${PLAN_LABELS[required]} to unlock ${label.toLowerCase()}.`}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
