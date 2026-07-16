import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertCircle, Plus, Pencil, Users } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  listNonMemberPayersFn,
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
    <FeatureGate feature="non_member_payments">
      <PayersPage />
    </FeatureGate>
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

function PayersPage() {
  const { societyId, loading } = useSocietyId();
  const qc = useQueryClient();
  const listFn = useServerFn(listNonMemberPayersFn);
  const createFn = useServerFn(createNonMemberPayerFn);
  const updateFn = useServerFn(updateNonMemberPayerFn);

  const listQ = useQuery({
    enabled: !!societyId,
    queryKey: incomeKeys.payers(societyId ?? ""),
    queryFn: async () => listFn({ data: { societyId: societyId! } }),
  });

  const [editing, setEditing] = useState<Editing>(null);

  const invalidate = () => {
    for (const key of incomeInvalidations.payer(societyId ?? "")) {
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
    }) => createFn({ data: { societyId: societyId!, ...v } }),
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
    }) => updateFn({ data: { societyId: societyId!, ...v } }),
    onSuccess: () => {
      toast.success("Payer updated");
      setEditing(null);
      void invalidate();
    },
    onError: () => toast.error("Could not update payer"),
  });

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const items = (listQ.data?.items ?? []) as PayerListItem[];

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
      <Link
        to="/society/income"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Income
      </Link>
      <MobileHero
        icon={Users}
        title="External Payers"
        subtitle="Manage vendors, advertisers and other non-member payers."
      />

      <div className="flex justify-end">
        <Button className="min-h-[44px]" onClick={() => setEditing({ mode: "create" })}>
          <Plus className="h-4 w-4 mr-1" /> New payer
        </Button>
      </div>

      <SectionCard
        title="Payer directory"
        description="Deactivate a payer to hide them from new records."
      >
        {listQ.isError ? (
          <div className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> Payers are temporarily unavailable.
          </div>
        ) : listQ.isLoading ? (
          <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No non-member payers yet. Add your first one.
          </div>
        ) : (
          <div className="divide-y">
            {items.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 py-3 px-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {p.display_name}
                    {!p.is_active && (
                      <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.payer_type.replace(/_/g, " ")}
                    {p.organization_name ? ` · ${p.organization_name}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setEditing({ mode: "edit", payerId: p.id })}
                  aria-label={`Edit ${p.display_name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

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
    queryKey: ["society-income", "payer-detail", societyId, editingPayerId],
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

  const submit = () => {
    if (!form.display_name.trim()) return;
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit payer" : "New payer"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update details or deactivate this payer."
              : "Add a vendor, advertiser or other external payer."}
          </DialogDescription>
        </DialogHeader>
        {detailLoading ? (
          <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading payer…
          </div>
        ) : detailUnavailable ? (
          <div className="p-4 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> This payer is unavailable.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Type</Label>
              <Select
                value={form.payer_type}
                onValueChange={(v) => set("payer_type", v as PayerType)}
              >
                <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYER_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payer-name" className="text-xs">Display name</Label>
              <Input
                id="payer-name"
                className="min-h-[44px]"
                value={form.display_name}
                onChange={(e) => set("display_name", e.target.value)}
                placeholder="ACME Signage Pvt Ltd"
                maxLength={120}
              />
            </div>
            <div>
              <Label htmlFor="payer-org" className="text-xs">Organization (optional)</Label>
              <Input
                id="payer-org"
                className="min-h-[44px]"
                value={form.organization_name}
                onChange={(e) => set("organization_name", e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="payer-phone" className="text-xs">Phone (optional)</Label>
                <Input
                  id="payer-phone"
                  className="min-h-[44px]"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+91 98xxxxxxx"
                  inputMode="tel"
                  maxLength={20}
                />
              </div>
              <div>
                <Label htmlFor="payer-email" className="text-xs">Email (optional)</Label>
                <Input
                  id="payer-email"
                  className="min-h-[44px]"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  maxLength={160}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="payer-ref" className="text-xs">Reference code (optional)</Label>
              <Input
                id="payer-ref"
                className="min-h-[44px]"
                value={form.reference_code}
                onChange={(e) => set("reference_code", e.target.value)}
                placeholder="GST / internal code"
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="payer-notes" className="text-xs">Notes (optional)</Label>
              <Textarea
                id="payer-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                maxLength={1000}
              />
            </div>
            {isEdit && (
              <label className="flex items-center gap-2 text-sm min-h-[44px]">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                />
                Active
              </label>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            className="min-h-[44px]"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px]"
            onClick={submit}
            disabled={
              submitting || detailLoading || detailUnavailable || !form.display_name.trim()
            }
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
