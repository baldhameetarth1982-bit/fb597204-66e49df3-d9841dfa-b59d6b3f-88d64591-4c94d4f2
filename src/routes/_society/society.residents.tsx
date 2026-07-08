import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Users, Loader2, Search, AlertTriangle, Phone, MessageCircle,
  Link2, Download, Filter, ChevronRight, Home, UserCheck, UserX,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssignFlatDialog } from "@/components/society/AssignFlatDialog";
import { listSocietyResidents } from "@/lib/residents.functions";

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
          r.full_name ?? "",
          r.phone ?? "",
          [r.block_name, r.flat_number].filter(Boolean).join(" ") || "—",
          r.relationship ?? "",
          r.property_number ?? "",
          r.ugvcl_number ?? "",
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

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Residents" />
        <EmptyState icon={Users} title="Set up your society first" />
      </PageShell>
    );
  }

  const verifiedCount = residents.filter((r) => r.aadhaar_verified).length;
  const unverifiedCount = residents.length - verifiedCount;

  return (
    <PageShell>
      <PageHeader
        title="Residents"
        description={`${residents.length} people · ${flats.length} houses`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="rounded-xl" onClick={exportExcel}>
              <Download className="h-4 w-4 mr-1.5" /> Excel
            </Button>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={exportPDF}>
              <Download className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </div>
        }
      />

      {/* Summary cards (real counts only) */}
      {!isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
          <SummaryCard label="Total" value={residents.length} />
          <SummaryCard label="Verified" value={verifiedCount} tone="success" />
          <SummaryCard label="Unverified" value={unverifiedCount} tone="warning" />
          <SummaryCard label="Vacant houses" value={vacantFlats.length} tone="muted" />
        </div>
      )}

      {!isLoading && unassignedCount > 0 && (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 text-warning-foreground px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-medium">
              {unassignedCount} resident{unassignedCount === 1 ? "" : "s"} not linked to a house
            </p>
            <p className="text-xs opacity-80">They will see ₹0 in Bills until you assign them.</p>
          </div>
        </div>
      )}

      <div className="space-y-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, house, property no, UGVCL, share cert…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9 rounded-xl h-11"
          />
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="grid grid-cols-5 w-full h-10">
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
            <TabsTrigger value="owner" className="text-xs">Owners</TabsTrigger>
            <TabsTrigger value="tenant" className="text-xs">Tenants</TabsTrigger>
            <TabsTrigger value="unassigned" className="text-xs">Unassigned</TabsTrigger>
            <TabsTrigger value="vacant" className="text-xs">Vacant</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
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
    </PageShell>
  );
}

function SummaryCard({
  label, value, tone = "primary",
}: { label: string; value: number; tone?: "primary" | "success" | "warning" | "muted" }) {
  const toneClass =
    tone === "success" ? "text-success"
    : tone === "warning" ? "text-warning"
    : tone === "muted" ? "text-muted-foreground"
    : "text-primary";
  return (
    <div className="rounded-2xl border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function ResidentCard({
  r,
  onAssign,
}: {
  r: any;
  onAssign: () => void;
}) {
  const phone = (r.phone ?? "").replace(/\D/g, "");
  const wa = phone ? `https://wa.me/${phone.length === 10 ? "91" + phone : phone}` : null;
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Link
          to="/society/residents/$id"
          params={{ id: r.id }}
          className="shrink-0"
        >
          <Avatar className="h-11 w-11">
            {r.avatar_url ? <AvatarImage src={r.avatar_url} /> : null}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initials(r.full_name)}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <Link
              to="/society/residents/$id"
              params={{ id: r.id }}
              className="min-w-0 flex-1"
            >
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
          {r.phone ? (
            <div className="mt-1 text-xs text-muted-foreground">{r.phone}</div>
          ) : null}
          <div className="mt-3 flex items-center gap-1.5">
            {r.phone && (
              <>
                <Button asChild size="sm" variant="outline" className="rounded-lg h-8 px-2.5 text-xs">
                  <a href={`tel:${r.phone}`}>
                    <Phone className="h-3 w-3 mr-1" /> Call
                  </a>
                </Button>
                {wa && (
                  <Button asChild size="sm" variant="outline" className="rounded-lg h-8 px-2.5 text-xs">
                    <a href={wa} target="_blank" rel="noreferrer">
                      <MessageCircle className="h-3 w-3 mr-1" /> WA
                    </a>
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
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="rounded-lg h-8 px-2 text-xs ml-auto"
            >
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
