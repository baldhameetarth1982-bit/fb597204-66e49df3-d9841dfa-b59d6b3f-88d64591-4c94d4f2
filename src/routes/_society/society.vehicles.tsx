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
  flat: { flat_number: string; block: { name: string } | null } | null;
  owner: { full_name: string | null } | null;
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
        .select("id, plate_number, make_model, color, type, flat:flats(flat_number, block:blocks(name)), owner:profiles!vehicles_user_id_fkey(full_name)")
        .eq("society_id", societyId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) toast.error(error.message);
      setRows((data as any) ?? []);
      setLoading(false);
    })();
  }, [societyId, sl]);

  const filtered = useMemo(() => rows.filter((r) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return r.plate_number.toLowerCase().includes(t)
      || r.make_model?.toLowerCase().includes(t)
      || r.owner?.full_name?.toLowerCase().includes(t)
      || r.flat?.flat_number.toLowerCase().includes(t);
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
                    <TableCell className="text-sm">{r.owner?.full_name ?? "—"}</TableCell>
                    <TableCell className="text-sm">{r.flat?.block?.name ? `${r.flat.block.name}-` : ""}{r.flat?.flat_number ?? "—"}</TableCell>
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
