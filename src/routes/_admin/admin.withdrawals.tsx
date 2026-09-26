import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, IndianRupee, CheckCircle2, XCircle, Banknote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/admin/withdrawals")({
  head: () => ({ meta: [{ title: "Withdrawals — Admin" }] }),
  component: WithdrawalsAdmin,
});

interface Row {
  id: string;
  user_id: string;
  amount: number;
  method: string;
  upi_id: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  status: string;
  created_at: string;
  profile?: { full_name: string | null; email: string | null } | null;
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function WithdrawalsAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("pending");

  async function load() {
    setLoading(true);
    let q = supabase
      .from("withdrawals")
      .select("id, user_id, amount, method, upi_id, bank_account, bank_ifsc, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    const list = (data as Row[]) ?? [];
    // hydrate profiles
    const ids = Array.from(new Set(list.map((r) => r.user_id)));
    if (ids.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
      list.forEach((r) => (r.profile = map.get(r.user_id) ?? null));
    }
    setRows(list);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function setStatus(id: string, status: "paid" | "rejected" | "approved") {
    const { error } = await supabase.from("withdrawals").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${status}`);
    void load();
  }

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Withdrawals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Review and pay out referral commissions</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-border p-1 bg-background">
          {(["pending", "paid", "all"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "ghost"}
              className="rounded-lg capitalize"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="text-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            <Banknote className="h-8 w-8 mx-auto mb-2 opacity-50" />
            No {filter !== "all" ? filter : ""} withdrawal requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="rounded-2xl">
              <CardContent className="p-5 flex items-center gap-4 flex-wrap">
                <div className="h-12 w-12 rounded-xl grid place-items-center bg-primary/10 text-primary">
                  <IndianRupee className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold">
                    {r.profile?.full_name || "Unknown"}{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      · {r.profile?.email}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {r.method === "upi"
                      ? `UPI: ${r.upi_id ?? "—"}`
                      : `A/c ${r.bank_account ?? "—"} · IFSC ${r.bank_ifsc ?? "—"}`}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Requested {new Date(r.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-semibold tabular-nums">{fmt.format(Number(r.amount))}</p>
                  <Badge
                    variant={r.status === "paid" ? "secondary" : "default"}
                    className="mt-1 rounded-full capitalize text-[10px]"
                  >
                    {r.status}
                  </Badge>
                </div>
                {r.status === "pending" && (
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => setStatus(r.id, "rejected")}
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-xl"
                      onClick={() => setStatus(r.id, "paid")}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> Mark paid
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
