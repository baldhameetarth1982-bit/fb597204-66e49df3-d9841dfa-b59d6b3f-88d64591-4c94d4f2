import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Tags, Plus, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { EmptyState } from "@/components/system/EmptyState";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_admin/admin/custom-plans")({
  head: () => ({ meta: [{ title: "Custom Plans — Super Admin" }] }),
  component: CustomPlansPage,
});

interface CustomPlan {
  id: string;
  society_id: string;
  name: string;
  price: number;
  duration_days: number;
  notes: string | null;
  status: string;
  created_at: string;
  society?: { name: string } | null;
}
interface SocietyOpt {
  id: string;
  name: string;
}

function CustomPlansPage() {
  const [rows, setRows] = useState<CustomPlan[]>([]);
  const [societies, setSocieties] = useState<SocietyOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [grant, setGrant] = useState<CustomPlan | null>(null);
  const [granting, setGranting] = useState(false);
  const [grantReason, setGrantReason] = useState("");

  const [societyId, setSocietyId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("30");
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    setFailed(false);
    const [{ data: plans, error }, { data: socs }] = await Promise.all([
      (supabase as any)
        .from("custom_plans")
        .select("*, society:societies(name)")
        .order("created_at", { ascending: false }),
      supabase.from("societies").select("id,name").order("name"),
    ]);
    if (error) setFailed(true);
    setRows((plans as any) ?? []);
    setSocieties((socs as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function createPlan() {
    if (!societyId || !name || !price) return toast.error("Fill society, name and price");
    setSaving(true);
    const { error } = await (supabase as any).from("custom_plans").insert({
      society_id: societyId,
      name,
      price: Number(price),
      duration_days: Number(duration),
      transaction_fee_pct: 0,
      notes: notes || null,
      status: "active",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Custom plan created");
    setOpen(false);
    setName("");
    setPrice("");
    setDuration("30");
    setNotes("");
    setSocietyId("");
    void load();
  }

  async function grantToSociety() {
    if (!grant) return;
    if (grantReason.trim().length < 5) return toast.error("Write a reason (at least 5 characters)");
    setGranting(true);
    const { error } = await supabase.rpc("admin_apply_custom_plan", {
      _custom_plan_id: grant.id,
      _reason: grantReason.trim(),
    });
    setGranting(false);
    if (error)
      return toast.error(
        error.message.includes("reason_required")
          ? "A reason is required."
          : "Could not apply this plan. Please try again.",
      );
    setGrant(null);
    setGrantReason("");
    toast.success("Plan applied to society");
    void load();
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s
      ? rows.filter((r) => `${r.name} ${r.society?.name ?? ""}`.toLowerCase().includes(s))
      : rows;
  }, [rows, q]);

  return (
    <PageShell>
      <PageHeader
        title="Custom Plans"
        description="One-off subscription terms for a specific society."
        actions={
          <Button className="h-11 rounded-xl" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> New custom plan
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : failed ? (
        <ErrorState onRetry={load} showSupport={false} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No custom plans yet"
          description="Create one to set a bespoke price and duration for a society."
          action={{ label: "New custom plan", onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search custom plans"
              placeholder="Search plan or society"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 pl-9"
            />
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {filtered.map((p) => (
              <li
                key={p.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-medium">{p.name}</p>
                    <StatusChip
                      tone={p.status === "active" ? "success" : "neutral"}
                      className="capitalize"
                    >
                      {p.status}
                    </StatusChip>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.society?.name ?? "—"}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </p>
                </div>
                <p className="text-right font-semibold tabular-nums">
                  ₹{Number(p.price).toLocaleString("en-IN")}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {p.duration_days} days
                  </span>
                </p>
                <Button
                  variant="outline"
                  className="col-span-2 h-11 rounded-xl sm:col-span-1"
                  onClick={() => setGrant(p)}
                >
                  Grant now
                </Button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No plans match "{q}".
              </li>
            )}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New custom plan</DialogTitle>
            <DialogDescription>
              Saved as a draft offer. Use "Grant now" to apply it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Society</Label>
              <Select value={societyId} onValueChange={setSocietyId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Pick a society" />
                </SelectTrigger>
                <SelectContent>
                  {societies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-name">Plan name</Label>
              <Input
                id="cp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Premium — 6 months"
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cp-price">Price (₹)</Label>
                <Input
                  id="cp-price"
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-days">Days</Label>
                <Input
                  id="cp-days"
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-notes">Internal notes</Label>
              <Input
                id="cp-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} className="h-11 rounded-xl">
              Cancel
            </Button>
            <Button onClick={createPlan} disabled={saving} className="h-11 rounded-xl">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!grant} onOpenChange={(o) => !o && setGrant(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Grant "{grant?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {grant?.society?.name ?? "This society"} gets {grant?.duration_days} days of access
              immediately. This is recorded in the audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="grant-reason">Reason</Label>
            <Input
              id="grant-reason"
              className="h-11"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="e.g. Negotiated annual contract"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={granting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void grantToSociety();
              }}
              disabled={granting || grantReason.trim().length < 5}
            >
              {granting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Grant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
