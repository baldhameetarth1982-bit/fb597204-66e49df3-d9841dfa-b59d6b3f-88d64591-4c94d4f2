import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tags, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { userMessage } from "@/lib/user-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/system/EmptyState";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Conversation, OfferCard, useCustomPlanThread } from "@/features/subscription/CustomPlan";

export const Route = createFileRoute("/_admin/admin/custom-plans")({
  head: () => ({
    meta: [
      { title: "Custom Plans — Super Admin" },
      { name: "description", content: "Review custom plan requests from societies with more than 300 flats and send offers." },
      { property: "og:title", content: "Custom Plans — Super Admin" },
      { property: "og:description", content: "Custom plan requests and offers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CustomPlansPage,
});

const db = supabase as any;
type Req = { id: string; society_id: string; flat_quantity: number; status: string; created_at: string; societies?: { name: string } | null };

function CustomPlansPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const reqs = useQuery({
    queryKey: ["admin-custom-plan-requests"],
    queryFn: async () => {
      const { data, error } = await db.from("custom_plan_requests")
        .select("id,society_id,flat_quantity,status,created_at,societies(name)")
        .order("updated_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Req[];
    },
  });
  const sel = (reqs.data ?? []).find((r) => r.id === selected) ?? null;
  return (
    <PageShell>
      <PageHeader title="Custom plans" description="Requests from societies above the standard flat limit." icon={Tags} />
      {reqs.isLoading ? <Skeleton className="h-40 w-full" />
        : reqs.isError ? <ErrorState title="Couldn't load requests" description="Please try again." onRetry={() => reqs.refetch()} />
        : !reqs.data?.length ? <EmptyState icon={Tags} title="No custom plan requests yet" description="Requests appear here when a society asks for more than 300 flats." />
        : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <ul className="divide-y rounded-2xl border bg-card">
              {reqs.data.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setSelected(r.id)} aria-current={r.id === selected}
                    className={`flex w-full min-h-14 items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-muted ${r.id === selected ? "bg-muted" : ""}`}>
                    <span className="min-w-0"><span className="block truncate font-medium">{r.societies?.name ?? "Society"}</span>
                      <span className="text-xs text-muted-foreground">{r.flat_quantity} flats · {new Date(r.created_at).toLocaleDateString("en-IN")}</span></span>
                    <Badge variant="outline" className="capitalize">{r.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
            {sel ? <RequestDetail req={sel} /> : <p className="text-sm text-muted-foreground p-4">Select a request.</p>}
          </div>
        )}
    </PageShell>
  );
}

function RequestDetail({ req }: { req: Req }) {
  const qc = useQueryClient();
  const { offers } = useCustomPlanThread(req.id);
  const [plan, setPlan] = useState("premium");
  const [rate, setRate] = useState("");
  const [qty, setQty] = useState(String(req.flat_quantity));
  const [term, setTerm] = useState("1");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const canOffer = req.status === "open" || req.status === "offered";
  const create = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const r = Number(rate), q = Number(qty), t = Number(term);
      if (!(r > 0 && r <= 1000) || !Number.isInteger(q) || q < 1 || !Number.isInteger(t) || t < 1 || t > 36) throw new Error("Check the rate, flats and term.");
      const { error } = await db.rpc("admin_create_custom_offer", {
        _request_id: req.id, _plan_id: plan, _rate_per_flat_inr: r, _flat_quantity: q, _term_months: t, _effective_from: from,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Offer sent to the society.");
      qc.invalidateQueries({ queryKey: ["custom-plan-offers", req.id] });
      qc.invalidateQueries({ queryKey: ["custom-plan-messages", req.id] });
      qc.invalidateQueries({ queryKey: ["admin-custom-plan-requests"] });
    },
    onError: (e) => toast.error(userMessage(e, "Couldn't send the offer. Please try again.")),
  });
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
      <p className="font-semibold">{req.societies?.name} · {req.flat_quantity} flats requested</p>
      {offers.isError ? <ErrorState title="Couldn't load offers" description="Please try again." onRetry={() => offers.refetch()} />
        : (offers.data ?? []).slice(0, 3).map((o) => <OfferCard key={o.id} offer={o} />)}
      {canOffer && (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!create.isPending) create.mutate(); }}>
          <div className="space-y-1"><Label>Features</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="basic">Starter</SelectItem><SelectItem value="pro">Growth</SelectItem><SelectItem value="premium">Pro</SelectItem></SelectContent>
            </Select></div>
          <div className="space-y-1"><Label htmlFor="o-rate">Rate per flat per month (₹)</Label>
            <Input id="o-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="h-11" /></div>
          <div className="space-y-1"><Label htmlFor="o-qty">Purchased flats</Label>
            <Input id="o-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} className="h-11" /></div>
          <div className="space-y-1"><Label htmlFor="o-term">Term (months)</Label>
            <Input id="o-term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value.replace(/\D/g, ""))} className="h-11" /></div>
          <div className="space-y-1"><Label htmlFor="o-from">Effective from</Label>
            <Input id="o-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" /></div>
          <div className="flex items-end">
            <Button type="submit" disabled={create.isPending || !rate} className="h-11 rounded-xl w-full">
              {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />} Send offer
            </Button>
          </div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">The server calculates the total (flats × rate × term + configured tax). No platform fee.</p>
        </form>
      )}
      <Conversation requestId={req.id} mySide="platform" closed={req.status === "declined" || req.status === "closed"} />
    </div>
  );
}
