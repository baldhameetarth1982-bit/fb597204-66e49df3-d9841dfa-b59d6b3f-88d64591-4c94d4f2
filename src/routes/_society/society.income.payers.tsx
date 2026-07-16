import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Plus,
  Pencil,
  Users,
  Search,
  RotateCcw,
  ShieldCheck,
  UserX,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";
import { incomeKeys, incomeInvalidations } from "@/lib/income-query-keys";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  listNonMemberPayersPageFn,
  createNonMemberPayerFn,
  updateNonMemberPayerFn,
  getNonMemberPayerDetailFn,
} from "@/lib/non-member-income.functions";


export const Route = createFileRoute("/_society/society/income/payers")({
  head: () => ({
    meta: [
      { title: "External Payers — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <IncomeAccessBoundary>
      {(societyId) => <PayersPage societyId={societyId} />}
    </IncomeAccessBoundary>
  ),
});

const PAYER_TYPE_OPTIONS = [
  { value: "vendor", label: "Vendor" },
  { value: "advertiser", label: "Advertiser" },
  { value: "coach", label: "Coach" },
  { value: "event_organizer", label: "Event organizer" },
  { value: "shop", label: "Shop" },
  { value: "guest", label: "Guest" },
  { value: "temporary", label: "Temporary" },
  { value: "other", label: "Other" },
] as const;

type PayerType = (typeof PAYER_TYPE_OPTIONS)[number]["value"];

const PAYER_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PAYER_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Default list contract — PRIVACY-SAFE. Never carries phone, email,
 * reference_code, notes or society_id.
 */
interface PayerListItem {
  id: string;
  payer_type: string;
  display_name: string;
  organization_name: string | null;
  is_active: boolean;
  created_at: string;
}

type Editing =
  | { mode: "create" }
  | { mode: "edit"; payerId: string }
  | null;

type StatusFilter = "all" | "active" | "inactive";

const PAGE_SIZE = 25;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const AVATAR_TINTS = [
  "bg-[#E6F7F4] text-[#007E70]",
  "bg-[#EEF4FF] text-[#3155D4]",
  "bg-[#FFF4E6] text-[#B45309]",
  "bg-[#F1ECFB] text-[#6E3AD1]",
  "bg-[#E8F5EE] text-[#12B76A]",
  "bg-[#FDECEF] text-[#B42318]",
];
function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

function SummaryCard({
  label,
  value,
  tint,
  icon: Icon,
}: {
  label: string;
  value: number;
  tint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[18px] bg-white border border-[#DDE9E6] p-4 shadow-[0_2px_8px_-4px_rgba(11,37,69,0.08)]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#667085]">{label}</span>
        <span className={`h-8 w-8 rounded-xl grid place-items-center ${tint}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-[#0B2545]">
        {value}
      </div>
    </div>
  );
}

function PayersPage({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listNonMemberPayersPageFn);
  const createFn = useServerFn(createNonMemberPayerFn);
  const updateFn = useServerFn(updateNonMemberPayerFn);

  const [editing, setEditing] = useState<Editing>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [debounced, typeFilter, status]);

  const listQ = useQuery({
    queryKey: incomeKeys.payers(
      societyId,
      { search: debounced, type: typeFilter, active: status },
      page,
    ),
    queryFn: async () =>
      listFn({
        data: {
          societyId,
          search: debounced || undefined,
          payer_type: typeFilter,
          active: status,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  });

  const invalidate = (payerId?: string) => {
    for (const key of incomeInvalidations.payer(societyId, payerId)) {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const createMut = useMutation({
    mutationFn: async (v: {
      payer_type: PayerType;
      display_name: string;
      organization_name?: string;
      phone?: string;
      email?: string;
      reference_code?: string;
      notes?: string;
    }) => createFn({ data: { societyId, ...v } }),
    onSuccess: () => {
      toast.success("Payer added");
      setEditing(null);
      void invalidate();
    },
    onError: () => toast.error("Could not add payer"),
  });

  const updateMut = useMutation({
    mutationFn: async (v: {
      id: string;
      payer_type?: PayerType;
      display_name?: string;
      organization_name?: string;
      phone?: string;
      email?: string;
      reference_code?: string;
      notes?: string;
      is_active?: boolean;
    }) => updateFn({ data: { societyId, ...v } }),
    onSuccess: (_r, v) => {
      toast.success("Payer updated");
      setEditing(null);
      void invalidate(v.id);
    },
    onError: () => toast.error("Could not update payer"),
  });

  const listResp = listQ.data;
  const okResp =
    listResp && listResp.status === "ok" ? listResp : null;
  const items: PayerListItem[] = okResp?.items ?? [];
  const total = okResp?.total ?? 0;
  const hasNext = okResp?.has_next ?? false;
  const pageItems: PayerListItem[] = items;
  void okResp;



  const summary = useMemo(
    () => ({
      total,
      active: items.filter((i) => i.is_active).length,
      inactive: items.filter((i) => !i.is_active).length,
    }),
    [items, total],
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));


  const resetFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setStatus("all");
    setPage(0);
  };
  const filtersActive =
    !!debounced || typeFilter !== "all" || status !== "all";

  return (
    <div className="min-h-screen bg-[#F6F8F7]">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <Link
          to="/society/income"
          className="inline-flex items-center gap-1 text-sm text-[#667085] hover:text-[#0B2545] min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Income
        </Link>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-[#0B2545]">
              External Payers
            </h1>
            <p className="text-sm text-[#667085] mt-1">
              Manage vendors, advertisers and other non-member payers.
            </p>
          </div>
          <Button
            className="min-h-[44px] rounded-[14px] bg-[#00A896] hover:bg-[#007E70] text-white shadow-[0_6px_16px_-6px_rgba(0,168,150,0.55)]"
            onClick={() => setEditing({ mode: "create" })}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Payer
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <SummaryCard label="Total" value={summary.total} tint="bg-[#E6F7F4] text-[#007E70]" icon={Users} />
          <SummaryCard label="Active" value={summary.active} tint="bg-[#E8F5EE] text-[#12B76A]" icon={ShieldCheck} />
          <SummaryCard label="Inactive" value={summary.inactive} tint="bg-[#FEF3F2] text-[#B42318]" icon={UserX} />
        </div>

        <div className="rounded-[18px] bg-white border border-[#DDE9E6] p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#667085]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payers"
              className="pl-9 min-h-[44px] rounded-[14px] border-[#DDE9E6] bg-white"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="min-h-[44px] w-[160px] rounded-[14px] border-[#DDE9E6]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {PAYER_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="min-h-[44px] w-[130px] rounded-[14px] border-[#DDE9E6]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button
              variant="outline"
              className="min-h-[44px] rounded-[14px] border-[#DDE9E6] text-[#667085]"
              onClick={resetFilters}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Reset
            </Button>
          )}
        </div>

        <div className="rounded-[18px] bg-white border border-[#DDE9E6] overflow-hidden">
          {listQ.isError ? (
            <div className="p-6 text-sm text-[#F04438] flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Payers are temporarily unavailable.
            </div>
          ) : listQ.isLoading ? (
            <div className="divide-y divide-[#DDE9E6]">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="p-4 flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-9 w-9 rounded-xl" />
                </div>
              ))}
            </div>
          ) : items.length === 0 && !filtersActive && page === 0 ? (
            <div className="p-8 text-center">
              <div className="mx-auto h-12 w-12 rounded-2xl bg-[#E6F7F4] text-[#007E70] grid place-items-center">
                <Users className="h-5 w-5" />
              </div>
              <div className="mt-3 text-sm font-medium text-[#0B2545]">
                No external payers yet
              </div>
              <p className="text-xs text-[#667085] mt-1">
                Add vendors, advertisers or other non-member payers.
              </p>
              <Button
                className="mt-4 min-h-[44px] rounded-[14px] bg-[#00A896] hover:bg-[#007E70] text-white"
                onClick={() => setEditing({ mode: "create" })}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Payer
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-sm font-medium text-[#0B2545]">No matches</div>
              <p className="text-xs text-[#667085] mt-1">
                Try clearing filters or a different search term.
              </p>
              <Button
                variant="outline"
                className="mt-4 min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                onClick={resetFilters}
              >
                Reset filters
              </Button>
            </div>

          ) : (
            <>
              <div className="divide-y divide-[#DDE9E6]">
                {pageItems.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-4">
                    <div
                      className={`shrink-0 h-11 w-11 rounded-full grid place-items-center text-sm font-semibold ${tintFor(p.id)}`}
                    >
                      {initials(p.display_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[#0B2545] truncate flex items-center gap-2">
                        {p.display_name}
                        {p.is_active ? (
                          <Badge className="text-[10px] bg-[#E8F5EE] text-[#12B76A] border-transparent">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="text-[10px] bg-[#FEF3F2] text-[#B42318] border-transparent">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-[#667085] truncate mt-0.5 flex items-center gap-1.5">
                        <Badge className="text-[10px] bg-[#EEF4FF] text-[#3155D4] border-transparent">
                          {PAYER_TYPE_LABEL[p.payer_type] ?? p.payer_type}
                        </Badge>
                        {p.organization_name && (
                          <span className="truncate">
                            · {p.organization_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                      onClick={() =>
                        setEditing({ mode: "edit", payerId: p.id })
                      }
                      aria-label={`Edit ${p.display_name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between gap-2 border-t border-[#DDE9E6] px-4 py-3 text-sm">
                  <div className="text-[#667085]">
                    Page {currentPage + 1} of {totalPages} · {total}{" "}
                    payers
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[40px] rounded-[14px] border-[#DDE9E6]"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={currentPage === 0}
                    >
                      <ChevronLeft className="h-4 w-4" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[40px] rounded-[14px] border-[#DDE9E6]"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={!hasNext}
                    >
                      Next <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </div>

      <PayerDialog
        editing={editing}
        societyId={societyId}
        onClose={() => setEditing(null)}
        onCreate={(v) => createMut.mutate(v)}
        onUpdate={(v) => updateMut.mutate(v)}
        submitting={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}

interface PayerDetailForm {
  payer_type: PayerType;
  display_name: string;
  organization_name: string;
  phone: string;
  email: string;
  reference_code: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: PayerDetailForm = {
  payer_type: "vendor",
  display_name: "",
  organization_name: "",
  phone: "",
  email: "",
  reference_code: "",
  notes: "",
  is_active: true,
};

function PayerDialog(props: {
  editing: Editing;
  societyId: string;
  onClose: () => void;
  onCreate: (v: {
    payer_type: PayerType;
    display_name: string;
    organization_name?: string;
    phone?: string;
    email?: string;
    reference_code?: string;
    notes?: string;
  }) => void;
  onUpdate: (v: {
    id: string;
    payer_type?: PayerType;
    display_name?: string;
    organization_name?: string;
    phone?: string;
    email?: string;
    reference_code?: string;
    notes?: string;
    is_active?: boolean;
  }) => void;
  submitting: boolean;
}) {
  const { editing, societyId, onClose, onCreate, onUpdate, submitting } = props;
  const isEdit = editing?.mode === "edit";
  const editingPayerId = editing?.mode === "edit" ? editing.payerId : null;
  const detailFn = useServerFn(getNonMemberPayerDetailFn);

  const detailQ = useQuery({
    enabled: !!editingPayerId,
    queryKey: incomeKeys.payerDetail(societyId, editingPayerId ?? ""),
    queryFn: async () =>
      detailFn({ data: { societyId, payerId: editingPayerId! } }),
  });

  const [form, setForm] = useState<PayerDetailForm>(EMPTY_FORM);

  const openKey = editing ? (isEdit ? editingPayerId! : "new") : "closed";
  useEffect(() => {
    if (editing?.mode === "create") setForm(EMPTY_FORM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  useEffect(() => {
    if (isEdit && detailQ.data && detailQ.data.code === "ok") {
      const p = detailQ.data.payer;
      setForm({
        payer_type: p.payer_type as PayerType,
        display_name: p.display_name,
        organization_name: p.organization_name ?? "",
        phone: p.phone ?? "",
        email: p.email ?? "",
        reference_code: p.reference_code ?? "",
        notes: p.notes ?? "",
        is_active: p.is_active,
      });
    }
  }, [isEdit, detailQ.data]);

  const detailLoading = isEdit && detailQ.isLoading;
  const detailUnavailable =
    isEdit && (detailQ.isError || detailQ.data?.code === "not_found");

  const emailError =
    form.email.trim() && !EMAIL_RE.test(form.email.trim())
      ? "Enter a valid email address."
      : "";

  const submit = () => {
    if (!form.display_name.trim()) return;
    if (emailError) return;
    const base = {
      payer_type: form.payer_type,
      display_name: form.display_name.trim(),
      organization_name: form.organization_name.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      reference_code: form.reference_code.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    if (isEdit && editingPayerId) {
      onUpdate({ id: editingPayerId, ...base, is_active: form.is_active });
    } else {
      onCreate(base);
    }
  };

  const set = <K extends keyof PayerDetailForm>(k: K, v: PayerDetailForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[24px] border-[#DDE9E6] bg-white/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[#0B2545]">
            {isEdit ? "Edit payer" : "New payer"}
          </DialogTitle>
          <DialogDescription className="text-[#667085]">
            {isEdit
              ? "Update details or deactivate this payer."
              : "Add a vendor, advertiser or other external payer."}
          </DialogDescription>
        </DialogHeader>
        {detailLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-10 w-full rounded-[14px]" />
            <Skeleton className="h-10 w-full rounded-[14px]" />
            <Skeleton className="h-20 w-full rounded-[14px]" />
          </div>
        ) : detailUnavailable ? (
          <div className="p-4 rounded-[14px] bg-[#FEF3F2] text-sm text-[#B42318] flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> This payer is unavailable.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-[#667085]">Type</Label>
              <Select
                value={form.payer_type}
                onValueChange={(v) => set("payer_type", v as PayerType)}
              >
                <SelectTrigger className="min-h-[44px] rounded-[14px] border-[#DDE9E6]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYER_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payer-name" className="text-xs text-[#667085]">Display name</Label>
              <Input
                id="payer-name"
                className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                value={form.display_name}
                onChange={(e) => set("display_name", e.target.value)}
                placeholder="ACME Signage Pvt Ltd"
                maxLength={120}
              />
            </div>
            <div>
              <Label htmlFor="payer-org" className="text-xs text-[#667085]">Organization (optional)</Label>
              <Input
                id="payer-org"
                className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                value={form.organization_name}
                onChange={(e) => set("organization_name", e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="payer-phone" className="text-xs text-[#667085]">Phone (optional)</Label>
                <Input
                  id="payer-phone"
                  className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98xxxxxxx"
                  inputMode="tel"
                  maxLength={20}
                />
              </div>
              <div>
                <Label htmlFor="payer-email" className="text-xs text-[#667085]">Email (optional)</Label>
                <Input
                  id="payer-email"
                  className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  maxLength={160}
                />
                {emailError && (
                  <p className="text-[11px] text-[#F04438] mt-1">{emailError}</p>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="payer-ref" className="text-xs text-[#667085]">Reference code (optional)</Label>
              <Input
                id="payer-ref"
                className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
                value={form.reference_code}
                onChange={(e) => set("reference_code", e.target.value)}
                placeholder="GST / internal code"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="payer-notes" className="text-xs text-[#667085]">Notes (optional)</Label>
              <Textarea
                id="payer-notes"
                rows={3}
                className="rounded-[14px] border-[#DDE9E6]"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                maxLength={1000}
              />
            </div>
            {isEdit && (
              <div className="flex items-center justify-between rounded-[14px] border border-[#DDE9E6] bg-[#F6F8F7] px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-[#0B2545]">Active</div>
                  <div className="text-[11px] text-[#667085]">
                    Inactive payers are hidden from new income entries.
                  </div>
                </div>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => set("is_active", v)}
                  aria-label="Active"
                />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-[44px] rounded-[14px] border-[#DDE9E6]"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px] rounded-[14px] bg-[#00A896] hover:bg-[#007E70] text-white"
            onClick={submit}
            disabled={
              submitting ||
              detailLoading ||
              !!detailUnavailable ||
              !form.display_name.trim() ||
              !!emailError
            }
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isEdit ? (
              "Save Payer"
            ) : (
              "Add Payer"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
