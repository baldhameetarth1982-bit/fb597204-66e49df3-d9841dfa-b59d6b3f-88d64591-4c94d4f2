import { Link } from "@tanstack/react-router";
import { Lock, Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FEATURE_LABELS,
  FEATURE_MIN_PLAN,
  PLAN_LABELS,
  type FeatureKey,
  type PlanKey,
} from "@/lib/plan-features";

interface Props {
  feature: FeatureKey;
  currentPlan: PlanKey;
  compact?: boolean;
}

export function UpgradePrompt({ feature, currentPlan, compact }: Props) {
  const required = FEATURE_MIN_PLAN[feature];
  const featureName = FEATURE_LABELS[feature];

  return (
    <Card className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
      <CardContent className={compact ? "p-5" : "p-6 sm:p-8"}>
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/15 text-primary grid place-items-center shrink-0">
            <Lock className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-primary text-primary-foreground">
                <Sparkles className="h-3 w-3 mr-1" />
                {PLAN_LABELS[required]} plan
              </Badge>
              <Badge variant="secondary" className="rounded-full">
                You're on {PLAN_LABELS[currentPlan]}
              </Badge>
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Unlock {featureName}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {featureName} is available on the {PLAN_LABELS[required]} plan. Upgrade your society
                subscription to enable it for your team and residents.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="rounded-xl">
                <Link to="/society/plan-required">
                  Upgrade to {PLAN_LABELS[required]} <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="rounded-xl">
                <Link to="/pricing">Compare plans</Link>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
