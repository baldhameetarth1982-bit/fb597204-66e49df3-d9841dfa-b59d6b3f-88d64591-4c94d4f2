import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users, Loader2, Search, AlertTriangle, Phone, MessageCircle,
  Link2, Download, ChevronRight, Home, UserCheck, UserX,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { AssignFlatDialog } from "@/components/society/AssignFlatDialog";
import { listSocietyResidents } from "@/lib/residents.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/residents")({
  head: () => ({ meta: [{ title: "Residents — SocioHub" }] }),
  component: ResidentsPage,
});

type Filter = "all" | "owner" | "tenant" | "unassigned" | "vacant";

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function ResidentsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const list = useServerFn(listSocietyResidents);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [assignTarget, setAssignTarget] = useState<{ id: string; full_name: string | null } | null>(null);

  const { data, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-residents", societyId],
    queryFn: async () => list({ data: { societyId: societyId! } }),
    staleTime: 30_000,
  });
  const residents = data?.residents ?? [];
  const flats = data?.flats ?? [];
  const vacantFlats = useMemo(() => flats.filter((f) => !f.occupied), [flats]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return residents.filter((r) => {
      if (filter === "owner" && r.relationship !== "owner") return false;
      if (filter === "tenant" && r.relationship !== "tenant") return false;
      if (filter === "unassigned" && r.flat_id) return false;
      if (!ql) return true;
      const hay = [
        r.full_name, r.email, r.phone,
        r.flat_number, r.block_name,
        r.property_number, r.ugvcl_number, r.share_certificate_number,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }, [residents, q, filter]);

  function exportExcel() {
    const src = filter === "vacant"
      ? vacantFlats.map((f) => ({ Block: f.block_name ?? "—", Unit: f.flat_number, Status: "Vacant" }))
      : filtered.map((r) => ({
          Name: r.full_name ?? "",
          Phone: r.phone ?? "",
          Email: r.email ?? "",
          Block: r.block_name ?? "",
          Unit: r.flat_number ?? "",
          Type: r.relationship ?? "",
          "Property No": r.property_number ?? "",
          UGVCL: r.ugvcl_number ?? "",
          "Share Cert": r.share_certificate_number ?? "",
          "Move-in": r.move_in_date ?? "",
          KYC: r.aadhaar_verified ? "Verified" : "Pending",
        }));
    const ws = XLSX.utils.json_to_sheet(src);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Residents");
    XLSX.writeFile(wb, `residents-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exported ${src.length} row${src.length === 1 ? "" : "s"}`);
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("Residents", 40, 40);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString("en-IN")} · ${filtered.length} residents`, 40, 56);
    doc.setTextColor(0);
    if (filter === "vacant") {
      autoTable(doc, {
        startY: 74,
        head: [["Block", "Unit", "Status"]],
        body: vacantFlats.map((f) => [f.block_name ?? "—", f.flat_number, "Vacant"]),
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [30, 41, 59] },
      });
    } else {
      autoTable(doc, {
        startY: 74,
        head: [["Name", "Phone", "House", "Type", "Property No", "UGVCL", "Share Cert", "KYC"]],
        body: filtered.map((r) => [
          r.full_name ?? "", r.phone ?? "",
          [r.block_name, r.flat_number].filter(Boolean).join(" ") || "—",
          r.relationship ?? "",
          r.property_number ?? "", r.ugvcl_number ?? "",
          r.share_certificate_number ?? "",
          r.aadhaar_verified ? "Verified" : "Pending",
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [30, 41, 59] },
      });
    }
    doc.save(`residents-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF exported");
  }

  const unassignedCount = residents.filter((r) => !r.flat_id).length;
  const verifiedCount = residents.filter((r) => r.aadhaar_verified).length;
  const unverifiedCount = residents.length - verifiedCount;

  const FILTERS: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "All", count: residents.length },
    { key: "owner", label: "Owners", count: residents.filter((r) => r.relationship === "owner").length },
    { key: "tenant", label: "Tenants", count: residents.filter((r) => r.relationship === "tenant").length },
    { key: "unassigned", label: "Unassigned", count: unassignedCount },
    { key: "vacant", label: "Vacant", count: vacantFlats.length },
  ];

  if (!sidLoading && !societyId) {
    return (
      <div className="pb-24">
        <MobileHero title="Residents" icon={Users} variant="teal" />
        <div className="px-4 pt-4">
          <EmptyState icon={Users} title="Set up your society first" />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow="Roster"
        title="Residents"
        subtitle={`${residents.length} people · ${flats.length} houses`}
        icon={Users}
        variant="teal"
        action={
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0" onClick={exportExcel}>
              <Download className="h-3.5 w-3.5 mr-1" /> XLSX
            </Button>
            <Button size="sm" variant="secondary" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0" onClick={exportPDF}>
              <Download className="h-3.5 w-3.5 mr-1" /> PDF
            </Button>
          </div>
        }
        stats={
          <StatPillRow>
            <StatPill label="Total" value={residents.length} />
            <StatPill label="Verified" value={verifiedCount} />
            <StatPill label="Unverified" value={unverifiedCount} />
            <StatPill label="Vacant" value={vacantFlats.length} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4">
        {!isLoading && unassignedCount > 0 && (
          <div className="rounded-2xl border border-warning/30 bg-warning/10 text-warning-foreground px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium">
                {unassignedCount} resident{unassignedCount === 1 ? "" : "s"} not linked to a house
              </p>
              <p className="text-xs opacity-80">They will see ₹0 in Bills until you assign them.</p>
            </div>
          </div>
        )}

        <SectionCard bodyClassName="p-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, house, property no…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 rounded-xl h-11"
            />
          </div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  filter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label} · {f.count}
              </button>
            ))}
          </div>
        </SectionCard>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filter === "vacant" ? (
          vacantFlats.length === 0 ? (
            <EmptyState icon={Home} title="No vacant houses" description="Every house is occupied." />
          ) : (
            <div className="space-y-2">
              {vacantFlats.map((f) => (
                <div key={f.id} className="rounded-2xl border bg-card p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-muted grid place-items-center">
                      <Home className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium">
                        {f.block_name ? `${f.block_name} · ` : ""}{f.flat_number}
                      </div>
                      <div className="text-xs text-muted-foreground">Vacant house</div>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">Vacant</Badge>
                </div>
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No residents match"
            description={q ? "Try a different search." : "Approve join requests or bulk import residents."}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((r) => (
              <ResidentCard
                key={r.id}
                r={r}
                onAssign={() => setAssignTarget({ id: r.id, full_name: r.full_name })}
              />
            ))}
          </div>
        )}

        {assignTarget && societyId && (
          <AssignFlatDialog
            open={!!assignTarget}
            onOpenChange={(v) => { if (!v) setAssignTarget(null); }}
            societyId={societyId}
            userId={assignTarget.id}
            userName={assignTarget.full_name}
            onAssigned={() => qc.invalidateQueries({ queryKey: ["society-residents", societyId] })}
          />
        )}
      </div>
    </div>
  );
}

