import {
  PeopleAreaNav, StatusChip, SummaryStrip, ListSkeleton, SearchField, SegmentedFilter, LoadError, ListEmpty,
} from "@/components/people/PeopleUI";
import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useMemo, useState } from "react";
import { Car, Bike, Power, Home, User } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { listSocietyVehicles, deactivateVehicleAsAdmin } from "@/lib/residents-admin.functions";

export const Route = createFileRoute("/_society/society/vehicles")({
  head: () => ({ meta: [{ title: "Vehicles — SociyoHub" }, { name: "description", content: "Registered vehicles, their homes and owners." }] }),
  component: () => (<FeatureGate feature="vehicles"><SocietyVehicles /></FeatureGate>),
});

type View = "active" | "history";

function SocietyVehicles() {
  const { societyId, loading: sl } = useSocietyId();
  const qc = useQueryClient();
  const list = useServerFn(listSocietyVehicles);
  const deactivate = useServerFn(deactivateVehicleAsAdmin);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("active");
  const [confirmId, setConfirmId] = useState<{ id: string; plate: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const showInactive = view === "history";

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-vehicles", societyId, showInactive],
    queryFn: () => list({ data: { societyId: societyId!, activeOnly: !showInactive, limit: 200, offset: 0 } }),
  });

  const filtered = useMemo(() => rows.filter((r) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return r.plate_number.toLowerCase().includes(t)
      || (r.make_model?.toLowerCase().includes(t) ?? false)
      || (r.owner_name?.toLowerCase().includes(t) ?? false)
      || (r.flat_number?.toLowerCase().includes(t) ?? false);
  }), [rows, q]);

  const active = rows.filter((r) => r.is_active);
  const loading = sl || isLoading;

  async function onDeactivate() {
    if (!confirmId || !societyId || busy) return;
    setBusy(true);
    try {
      await deactivate({ data: { societyId, id: confirmId.id } });
      toast.success("Vehicle deactivated. History preserved.");
      qc.invalidateQueries({ queryKey: ["society-vehicles", societyId] });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "operation_failed";
      toast.error(msg === "forbidden" ? "Not allowed." : "Could not deactivate. Try again.");
    } finally {
      setBusy(false);
      setConfirmId(null);
    }
  }

  return (
    <PageShell>
      <PeopleAreaNav />
      <PageHeader title="Vehicles" description="Every registered vehicle, the home it belongs to and who owns it." />

      <SummaryStrip items={[
        { label: "Active vehicles", value: loading || isError ? "—" : active.length },
        { label: "Cars", value: loading || isError ? "—" : active.filter((r) => r.type === "car").length },
        { label: "Two-wheelers", value: loading || isError ? "—" : active.filter((r) => r.type !== "car").length },
        { label: "Without a home", value: loading || isError ? "—" : active.filter((r) => !r.flat_number).length },
      ]} />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField label="Search vehicles" placeholder="Plate, model, owner or house" value={q} onChange={setQ} />
        <SegmentedFilter<View> label="Vehicle status" value={view} onChange={setView} options={[
          { key: "active", label: "Active" },
          { key: "history", label: "Include history" },
        ]} />
      </div>

      {loading ? (
        <ListSkeleton />
      ) : isError ? (
        <LoadError title="Couldn't load vehicles" onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <ListEmpty icon={Car} title="No vehicles yet">Residents add their vehicles from the app. They'll appear here with their home.</ListEmpty>
      ) : filtered.length === 0 ? (
        <ListEmpty icon={Car} title="No matching vehicles">Try a different plate, name or house.</ListEmpty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-label="Vehicles">
          {filtered.map((r) => {
            const Icon = r.type === "car" ? Car : Bike;
            const house = r.flat_number ? `${r.block_name ? `${r.block_name}-` : ""}${r.flat_number}` : null;
            return (
              <li key={r.id} className={"grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center " + (r.is_active ? "" : "bg-muted/40")}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="inline-block rounded-md border border-border bg-background px-2 py-0.5 font-mono text-sm font-semibold tracking-wide">{r.plate_number}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{r.make_model ?? "Model not added"}{r.color ? ` · ${r.color}` : ""}</p>
                  </div>
                </div>
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {house ? <span className="truncate">House {house}</span> : <StatusChip tone="warning">No house</StatusChip>}
                </p>
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{r.owner_name ?? "Owner not linked"}</span>
                </p>
                <div className="flex items-center justify-between gap-2 md:justify-end">
                  {r.is_active ? <StatusChip tone="success">Active</StatusChip> : <StatusChip tone="muted">Inactive · history</StatusChip>}
                  {r.is_active && (
                    <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmId({ id: r.id, plate: r.plate_number })} aria-label={`Deactivate ${r.plate_number}`}>
                      <Power className="mr-1 h-4 w-4" /> Deactivate
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(v) => { if (!v && !busy) setConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate vehicle {confirmId?.plate}?</AlertDialogTitle>
            <AlertDialogDescription>
              The record is not permanently deleted. Its registration number stays unchanged and history remains
              available for Flat 360, audit and reactivation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onDeactivate(); }}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
