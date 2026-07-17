import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useMemo, useState } from "react";
import { Car, Loader2, Search, Power } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  listSocietyVehicles, deactivateVehicleAsAdmin,
} from "@/lib/residents-admin.functions";

export const Route = createFileRoute("/_society/society/vehicles")({
  head: () => ({ meta: [{ title: "Vehicles — SociyoHub" }] }),
  component: () => (<FeatureGate feature="vehicles"><SocietyVehicles /></FeatureGate>),
});

function SocietyVehicles() {
  const { societyId, loading: sl } = useSocietyId();
  const qc = useQueryClient();
  const list = useServerFn(listSocietyVehicles);
  const deactivate = useServerFn(deactivateVehicleAsAdmin);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [confirmId, setConfirmId] = useState<{ id: string; plate: string } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
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

  async function onDeactivate() {
    if (!confirmId || !societyId) return;
    try {
      await deactivate({ data: { societyId, id: confirmId.id } });
      toast.success("Vehicle deactivated. History preserved.");
      qc.invalidateQueries({ queryKey: ["society-vehicles", societyId] });
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? "operation_failed";
      toast.error(msg === "forbidden" ? "Not allowed." : "Could not deactivate. Try again.");
    } finally {
      setConfirmId(null);
    }
  }

  if (sl || isLoading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <PageShell>
      <PageHeader title="Vehicles" description="All registered vehicles in your society." />
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search plate, owner, unit" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 rounded-xl" />
        </div>
        <Button
          size="sm"
          variant={showInactive ? "default" : "outline"}
          className="rounded-xl h-10 min-w-[44px]"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Showing history" : "Show inactive history"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Car} title="No vehicles yet" description="Residents can add their vehicles from the app." />
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plate</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id} className={r.is_active ? "" : "opacity-60"}>
                  <TableCell className="font-semibold">{r.plate_number}</TableCell>
                  <TableCell className="text-sm">{r.make_model ?? "—"}{r.color ? ` · ${r.color}` : ""}</TableCell>
                  <TableCell className="text-sm">{r.owner_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{r.block_name ? `${r.block_name}-` : ""}{r.flat_number ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary" className="rounded-md capitalize">{r.type}</Badge></TableCell>
                  <TableCell>
                    {r.is_active ? (
                      <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">Inactive (history)</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.is_active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 min-w-[44px]"
                        onClick={() => setConfirmId({ id: r.id, plate: r.plate_number })}
                      >
                        <Power className="h-3.5 w-3.5 mr-1" /> Deactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(v) => { if (!v) setConfirmId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate vehicle {confirmId?.plate}?</AlertDialogTitle>
            <AlertDialogDescription>
              The record is not permanently deleted. Its registration number stays unchanged and history remains
              available for Flat 360, audit and reactivation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDeactivate}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
