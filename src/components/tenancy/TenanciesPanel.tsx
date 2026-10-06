import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TenancyStateBadge } from "./TenancyStateBadge";
import { listTenancies, setTenancyWarningDays } from "@/lib/tenancy.functions";
import { cn } from "@/lib/utils";
import { tu } from "@/lib/i18n";

type F = "current" | "expiring" | "expired";
const TABS: { id: F; label: string }[] = [
  { id: "current", label: "Current" }, { id: "expiring", label: "Expiring" }, { id: "expired", label: "Expired" },
];

export function TenanciesPanel({ societyId }: { societyId: string }) {
  const [f, setF] = useState<F>("expiring");
  const list = useServerFn(listTenancies);
  const q = useQuery({
    queryKey: ["tenancies", societyId, f],
    queryFn: () => list({ data: { societyId, filter: f } }),
    staleTime: 30_000, retry: false, placeholderData: (p) => p,
  });
  const [days, setDays] = useState("");
  const save = useServerFn(setTenancyWarningDays);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => save({ data: { societyId, days: Number(days) } }),
    onSuccess: () => { toast.success(tu("op.warning_period_saved")); setDays(""); void qc.invalidateQueries({ queryKey: ["tenancies"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="rounded-2xl mb-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{tu("op.tenancies")}</h2>
          <div role="tablist" className="flex gap-1 rounded-xl bg-muted p-1">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={f === t.id} onClick={() => setF(t.id)}
                className={cn("min-h-11 px-3 rounded-lg text-sm", f === t.id ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {q.isLoading ? <div className="h-20 rounded-xl bg-muted animate-pulse" />
          : q.error ? <p className="text-sm text-destructive">{(q.error as Error).message}</p>
          : (q.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No {f} tenancies.</p>
          : (
            <ul className="divide-y">
              {(q.data ?? []).map((t) => (
                <li key={t.flat_resident_id}>
                  <Link to="/society/flats/$id" params={{ id: t.flat_id }} className="flex items-center justify-between gap-2 py-2 min-h-11">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{t.resident_name ?? tu("op.tenant")} · Flat {t.flat_number}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.lease_ends_on ? `Lease ends ${t.lease_ends_on}` : tu("op.no_end_date")}
                        {t.days_remaining != null && t.days_remaining >= 0 ? ` · ${t.days_remaining} days left` : ""}
                      </p>
                    </div>
                    <TenancyStateBadge state={t.state} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="space-y-1">
            <Label htmlFor="warn-days" className="text-xs">{tu("op.warn_this_many_days_before")}</Label>
            <Input id="warn-days" type="number" min={1} max={180} placeholder="30" value={days} onChange={(e) => setDays(e.target.value)} className="min-h-11 w-28" />
          </div>
          <Button type="submit" variant="outline" className="min-h-11" disabled={!days || m.isPending}>{tu("common.save")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
