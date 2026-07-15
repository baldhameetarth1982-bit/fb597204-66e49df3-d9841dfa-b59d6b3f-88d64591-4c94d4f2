import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
} from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getIncomeRecordDetailFn } from "@/lib/non-member-income.functions";
import type { IncomeRecordDetail } from "@/lib/non-member-income.server";

export const Route = createFileRoute("/_society/society/income/$id")({
  head: () => ({
    meta: [
      { title: "Income Record — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="non_member_payments">
      <IncomeDetail />
    </FeatureGate>
  ),
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function IncomeDetail() {
  const { id } = Route.useParams();
  const { societyId, loading } = useSocietyId();
  const getDetail = useServerFn(getIncomeRecordDetailFn);

  const q = useQuery({
    enabled: !!societyId && !!id,
    queryKey: ["society-income", "detail", societyId, id],
    retry: (n, e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      return n < 1 && !msg.includes("forbidden") && !msg.includes("not_found");
    },
    queryFn: async () => getDetail({ data: { societyId: societyId!, id } }),
  });

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const result = q.data;
  const isServerError = q.isError || result?.status === "error";
  const isNotFound = result?.status === "not_found";

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
      <Link
        to="/society/income"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Income & Collections
      </Link>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading record…
          </CardContent>
        </Card>
      ) : isServerError ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> This record is temporarily unavailable.
          </CardContent>
        </Card>
      ) : isNotFound ? (
        <Card>
          <CardContent className="p-6 text-sm">
            <div className="font-medium">Record not found</div>
            <div className="text-muted-foreground mt-1">
              This income record doesn't exist or you don't have access.
            </div>
          </CardContent>
        </Card>
      ) : result?.status === "available" ? (
        <RecordView r={result.record} />
      ) : null}
    </div>
  );
}

interface TimelineEvent {
  label: string;
  when: string | null;
  icon: LucideIcon;
}

function buildTimeline(r: IncomeRecordDetail): TimelineEvent[] {
  const events: Array<TimelineEvent | null> = [
    { label: "Recorded", when: r.created_at, icon: Clock },
    r.verification_status === "verified" || r.verified_at
      ? { label: "Verified", when: r.verified_at, icon: CheckCircle2 }
      : null,
    r.verification_status === "rejected"
      ? { label: "Rejected", when: null, icon: XCircle }
      : null,
    r.verification_status === "reversed" || r.reversed_at
      ? { label: "Reversed", when: r.reversed_at, icon: RotateCcw }
      : null,
  ];
  return events.filter((e): e is TimelineEvent => e !== null);
}

function RecordView({ r }: { r: IncomeRecordDetail }) {
  const events = buildTimeline(r);

  return (
    <>
      <MobileHero
        title={r.category?.display_name ?? "Income record"}
        subtitle={`${r.payment_date} · ${r.payment_method.replace(/_/g, " ")}`}
      />
      <SectionCard title="Details">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Field label="Amount">
            <span className="text-lg font-semibold tabular-nums">{inr(r.amount)}</span>
          </Field>
          <Field label="Payment method">
            <span className="capitalize">{r.payment_method.replace(/_/g, " ")}</span>
          </Field>
          <Field label="Payment date">{r.payment_date}</Field>
          <Field label="Payment status">
            <span className="capitalize">{r.payment_status}</span>
          </Field>
          <Field label="Verification">
            <Badge variant="outline" className="capitalize">
              {r.verification_status}
            </Badge>
          </Field>
          <Field label="Reconciliation">
            <Badge variant="outline" className="capitalize">
              {r.reconciliation_status.replace(/_/g, " ")}
            </Badge>
          </Field>
          <Field label="Reference">{r.reference_suffix ?? "—"}</Field>
          <Field label="Payer">
            {r.payer_kind === "anonymous"
              ? "Anonymous"
              : r.payer
                ? `${r.payer.display_name}${r.payer.organization_name ? ` (${r.payer.organization_name})` : ""}`
                : "—"}
          </Field>
          {r.description && (
            <Field label="Description" full>
              <span className="text-muted-foreground">{r.description}</span>
            </Field>
          )}
          {r.reversal_reason && (
            <Field label="Reversal reason" full>
              <span className="text-muted-foreground">{r.reversal_reason}</span>
            </Field>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Timeline">
        <ol className="space-y-2 text-sm">
          {events.map((e, i) => {
            const Icon = e.icon;
            return (
              <li key={i} className="flex items-start gap-2">
                <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="font-medium">{e.label}</div>
                  {e.when && (
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.when).toLocaleString()}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </SectionCard>
    </>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
