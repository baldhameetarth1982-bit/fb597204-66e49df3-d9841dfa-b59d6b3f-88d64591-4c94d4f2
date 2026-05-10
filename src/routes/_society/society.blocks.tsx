import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/blocks")({
  head: () => ({
    meta: [{ title: "Blocks — SocioHub" }],
  }),
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function fetchBlocks(sid: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from("blocks")
      .select("id, name, description, created_at, flats(count)")
      .eq("society_id", sid)
      .order("name");
    if (error) {
      toast.error(error.message);
    } else {
      setBlocks(
        (data ?? []).map((b: any) => ({
          ...b,
          flat_count: b.flats?.[0]?.count ?? 0,
        })),
      );
    }
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
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Block created");
    setName("");
    setDescription("");
    setOpen(false);
    void fetchBlocks(societyId);
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
        description="Wings or buildings inside your society."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl">
                <Plus className="h-4 w-4 mr-2" /> Add Block
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle>New block</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="e.g. Block A"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">Description (optional)</Label>
                  <Textarea
                    id="desc"
                    placeholder="Eastern wing, 12 floors…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
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

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : blocks.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No blocks yet"
          description="Add your first block to start mapping flats and residents."
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
                  <span className="text-xs font-medium text-muted-foreground">
                    {b.flat_count} flats
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{b.name}</h3>
                {b.description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {b.description}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
