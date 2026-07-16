import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { DoorOpen, Plus, Loader2, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getSocietyStructureOverview,
  listSocietyUnitsPage,
  createSocietyUnit,
  type StructureOverview,
  type UnitListItem,
} from "@/lib/society-structure";

export const Route = createFileRoute("/_society/society/flats")({
  head: () => ({ meta: [{ title: "Units — SociyoHub" }] }),
  component: FlatsPage,
});

interface BlockOpt { id: string; name: string }

const PAGE_SIZE = 25;

function FlatsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [overview, setOverview] = useState<StructureOverview | null>(null);
  const [blocks, setBlocks] = useState<BlockOpt[]>([]);
  const [items, setItems] = useState<UnitListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterBlock, setFilterBlock] = useState<string>("all");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blockId, setBlockId] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [type, setType] = useState("2BHK");

  const mode = overview?.structure_mode ?? null;
  const isSerial = mode === "serial";

  async function refresh(sid: string, opts?: { offset?: number; search?: string; blockId?: string }) {
    setLoading(true);
    try {
      const [ov, blks, page] = await Promise.all([
        getSocietyStructureOverview(sid),
        supabase.from("blocks").select("id, name").eq("society_id", sid).eq("is_active", true).order("display_order"),
        listSocietyUnitsPage({
          societyId: sid,
          search: opts?.search ?? search,
          blockId: (opts?.blockId ?? filterBlock) === "all" ? null : (opts?.blockId ?? filterBlock),
          limit: PAGE_SIZE,
          offset: opts?.offset ?? offset,
        }),
      ]);
      setOverview(ov);
      setBlocks((blks.data as BlockOpt[]) ?? []);
      setItems(page.items);
      setTotal(page.total);
      setOffset(page.offset);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load units");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (societyId) void refresh(societyId, { offset: 0 });
    else if (!sidLoading) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId, sidLoading]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !flatNumber.trim()) return;
    if (!isSerial && !blockId) {
      toast.error("Pick a block");
      return;
    }
    setSaving(true);
    try {
      const res = await createSocietyUnit({
        societyId,
        flatNumber: flatNumber.trim(),
        blockId: isSerial ? null : blockId,
        floor: isSerial ? null : floor ? parseInt(floor, 10) : null,
        unitType: type,
      });
      if (!res.ok) {
        toast.error(
          res.reason === "duplicate_label"
            ? "A unit with this label already exists"
            : res.reason === "structure_mode_not_configured"
            ? "Set the structure mode first (Setup wizard)."
            : "Could not create unit",
        );
      } else {
        toast.success("Unit added");
        setFlatNumber(""); setFloor(""); setOpen(false);
        void refresh(societyId);
      }
    } finally {
      setSaving(false);
    }
  }

  const hasNext = offset + PAGE_SIZE < total;
  const hasPrev = offset > 0;
  const page = useMemo(() => Math.floor(offset / PAGE_SIZE) + 1, [offset]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Units" />
        <EmptyState
          icon={DoorOpen}
          title="Set up your society first"
          action={<Button asChild><a href="/onboarding">Set up</a></Button>}
        />
      </PageShell>
    );
  }

  if (!loading && overview && !overview.configured) {
    return (
      <PageShell>
        <PageHeader title="Units" description="Every unit across your society." />
        <EmptyState
          icon={DoorOpen}
          title="Structure setup required"
          description="Choose Structured or Serial mode in the Setup wizard before adding units."
          action={<Button asChild><a href="/society/setup">Open Setup</a></Button>}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Units"
        description={
          isSerial
            ? "Direct houses in your society."
            : "Every unit across your blocks."
        }
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                className="rounded-xl min-h-11"
                disabled={!isSerial && blocks.length === 0}
              >
                <Plus className="h-4 w-4 mr-2" /> Add Unit
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader><DialogTitle>New unit</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                {!isSerial && (
                  <div className="space-y-2">
                    <Label>Block</Label>
                    <Select value={blockId} onValueChange={setBlockId}>
                      <SelectTrigger className="min-h-11"><SelectValue placeholder="Select block" /></SelectTrigger>
                      <SelectContent>
                        {blocks.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="num">{isSerial ? "House number" : "Flat number"}</Label>
                    <Input id="num" className="min-h-11" placeholder={isSerial ? "H-1" : "101"} value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} required />
                  </div>
                  {!isSerial && (
                    <div className="space-y-2">
                      <Label htmlFor="floor">Floor</Label>
                      <Input id="floor" className="min-h-11" type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["1RK", "1BHK", "2BHK", "3BHK", "4BHK", "Penthouse", "House", "Shop"].map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving} className="rounded-xl min-h-11">
                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 min-h-11"
            placeholder="Search unit or block…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && societyId) void refresh(societyId, { offset: 0 });
            }}
          />
        </div>
        {!isSerial && blocks.length > 0 && (
          <Select
            value={filterBlock}
            onValueChange={(v) => {
              setFilterBlock(v);
              if (societyId) void refresh(societyId, { offset: 0, blockId: v });
            }}
          >
            <SelectTrigger className="w-44 min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All blocks</SelectItem>
              {blocks.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={DoorOpen}
          title={total === 0 ? "No units yet" : "No units match this filter"}
          description={
            !isSerial && blocks.length === 0
              ? "Add a block first, then start creating units."
              : "Add your first unit to start onboarding residents."
          }
        />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-background overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  {!isSerial && <TableHead>Block</TableHead>}
                  {!isSerial && <TableHead>Floor</TableHead>}
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((f) => (
                  <TableRow key={f.id} className={f.is_active ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{f.flat_number}</TableCell>
                    {!isSerial && <TableCell>{f.block_name ?? "—"}</TableCell>}
                    {!isSerial && <TableCell>{f.floor ?? "—"}</TableCell>}
                    <TableCell>{f.unit_type ?? "—"}</TableCell>
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
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {page} of {totalPages} · {total} unit{total === 1 ? "" : "s"}</span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm" className="min-h-11"
                disabled={!hasPrev || loading}
                onClick={() => societyId && refresh(societyId, { offset: Math.max(0, offset - PAGE_SIZE) })}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <Button
                variant="outline" size="sm" className="min-h-11"
                disabled={!hasNext || loading}
                onClick={() => societyId && refresh(societyId, { offset: offset + PAGE_SIZE })}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
