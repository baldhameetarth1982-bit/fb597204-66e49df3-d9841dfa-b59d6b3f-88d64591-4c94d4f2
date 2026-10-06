import {
  PeopleAreaNav, StatusChip, SummaryStrip, ListSkeleton, SearchField, SegmentedFilter, LoadError, ListEmpty,
} from "@/components/people/PeopleUI";
import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useMemo, useState } from "react";
import { Car, Bike, Power, Home, User, Download } from "lucide-react";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
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
import { tu } from "@/lib/i18n";

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
      toast.success(tu("op.vehicle_deactivated_history_preserved"));
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
      <PageHeader title={tu("nav.vehicles")} description={tu("op.every_registered_vehicle_the_home")} />

      <SummaryStrip items={[
        { label: "Active vehicles", value: loading || isError ? "—" : active.length },
        { label: "Cars", value: loading || isError ? "—" : active.filter((r) => r.type === "car").length },
        { label: "Two-wheelers", value: loading || isError ? "—" : active.filter((r) => r.type !== "car").length },
        { label: "Without a home", value: loading || isError ? "—" : active.filter((r) => !r.flat_number).length },
      ]} />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchField label={tu("op.search_vehicles")} placeholder={tu("op.plate_model_owner_or_house")} value={q} onChange={setQ} />
        <SegmentedFilter<View> label={tu("op.vehicle_status")} value={view} onChange={setView} options={[
          { key: "active", label: "Active" },
          { key: "history", label: "Include history" },
        ]} />
        <Button variant="outline" className="min-h-11" disabled={loading || isError || filtered.length === 0} onClick={() => writeSafeWorkbook(filtered.map((r) => ({ Plate: r.plate_number, Type: r.type === "car" ? "Car" : "Two-wheeler", Model: r.make_model ?? "", Colour: r.color ?? "", House: r.flat_number ? `${r.block_name ? `${r.block_name}-` : ""}${r.flat_number}` : "", Owner: r.owner_name ?? "", Status: r.is_active ? "Active" : "Inactive" })), "Vehicles", `vehicles-${new Date().toISOString().slice(0, 10)}.xlsx`)}><Download className="mr-1 h-4 w-4" />{tu("exp.downloadList")}</Button>
      </div>

      {loading ? (
        <ListSkeleton />
      ) : isError ? (
        <LoadError title={tu("op.couldn_t_load_vehicles")} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <ListEmpty icon={Car} title={tu("vh.none")}>{tu("op.residents_add_their_vehicles_from")}</ListEmpty>
      ) : filtered.length === 0 ? (
        <ListEmpty icon={Car} title={tu("op.no_matching_vehicles")}>{tu("op.try_a_different_plate_name")}</ListEmpty>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-label={tu("nav.vehicles")}>
          {filtered.map((r) => {
            const Icon = r.type === "car" ? Car : Bike;
            const house = r.flat_number ? `${r.block_name ? `${r.block_name}-` : ""}${r.flat_number}` : null;
            return (
              <li key={r.id} className={"grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center " + (r.is_active ? "" : "bg-muted/40")}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="inline-block rounded-md border border-border bg-background px-2 py-0.5 font-mono text-sm font-semibold tracking-wide">{r.plate_number}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{r.make_model ?? tu("op.model_not_added")}{r.color ? ` · ${r.color}` : ""}</p>
                  </div>
                </div>
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <Home className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {house ? <span className="truncate">{tu("gd.houseLabel")} {house}</span> : <StatusChip tone="warning">{tu("gd.noHouse")}</StatusChip>}
                </p>
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{r.owner_name ?? tu("op.owner_not_linked")}</span>
                </p>
                <div className="flex items-center justify-between gap-2 md:justify-end">
                  {r.is_active ? <StatusChip tone="success">{tu("common.active")}</StatusChip> : <StatusChip tone="muted">{tu("op.inactive_history")}</StatusChip>}
                  {r.is_active && (
                    <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmId({ id: r.id, plate: r.plate_number })} aria-label={`Deactivate ${r.plate_number}`}>
                      <Power className="mr-1 h-4 w-4" /> {tu("exp.deactivate")}
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
            <AlertDialogTitle>{tu("op.deactivate_vehicle")} {confirmId?.plate}?</AlertDialogTitle>
            <AlertDialogDescription>
              {tu("op.the_record_is_not_permanently")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tu("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void onDeactivate(); }}>{tu("exp.deactivate")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
