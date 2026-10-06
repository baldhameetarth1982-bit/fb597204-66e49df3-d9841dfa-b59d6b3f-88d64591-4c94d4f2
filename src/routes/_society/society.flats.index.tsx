import { PeopleAreaNav } from "@/components/people/PeopleUI";
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
import { userMessage } from "@/lib/user-error";
import {
  getSocietyStructureOverview,
  listSocietyUnitsPage,
  createSocietyUnit,
  type StructureOverview,
  type UnitListItem,
} from "@/lib/society-structure";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/flats/")({
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
      toast.error(tu("op.pick_a_block"));
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
        toast.success(tu("op.unit_added"));
        setFlatNumber(""); setFloor(""); setOpen(false);
        void refresh(societyId);
      }
    } catch (error) {
      toast.error(userMessage(error, "Could not create unit. Please try again."));
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
      <PeopleAreaNav />
        <PageHeader title={tu("op.units_2")} />
        <EmptyState
          icon={DoorOpen}
          title={tu("op.set_up_your_society_first_3")}
          action={<Button asChild><a href="/onboarding">{tu("billingTabs.setup")}</a></Button>}
        />
      </PageShell>
    );
  }

  // Legacy societies created before structure_mode existed have
  // `configured === false` but real units. Never hide existing units behind
  // the setup prompt — only show it when there is nothing to list.
  if (!loading && overview && !overview.configured && overview.total_units === 0) {
    return (
      <PageShell>
      <PeopleAreaNav />
        <PageHeader title={tu("op.units_2")} description={tu("op.every_unit_across_your_society")} />
        <EmptyState
          icon={DoorOpen}
          title={tu("op.structure_setup_required")}
          description={tu("op.choose_structured_or_serial_mode")}
          action={<Button asChild><a href="/society/setup">{tu("op.open_setup")}</a></Button>}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PeopleAreaNav />
      <PageHeader
        title={tu("op.units_2")}
        description={
          isSerial
            ? tu("op.direct_houses_in_your_society")
            : tu("op.every_unit_across_your_blocks")
        }
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button
                className="rounded-xl min-h-11"
                disabled={!isSerial && blocks.length === 0}
              >
                <Plus className="h-4 w-4 mr-2" /> {tu("op.add_unit")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader><DialogTitle>{tu("op.new_unit")}</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                {!isSerial && (
                  <div className="space-y-2">
                    <Label>{tu("mnt.block")}</Label>
                    <Select value={blockId} onValueChange={setBlockId}>
                      <SelectTrigger aria-label={tu("mnt.block")} className="min-h-11"><SelectValue placeholder={tu("op.select_block")} /></SelectTrigger>
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
                    <Label htmlFor="num">{isSerial ? tu("op.house_number") : tu("op.flat_number")}</Label>
                    <Input id="num" className="min-h-11" placeholder={isSerial ? "H-1" : "101"} value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} required />
                  </div>
                  {!isSerial && (
                    <div className="space-y-2">
                      <Label htmlFor="floor">{tu("op.floor")}</Label>
                      <Input id="floor" className="min-h-11" type="number" value={floor} onChange={(e) => setFloor(e.target.value)} />
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{tu("cm.type")}</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger aria-label={tu("cm.type")} className="min-h-11"><SelectValue /></SelectTrigger>
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
                    {tu("common.create")}
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
            placeholder={tu("op.search_unit_or_block")}
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
            <SelectTrigger className="w-44 min-h-11" aria-label={tu("op.filter_by_block")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tu("mnt.allBlocks")}</SelectItem>
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
          title={total === 0 ? tu("op.no_units_yet") : tu("op.no_units_match_this_filter")}
          description={
            !isSerial && blocks.length === 0
              ? tu("op.add_a_block_first_then")
              : tu("op.add_your_first_unit_to")
          }
        />
      ) : (
        <>
          <div className="rounded-2xl border border-border bg-background overflow-x-auto" tabIndex={0} role="region" aria-label={tu("op.units_table")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tu("nd.unit")}</TableHead>
                  {!isSerial && <TableHead>{tu("mnt.block")}</TableHead>}
                  {!isSerial && <TableHead>{tu("op.floor")}</TableHead>}
                  <TableHead>{tu("cm.type")}</TableHead>
                  <TableHead>{tu("common.status")}</TableHead>
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
            <span>{tu("op.page")} {page} of {totalPages} · {total} {tu("op.unit")}{total === 1 ? "" : "s"}</span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm" className="min-h-11"
                disabled={!hasPrev || loading}
                onClick={() => societyId && refresh(societyId, { offset: Math.max(0, offset - PAGE_SIZE) })}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> {tu("op.prev")}
              </Button>
              <Button
                variant="outline" size="sm" className="min-h-11"
                disabled={!hasNext || loading}
                onClick={() => societyId && refresh(societyId, { offset: offset + PAGE_SIZE })}
              >
                {tu("acc.next")} <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
