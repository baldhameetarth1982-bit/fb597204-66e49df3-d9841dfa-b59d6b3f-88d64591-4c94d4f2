import { useEffect, useMemo, useState } from "react";
import { userMessage } from "@/lib/user-error";
import { Loader2, Home, Search, CheckCircle2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface FlatRow {
  flat_id: string;
  flat_number: string;
  block_name: string | null;
  is_occupied: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  societyId: string;
  onRequested?: () => void;
}

export function ClaimFlatSheet({ open, onOpenChange, societyId, onRequested }: Props) {
  const [flats, setFlats] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<"owner" | "tenant" | "family">("owner");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !societyId) return;
    setLoading(true);
    supabase
      .rpc("list_society_flats_public", { _society_id: societyId })
      .then(({ data, error }) => {
        if (error) toast.error(userMessage(error));
        setFlats((data as any[]) ?? []);
        setLoading(false);
      });
  }, [open, societyId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return flats;
    return flats.filter((f) =>
      `${f.block_name ?? ""} ${f.flat_number}`.toLowerCase().includes(term),
    );
  }, [flats, q]);

  async function submit() {
    if (!selected) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("request_join_flat", {
      _flat_id: selected,
      _relationship: relationship,
    });
    setSubmitting(false);
    if (error) {
      toast.error(userMessage(error));
      return;
    }
    toast.success("Request sent — your admin will approve it shortly");
    onRequested?.();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[90vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Pick your flat</SheetTitle>
          <SheetDescription>
            Your bills appear after the admin approves your flat request.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search flat or block…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-xl"
            />
          </div>

          <Select value={relationship} onValueChange={(v) => setRelationship(v as any)}>
            <SelectTrigger className="rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="tenant">Tenant</SelectItem>
              <SelectItem value="family">Family member</SelectItem>
            </SelectContent>
          </Select>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No flats found.</p>
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {filtered.map((f) => {
                const active = selected === f.flat_id;
                return (
                  <Card
                    key={f.flat_id}
                    onClick={() => setSelected(f.flat_id)}
                    className={`rounded-xl cursor-pointer transition ${
                      active ? "border-primary ring-2 ring-primary/30" : ""
                    }`}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 grid place-items-center">
                        <Home className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {f.block_name ? `${f.block_name} — ` : ""}
                          {f.flat_number}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {f.is_occupied ? "Already has residents" : "No residents yet"}
                        </p>
                      </div>
                      {active && <CheckCircle2 className="h-5 w-5 text-primary" />}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <Button
            disabled={!selected || submitting}
            onClick={submit}
            className="w-full h-12 rounded-xl"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send request"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