function ResidentCard({ r, onAssign }: { r: any; onAssign: () => void }) {
  const phone = (r.phone ?? "").replace(/\D/g, "");
  const wa = phone ? `https://wa.me/${phone.length === 10 ? "91" + phone : phone}` : null;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Link to="/society/residents/$id" params={{ id: r.id }} className="shrink-0">
          <Avatar className="h-11 w-11">
            {r.avatar_url ? <AvatarImage src={r.avatar_url} /> : null}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initials(r.full_name)}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <Link to="/society/residents/$id" params={{ id: r.id }} className="min-w-0 flex-1">
              <div className="font-medium truncate">{r.full_name ?? "Unnamed"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {r.flat_id
                  ? `${r.block_name ? r.block_name + " · " : ""}${r.flat_number}`
                  : "No house assigned"}
                {r.relationship ? ` · ${r.relationship}` : ""}
              </div>
            </Link>
            <div className="flex items-center gap-1.5 shrink-0">
              {r.aadhaar_verified ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/30 text-emerald-600">
                  <UserCheck className="h-2.5 w-2.5 mr-0.5" /> KYC
                </Badge>
              ) : null}
              {!r.flat_id ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-600">
                  <UserX className="h-2.5 w-2.5 mr-0.5" /> Unlinked
                </Badge>
              ) : null}
            </div>
          </div>
          {r.phone ? <div className="mt-1 text-xs text-muted-foreground">{r.phone}</div> : null}
          <div className="mt-3 flex items-center gap-1.5">
            {r.phone && (
              <>
                <Button asChild size="sm" variant="outline" className="rounded-lg h-8 px-2.5 text-xs">
                  <a href={`tel:${r.phone}`}><Phone className="h-3 w-3 mr-1" /> Call</a>
                </Button>
                {wa && (
                  <Button asChild size="sm" variant="outline" className="rounded-lg h-8 px-2.5 text-xs">
                    <a href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3 w-3 mr-1" /> WA</a>
                  </Button>
                )}
              </>
            )}
            <Button
              size="sm"
              variant={r.flat_id ? "outline" : "default"}
              className="rounded-lg h-8 px-2.5 text-xs"
              onClick={onAssign}
            >
              <Link2 className="h-3 w-3 mr-1" /> {r.flat_id ? "Change" : "Assign"}
            </Button>
            <Button asChild size="sm" variant="ghost" className="rounded-lg h-8 px-2 text-xs ml-auto">
              <Link to="/society/residents/$id" params={{ id: r.id }}>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
