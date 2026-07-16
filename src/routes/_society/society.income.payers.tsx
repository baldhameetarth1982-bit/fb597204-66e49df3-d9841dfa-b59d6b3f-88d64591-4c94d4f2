import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState } from "react";
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
} from "@/lib/non-member-income.functions";

export const Route = createFileRoute("/_society/society/income/payers")({
  head: () => ({
    meta: [
      { title: "Non-Member Payers — SociyoHub" },
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

interface PayerItem {
  id: string;
  society_id: string;
  payer_type: PayerType;
  display_name: string;
  organization_name: string | null;
  phone: string | null;
  email: string | null;
  reference_code: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

type Editing =
  | { mode: "create" }
  | { mode: "edit"; row: PayerItem }
  | null;

function PayersPage() {
  const { societyId, loading } = useSocietyId();
  const qc = useQueryClient();
  const listFn = useServerFn(listNonMemberPayersFn);
  const createFn = useServerFn(createNonMemberPayerFn);
  const updateFn = useServerFn(updateNonMemberPayerFn);

  const listQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "payers", societyId],
    queryFn: async () => listFn({ data: { societyId: societyId! } }),
  });

  const [editing, setEditing] = useState<Editing>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["society-income", "payers", societyId] });

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

  const items = (listQ.data?.items ?? []) as PayerItem[];

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
        title="Non-Member Payers"
        subtitle="Vendors, advertisers, coaches and other external payers."
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
                    {p.phone ? ` · ${p.phone}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px]"
                  onClick={() => setEditing({ mode: "edit", row: p })}
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
        onClose={() => setEditing(null)}
        onCreate={(v) => createMut.mutate(v)}
        onUpdate={(v) => updateMut.mutate(v)}
        submitting={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}

function PayerDialog(props: {
  editing: Editing;
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
  const { editing, onClose, onCreate, onUpdate, submitting } = props;
  const isEdit = editing?.mode === "edit";
  const row = editing?.mode === "edit" ? editing.row : null;

  const [payerType, setPayerType] = useState<PayerType>("vendor");
  const [displayName, setDisplayName] = useState("");
  const [organization, setOrganization] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);

  const openKey = editing ? (isEdit ? row!.id : "new") : "closed";
  const [lastOpen, setLastOpen] = useState<string>("closed");
  if (openKey !== lastOpen) {
    setLastOpen(openKey);
    if (isEdit && row) {
      setPayerType(row.payer_type);
      setDisplayName(row.display_name);
      setOrganization(row.organization_name ?? "");
      setPhone(row.phone ?? "");
      setEmail(row.email ?? "");
      setReference(row.reference_code ?? "");
      setNotes(row.notes ?? "");
      setActive(row.is_active);
    } else if (editing?.mode === "create") {
      setPayerType("vendor");
      setDisplayName("");
      setOrganization("");
      setPhone("");
      setEmail("");
      setReference("");
      setNotes("");
      setActive(true);
    }
  }

  const submit = () => {
    if (!displayName.trim()) return;
    const base = {
      payer_type: payerType,
      display_name: displayName.trim(),
      organization_name: organization.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      reference_code: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    if (isEdit && row) {
      onUpdate({ id: row.id, ...base, is_active: active });
    } else {
      onCreate(base);
    }
  };

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
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <Select
              value={payerType}
              onValueChange={(v) => setPayerType(v as PayerType)}
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
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="ACME Signage Pvt Ltd"
            />
          </div>
          <div>
            <Label htmlFor="payer-org" className="text-xs">Organization (optional)</Label>
            <Input
              id="payer-org"
              className="min-h-[44px]"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label htmlFor="payer-phone" className="text-xs">Phone (optional)</Label>
              <Input
                id="payer-phone"
                className="min-h-[44px]"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98xxxxxxx"
                inputMode="tel"
              />
            </div>
            <div>
              <Label htmlFor="payer-email" className="text-xs">Email (optional)</Label>
              <Input
                id="payer-email"
                className="min-h-[44px]"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="payer-ref" className="text-xs">Reference code (optional)</Label>
            <Input
              id="payer-ref"
              className="min-h-[44px]"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="GST / internal code"
            />
          </div>
          <div>
            <Label htmlFor="payer-notes" className="text-xs">Notes (optional)</Label>
            <Textarea
              id="payer-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
            />
          </div>
          {isEdit && (
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          )}
        </div>
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
            disabled={submitting || !displayName.trim()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
