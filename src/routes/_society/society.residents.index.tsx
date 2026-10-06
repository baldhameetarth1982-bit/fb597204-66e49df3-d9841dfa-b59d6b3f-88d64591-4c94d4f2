import { createFileRoute, Link } from "@tanstack/react-router";
import { ErrorState } from "@/components/system/ErrorState";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Search, AlertTriangle, Link2, Download, ChevronRight, Home } from "lucide-react";
import { toast } from "sonner";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState, PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PeopleAreaNav, StatusChip, SummaryStrip, ListSkeleton, InlineNotice } from "@/components/people/PeopleUI";
import { AssignFlatDialog } from "@/components/society/AssignFlatDialog";
import { listSocietyResidents } from "@/lib/residents.functions";
import { getResidentDirectoryOverview, listResidentsPage } from "@/lib/residents-admin.functions";
import { cn } from "@/lib/utils";
import { TenanciesPanel } from "@/components/tenancy/TenanciesPanel";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/residents/")({
  head: () => ({ meta: [{ title: "Residents — SociyoHub" }, { name: "description", content: "Search and manage every resident, owner and tenant in your society." }] }),
  component: ResidentsPage,
});

type Filter = "all" | "owner" | "tenant" | "unassigned" | "moved_out" | "vacant";

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function ResidentsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const list = useServerFn(listSocietyResidents);
  const listSafe = useServerFn(listResidentsPage);
  const overview = useServerFn(getResidentDirectoryOverview);
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  // Server search waits for typing to pause (backpressure); local filtering stays instant.
  const [serverQ, setServerQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setServerQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const [filter, setFilter] = useState<Filter>("all");
  const [assignTarget, setAssignTarget] = useState<{ id: string; full_name: string | null } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-residents", societyId],
    queryFn: async () => list({ data: { societyId: societyId! } }),
    staleTime: 30_000,
  });
  // Authoritative counters (SECURITY DEFINER RPC).
  const { data: counters } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-residents-overview", societyId],
    queryFn: async () => overview({ data: { societyId: societyId! } }),
    staleTime: 30_000,
  });
  // Safe server-paginated preview — projects only safe fields, no phone/email.
  const { data: safePage } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-residents-safe", societyId, serverQ, filter],
    placeholderData: (prev) => prev,
    queryFn: async () => listSafe({
      data: {
        societyId: societyId!,
        search: serverQ || null,
        relationship: filter === "owner" ? "owner" : filter === "tenant" ? "tenant" : null,
        activeOnly: true,
        limit: 100, offset: 0,
      },
    }),
    staleTime: 15_000,
  });
  const residents = data?.residents ?? [];
  const flats = data?.flats ?? [];
  const vacantFlats = useMemo(() => flats.filter((f) => !f.occupied), [flats]);
  void safePage; // wired for authoritative privacy-safe listing; used in tests/monitoring

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return residents.filter((r) => {
      if (filter === "owner" && !r.is_owner) return false;
      if (filter === "tenant" && !r.is_tenant) return false;
      if (filter === "unassigned" && (r.flat_id || r.moved_out)) return false;
      if (filter === "moved_out" && !r.moved_out) return false;
      if (!ql) return true;
      const hay = [
        r.full_name, r.email, r.phone,
        r.flat_number, r.block_name,
        r.property_number, r.ugvcl_number, r.share_certificate_number,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }, [residents, q, filter]);

  async function exportExcel() {
    const { writeSafeWorkbook } = await import("@/lib/spreadsheet-safety");
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
    writeSafeWorkbook(src as Record<string, string | number>[], "Residents", `residents-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`Exported ${src.length} row${src.length === 1 ? "" : "s"}`);
  }

  async function exportPDF() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
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
    toast.success(tu("op.pdf_exported"));
  }

  const unassignedCount = residents.filter((r) => !r.flat_id && !r.moved_out).length;
  const movedOutCount = residents.filter((r) => r.moved_out).length;
  const verifiedCount = residents.filter((r) => r.aadhaar_verified).length;
  const unverifiedCount = residents.length - verifiedCount;

  const FILTERS: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "All", count: residents.length },
    { key: "owner", label: "Owners", count: residents.filter((r) => r.is_owner).length },
    { key: "tenant", label: "Tenants", count: residents.filter((r) => r.is_tenant).length },
    { key: "unassigned", label: "Unassigned", count: unassignedCount },
    { key: "moved_out", label: "Moved out", count: movedOutCount },
    { key: "vacant", label: "Vacant", count: vacantFlats.length },
  ];

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title={tu("nav.residents")} />
        <EmptyState icon={Users} title={tu("op.set_up_your_society_first_3")} description={tu("op.residents_appear_here_once_your")} />
      </PageShell>
    );
  }

  const known = !isLoading && !isError;
  const dash = (v: number | undefined | null) => (v === undefined || v === null ? "—" : v);
  const activeFilter = FILTERS.find((f) => f.key === filter)!;

  return (
    <PageShell>
      <PeopleAreaNav />
      <PageHeader
        title={tu("nav.residents")}
        description={known ? `${residents.length} people across ${flats.length} houses` : tu("op.everyone_living_in_your_society")}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="min-h-11 rounded-xl" disabled={!known}>
                <Download className="mr-2 h-4 w-4" /> {tu("op.export")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportExcel().catch(() => toast.error(tu("op.couldn_t_prepare_the_export")))}>{tu("op.excel_xlsx")}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportPDF().catch(() => toast.error(tu("op.couldn_t_prepare_the_export")))}>PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      {societyId && <TenanciesPanel societyId={societyId} />}


      <SummaryStrip
        items={[
          { label: "Residents", value: dash(counters?.total_residents ?? (known ? residents.length : null)) },
          { label: "Owners", value: dash(counters?.owners) },
          { label: "Tenants", value: dash(counters?.tenants) },
          { label: "Vacant houses", value: dash(counters?.vacant_units ?? (known ? vacantFlats.length : null)) },
        ]}
      />

      {known && unassignedCount > 0 && (
        <InlineNotice
          icon={AlertTriangle}
          title={`${unassignedCount} resident${unassignedCount === 1 ? "" : "s"} not linked to a house`}
          action={filter !== "unassigned" ? (
            <Button size="sm" variant="outline" className="min-h-11 rounded-xl bg-card" onClick={() => setFilter("unassigned")}>
              {tu("op.show_them")}
            </Button>
          ) : undefined}
        >
          {tu("op.they_will_see_0_in")}
        </InlineNotice>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label={tu("op.search_residents")}
            placeholder={tu("op.search_name_phone_house_property")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-11 rounded-xl pl-9"
          />
        </div>
        <div className="sm:hidden">
          <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <SelectTrigger aria-label={tu("op.filter_residents")} className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.key} value={f.key}>{f.label}{known ? ` (${f.count})` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div role="tablist" aria-label={tu("op.filter_residents")} className="mb-4 hidden flex-wrap gap-1 rounded-xl bg-muted p-1 sm:inline-flex">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "min-h-10 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f.key ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {known && <span className="ml-1.5 tabular-nums text-muted-foreground">{f.count}</span>}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {isLoading ? (
          <ListSkeleton />
        ) : isError ? (
          <ErrorState
            title={tu("op.couldn_t_load_residents")}
            description={tu("fam.checkConn")}
            onRetry={() => void refetch()}
          />
        ) : filter === "vacant" ? (
          vacantFlats.length === 0 ? (
            <EmptyState icon={Home} title={tu("op.no_vacant_houses")} description={tu("op.every_house_is_occupied")} />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {vacantFlats.map((f) => (
                <li key={f.id} className="flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
                  <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {f.block_name ? `${f.block_name} · ` : ""}{f.flat_number}
                  </span>
                  <StatusChip tone="muted">{tu("op.vacant")}</StatusChip>
                </li>
              ))}
            </ul>
          )
        ) : filtered.length === 0 ? (
          q || filter !== "all" ? (
            <EmptyState
              icon={Search}
              title={tu("op.no_residents_match")}
              description={q ? `Nothing found for "${q}" in ${activeFilter.label.toLowerCase()}.` : `No residents in ${activeFilter.label.toLowerCase()}.`}
              action={<Button variant="outline" className="min-h-11 rounded-xl" onClick={() => { setQ(""); setFilter("all"); }}>{tu("op.clear_search_and_filter")}</Button>}
            />
          ) : (
            <EmptyState icon={Users} title={tu("op.no_residents_yet")} description={tu("op.approve_join_requests_or_bulk")} />
          )
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{tu("op.showing")} {filtered.length} of {residents.length}</p>
            {/* Desktop: structured table */}
            <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">{tu("inc.k.resident")}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{tu("gd.houseLabel")}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{tu("cm.type")}</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">{tu("common.status")}</th>
                    <th scope="col" className="px-4 py-2.5"><span className="sr-only">{tu("op.actions")}</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r) => (
                    <tr key={r.id} className={cn("transition-colors hover:bg-muted/40", r.moved_out && "text-muted-foreground")}>
                      <td className="px-4 py-2.5">
                        <Link to="/society/residents/$id" params={{ id: r.id }} className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <ResidentAvatar r={r} />
                          <span className="truncate font-medium text-foreground">{r.full_name ?? tu("sd.unnamed")}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{houseLabel(r) ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-2.5"><TypeChip r={r} /></td>
                      <td className="px-4 py-2.5"><StateChips r={r} /></td>
                      <td className="px-4 py-2.5 text-right">
                        {!r.moved_out && (
                          <Button size="sm" variant={r.flat_id ? "ghost" : "default"} className="min-h-10 rounded-lg" onClick={() => setAssignTarget({ id: r.id, full_name: r.full_name })}>
                            <Link2 className="mr-1.5 h-3.5 w-3.5" /> {r.flat_id ? tu("op.change_house") : tu("op.assign_house")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile: list rows */}
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card md:hidden">
              {filtered.map((r) => (
                <li key={r.id} className={cn(r.moved_out && "text-muted-foreground")}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Link to="/society/residents/$id" params={{ id: r.id }} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ResidentAvatar r={r} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{r.full_name ?? tu("sd.unnamed")}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {houseLabel(r) ?? (r.moved_out ? tu("op.moved_out") : tu("op.no_house_assigned"))}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1"><TypeChip r={r} /><StateChips r={r} /></div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </div>
                  {!r.moved_out && !r.flat_id && (
                    <div className="px-4 pb-3">
                      <Button size="sm" className="min-h-11 w-full rounded-xl" onClick={() => setAssignTarget({ id: r.id, full_name: r.full_name })}>
                        <Link2 className="mr-1.5 h-4 w-4" /> {tu("op.assign_house")}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

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

type Row = { id: string; full_name: string | null; avatar_url?: string | null; flat_id?: string | null; flat_number?: string | null; block_name?: string | null; relationship?: string | null; moved_out?: boolean | null; aadhaar_verified?: boolean | null };

function houseLabel(r: Row) {
  if (!r.flat_id) return null;
  return `${r.block_name ? r.block_name + " · " : ""}${r.flat_number ?? ""}`;
}

function ResidentAvatar({ r }: { r: Row }) {
  return (
    <Avatar className="h-10 w-10 shrink-0">
      {r.avatar_url ? <AvatarImage src={r.avatar_url} alt="" /> : null}
      <AvatarFallback className="bg-primary-container text-sm font-medium text-primary-container-foreground">
        {initials(r.full_name)}
      </AvatarFallback>
    </Avatar>
  );
}

function TypeChip({ r }: { r: Row }) {
  if (!r.flat_id || !r.relationship) return null;
  if (r.relationship === "owner") return <StatusChip tone="primary">{tu("op.owner")}</StatusChip>;
  if (r.relationship === "tenant") return <StatusChip tone="info">{tu("op.tenant")}</StatusChip>;
  return <StatusChip>{r.relationship}</StatusChip>;
}

function StateChips({ r }: { r: Row }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {r.moved_out ? <StatusChip tone="muted">{tu("op.moved_out")}</StatusChip>
        : !r.flat_id ? <StatusChip tone="warning">{tu("gd.noHouse")}</StatusChip>
        : <StatusChip tone="success">{tu("rep.current")}</StatusChip>}
      {r.aadhaar_verified ? <StatusChip tone="success">{tu("op.kyc_verified")}</StatusChip> : null}
    </span>
  );
}
