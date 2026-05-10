import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/residents")({
  head: () => ({ meta: [{ title: "Residents — SocioHub" }] }),
  component: ResidentsPage,
});

interface ResidentRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  flat?: string;
  block?: string;
  relationship?: string;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function ResidentsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [rows, setRows] = useState<ResidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    async function load() {
      if (!societyId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      // Pull all profiles attached to this society
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone")
        .eq("society_id", societyId)
        .order("full_name");
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      const ids = (profiles ?? []).map((p) => p.id);
      let assignments: Record<string, { flat: string; block: string; relationship: string }> = {};
      if (ids.length > 0) {
        const { data: fr } = await supabase
          .from("flat_residents")
          .select("user_id, relationship, flats(flat_number, blocks(name))")
          .in("user_id", ids);
        (fr ?? []).forEach((r: any) => {
          assignments[r.user_id] = {
            flat: r.flats?.flat_number ?? "",
            block: r.flats?.blocks?.name ?? "",
            relationship: r.relationship,
          };
        });
      }
      setRows(
        (profiles ?? []).map((p) => ({
          ...p,
          flat: assignments[p.id]?.flat,
          block: assignments[p.id]?.block,
          relationship: assignments[p.id]?.relationship,
        })),
      );
      setLoading(false);
    }
    if (!sidLoading) void load();
  }, [societyId, sidLoading]);

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const hay = `${r.full_name ?? ""} ${r.email ?? ""} ${r.flat ?? ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Residents" />
        <EmptyState icon={Users} title="Set up your society first" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Residents"
        description="Everyone living in your society."
      />

      <div className="mb-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email or flat…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9 rounded-xl"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No residents yet"
          description="Residents appear here as soon as they sign up and get linked to a flat."
        />
      ) : (
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resident</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Flat</TableHead>
                <TableHead>Type</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                          {initials(r.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{r.full_name ?? "Unnamed"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.email ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.phone ?? "—"}</TableCell>
                  <TableCell>
                    {r.flat ? (
                      <span className="font-medium">{r.block ? `${r.block}-` : ""}{r.flat}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="capitalize text-muted-foreground">
                    {r.relationship ?? "—"}
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
