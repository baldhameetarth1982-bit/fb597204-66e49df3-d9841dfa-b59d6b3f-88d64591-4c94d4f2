import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DoorOpen, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/flats")({
  head: () => ({ meta: [{ title: "Flats — SocioHub" }] }),
  component: FlatsPage,
});

interface Flat {
  id: string;
  flat_number: string;
  floor: number | null;
  type: string | null;
  area_sqft: number | null;
  status: string;
  blocks: { id: string; name: string } | null;
}
interface BlockOpt {
  id: string;
  name: string;
}

function FlatsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [flats, setFlats] = useState<Flat[]>([]);
  const [blocks, setBlocks] = useState<BlockOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filterBlock, setFilterBlock] = useState<string>("all");

  // form state
  const [blockId, setBlockId] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [type, setType] = useState("2BHK");
  const [area, setArea] = useState("");

  async function fetchAll(sid: string) {
    setLoading(true);
    const [{ data: bData }, { data: fData, error }] = await Promise.all([
      supabase.from("blocks").select("id, name").eq("society_id", sid).order("name"),
      supabase
        .from("flats")
        .select("id, flat_number, floor, type, area_sqft, status, blocks(id, name)")
        .eq("society_id", sid)
        .order("flat_number"),
    ]);
    if (error) toast.error(error.message);
    setBlocks((bData as BlockOpt[]) ?? []);
    setFlats((fData as unknown as Flat[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (societyId) void fetchAll(societyId);
    else if (!sidLoading) setLoading(false);
  }, [societyId, sidLoading]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !blockId || !flatNumber.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("flats").insert({
      society_id: societyId,
      block_id: blockId,
      flat_number: flatNumber.trim(),
      floor: floor ? parseInt(floor, 10) : null,
      type: type || null,
      area_sqft: area ? parseFloat(area) : null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Flat added");
    setFlatNumber("");
    setFloor("");
    setArea("");
    setOpen(false);
    void fetchAll(societyId);
  }

  const visible =
    filterBlock === "all"
      ? flats
      : flats.filter((f) => f.blocks?.id === filterBlock);

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Flats" />
        <EmptyState
          icon={DoorOpen}
          title="Set up your society first"
          action={<Button asChild><a href="/onboarding">Set up</a></Button>}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Flats"
        description="Every unit across your society."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl" disabled={blocks.length === 0}>
                <Plus className="h-4 w-4 mr-2" /> Add Flat
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle>New flat</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label>Block</Label>
                  <Select value={blockId} onValueChange={setBlockId}>
                    <SelectTrigger><SelectValue placeholder="Select block" /></SelectTrigger>
                    <SelectContent>
                      {blocks.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="num">Flat number</Label>
                    <Input id="num" placeholder="101" value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="floor">Floor</Label>
                    <Input id="floor" type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["1RK", "1BHK", "2BHK", "3BHK", "4BHK", "Penthouse"].map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="area">Area (sqft)</Label>
                    <Input id="area" type="number" value={area} onChange={(e) => setArea(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving} className="rounded-xl">
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {blocks.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <Label className="text-xs text-muted-foreground">Filter by block</Label>
          <Select value={filterBlock} onValueChange={setFilterBlock}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All blocks</SelectItem>
              {blocks.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title={blocks.length === 0 ? "Create a block first" : "No flats yet"}
          description={blocks.length === 0 ? "Flats live inside blocks. Add a block to get going." : "Add your first flat to start onboarding residents."}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flat</TableHead>
                <TableHead>Block</TableHead>
                <TableHead>Floor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.flat_number}</TableCell>
                  <TableCell>{f.blocks?.name ?? "—"}</TableCell>
                  <TableCell>{f.floor ?? "—"}</TableCell>
                  <TableCell>{f.type ?? "—"}</TableCell>
                  <TableCell>{f.area_sqft ? `${f.area_sqft} sqft` : "—"}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${f.status === "occupied" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
                      {f.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageShell>
  );
}
