import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Car, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/vehicles")({
  head: () => ({ meta: [{ title: "Vehicles — SocioHub" }] }),
  component: SocietyVehicles,
});

interface Row {
  id: string; plate_number: string; make_model: string | null;
  color: string | null; type: string;
  flat_number: string | null; block_name: string | null;
  owner_name: string | null;
}

function SocietyVehicles() {
  const { societyId, loading: sl } = useSocietyId();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!societyId) { if (!sl) setLoading(false); return; }
    (async () => {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, plate_number, make_model, color, type, user_id, flat_id")
        .eq("society_id", societyId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) { toast.error(error.message); setLoading(false); return; }
      const list = (data as any[]) ?? [];
      const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
      const flatIds = [...new Set(list.map((r) => r.flat_id).filter(Boolean))];
      const [profsRes, flatsRes] = await Promise.all([
        userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
        flatIds.length ? supabase.from("flats").select("id, flat_number, block:blocks(name)").in("id", flatIds) : Promise.resolve({ data: [] as any[] }),
      ]);
      const profMap = new Map<string, string | null>(((profsRes as any).data ?? []).map((p: any) => [p.id, p.full_name]));
      const flatMap = new Map<string, { flat_number: string; block_name: string | null }>(((flatsRes as any).data ?? []).map((f: any) => [f.id, { flat_number: f.flat_number, block_name: f.block?.name ?? null }]));
      setRows(list.map((r) => ({
        id: r.id, plate_number: r.plate_number, make_model: r.make_model,
        color: r.color, type: r.type,
        flat_number: flatMap.get(r.flat_id)?.flat_number ?? null,
        block_name: flatMap.get(r.flat_id)?.block_name ?? null,
        owner_name: profMap.get(r.user_id) ?? null,
      })));
      setLoading(false);
    })();
  }, [societyId, sl]);

  const filtered = useMemo(() => rows.filter((r) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return r.plate_number.toLowerCase().includes(t)
      || r.make_model?.toLowerCase().includes(t)
      || r.owner_name?.toLowerCase().includes(t)
      || r.flat_number?.toLowerCase().includes(t);
  }), [rows, q]);

  if (sl || loading) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <PageShell>
      <PageHeader title="Vehicles" description="All registered vehicles in your society." />
      {rows.length === 0 ? (
        <EmptyState icon={Car} title="No vehicles yet" description="Residents can add their vehicles from the app." />
      ) : (
        <>
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search plate, owner, flat" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 rounded-xl" />
          </div>
          <div className="rounded-2xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plate</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Flat</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.plate_number}</TableCell>
                    <TableCell className="text-sm">{r.make_model ?? "—"}{r.color ? ` · ${r.color}` : ""}</TableCell>
                    <TableCell className="text-sm">{r.owner_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.block_name ? `${r.block_name}-` : ""}{r.flat_number ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary" className="rounded-md capitalize">{r.type}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </PageShell>
  );
}
