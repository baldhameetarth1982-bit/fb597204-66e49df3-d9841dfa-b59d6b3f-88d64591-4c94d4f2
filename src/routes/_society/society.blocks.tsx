import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Plus, Loader2, Copy, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { planSocietyFromText, applySocietyPlan, duplicateBlock } from "@/lib/blocks-ai.functions";

export const Route = createFileRoute("/_society/society/blocks")({
  head: () => ({ meta: [{ title: "Blocks — SocioHub" }] }),
  component: BlocksPage,
});

interface Block {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  flat_count?: number;
}

function BlocksPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);

  // Add
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Duplicate
  const [dupOpen, setDupOpen] = useState(false);
  const [dupSource, setDupSource] = useState<Block | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupBusy, setDupBusy] = useState(false);

  // AI
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPlan, setAiPlan] = useState<any>(null);

  const planFn = useServerFn(planSocietyFromText) as any;
  const applyFn = useServerFn(applySocietyPlan) as any;
  const dupFn = useServerFn(duplicateBlock) as any;

  async function fetchBlocks(sid: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from("blocks")
      .select("id, name, description, created_at, flats(count)")
      .eq("society_id", sid)
      .order("name");
    if (error) toast.error(error.message);
    else
      setBlocks(
        (data ?? []).map((b: any) => ({ ...b, flat_count: b.flats?.[0]?.count ?? 0 })),
      );
    setLoading(false);
  }

  useEffect(() => {
    if (societyId) void fetchBlocks(societyId);
    else if (!sidLoading) setLoading(false);
  }, [societyId, sidLoading]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("blocks").insert({
      society_id: societyId,
      name: name.trim(),
      description: description.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Block created");
    setName(""); setDescription(""); setOpen(false);
    void fetchBlocks(societyId);
  }

  async function handleDuplicate() {
    if (!dupSource || !dupName.trim()) return;
    setDupBusy(true);
    try {
      const res = await dupFn({ data: { blockId: dupSource.id, newName: dupName.trim() } });
      toast.success(`Created ${dupName} with ${res.unitsCreated} units`);
      setDupOpen(false); setDupName("");
      if (societyId) void fetchBlocks(societyId);
    } catch (e: any) { toast.error(e.message); }
    setDupBusy(false);
  }

  async function handleAiPlan() {
    if (!aiText.trim()) return;
    setAiBusy(true);
    try {
      const res = await planFn({ data: { text: aiText.trim() } });
      setAiPlan(res.plan);
    } catch (e: any) { toast.error(e.message); }
    setAiBusy(false);
  }

  async function handleAiApply() {
    if (!societyId || !aiPlan) return;
    setAiBusy(true);
    try {
      const res = await applyFn({ data: { societyId, plan: aiPlan } });
      toast.success(`Created ${res.blocksCreated} blocks · ${res.unitsCreated} units`);
      setAiOpen(false); setAiPlan(null); setAiText("");
      void fetchBlocks(societyId);
    } catch (e: any) { toast.error(e.message); }
    setAiBusy(false);
  }

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Blocks" description="Manage the wings of your society." />
        <EmptyState
          icon={Building2}
          title="No society linked yet"
          description="Set up your society first to start adding blocks."
          action={<Button asChild><a href="/onboarding">Set up society</a></Button>}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Blocks"
        description="Apartments, bungalows or mixed — describe once, duplicate easily."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" className="rounded-xl" onClick={() => setAiOpen(true)}>
              <Sparkles className="h-4 w-4 mr-2" /> AI Build
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="rounded-xl">
                  <Plus className="h-4 w-4 mr-2" /> Add Block
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl">
                <DialogHeader><DialogTitle>New block</DialogTitle></DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" placeholder="e.g. Block A" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="desc">Description (optional)</Label>
                    <Textarea id="desc" placeholder="Eastern wing, 12 floors…" value={description} onChange={(e) => setDescription(e.target.value)} />
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
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : blocks.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No blocks yet"
          description="Add a block manually, or hit AI Build and describe your society in plain English."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {blocks.map((b) => (
            <Card key={b.id} className="rounded-2xl hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 grid place-items-center">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">{b.flat_count} units</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{b.name}</h3>
                {b.description && <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{b.description}</p>}
                <Button
                  size="sm" variant="ghost" className="mt-3 -ml-2 rounded-xl"
                  onClick={() => { setDupSource(b); setDupName(""); setDupOpen(true); }}
                >
                  <Copy className="h-4 w-4 mr-2" /> Duplicate
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Duplicate dialog */}
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader><DialogTitle>Duplicate {dupSource?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Creates a new block with the same units. Unit numbers will be renamed using the new prefix.
            </p>
            <div className="space-y-2">
              <Label>New block name</Label>
              <Input value={dupName} onChange={(e) => setDupName(e.target.value)} placeholder="e.g. Block B" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleDuplicate} disabled={dupBusy || !dupName.trim()} className="rounded-xl">
              {dupBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Build dialog */}
      <Dialog open={aiOpen} onOpenChange={(o) => { setAiOpen(o); if (!o) { setAiPlan(null); setAiText(""); } }}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> AI Build</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Describe your society</Label>
              <Textarea
                rows={4}
                placeholder="e.g. 3 towers A B C, each 10 floors with 4 flats per floor. Plus 20 bungalows numbered V-1 to V-20."
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
              />
            </div>
            {aiPlan && (
              <div className="rounded-xl border border-border p-3 space-y-2 max-h-60 overflow-auto">
                <div className="text-xs text-muted-foreground">Property type: <b>{aiPlan.property_type}</b></div>
                {aiPlan.blocks.map((b: any, i: number) => (
                  <div key={i} className="text-sm">
                    <b>{b.name}</b> · {b.unit_type} · {b.floors > 0 ? `${b.floors} floors × ${b.units_per_floor}` : `${b.units_per_floor} units`}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            {!aiPlan ? (
              <Button onClick={handleAiPlan} disabled={aiBusy || !aiText.trim()} className="rounded-xl">
                {aiBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Generate plan
              </Button>
            ) : (
              <div className="flex gap-2 w-full sm:w-auto">
                <Button variant="ghost" onClick={() => setAiPlan(null)} className="rounded-xl">Edit</Button>
                <Button onClick={handleAiApply} disabled={aiBusy} className="rounded-xl">
                  {aiBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Create blocks & units
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
