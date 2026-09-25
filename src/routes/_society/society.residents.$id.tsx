import { StatusChip } from "@/components/people/PeopleUI";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Loader2, User, Users, Home, Phone, Mail, IndianRupee, FileText,
  History, ChevronDown, ChevronRight, Edit2, Save, X, AlertTriangle,
  Calendar, ShieldCheck, Upload, Trash2, Paperclip, Download,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageShell } from "@/components/shared/PageHeader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  updateResidentProfile, flatOutstanding, flatOccupancyHistory, residentHousehold,
} from "@/lib/residents.functions";
import { getResidentPrivateDetail } from "@/lib/residents-admin.functions";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/residents/$id")({
  head: () => ({ meta: [{ title: "Resident — SociyoHub" }] }),
  component: ResidentDetailPage,
});

function initials(name?: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function ResidentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { societyId } = useSocietyId();
  const update = useServerFn(updateResidentProfile);
  const getOutstanding = useServerFn(flatOutstanding);
  const getHistory = useServerFn(flatOccupancyHistory);
  const getPrivate = useServerFn(getResidentPrivateDetail);
  const getHousehold = useServerFn(residentHousehold);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [openSection, setOpenSection] = useState<string>("basic");

  // Private detail (strict Zod-parsed server response). Directory rows never
  // carry phone/email/KYC; this authorised server function is the only path
  // that exposes them to the admin UI.
  const { data: privateResult, isLoading, isError, refetch } = useQuery({
    enabled: !!societyId,
    queryKey: ["resident-private", societyId, id],
    queryFn: async () => getPrivate({ data: { societyId: societyId!, userId: id } }),
  });

  const resident = (() => {
    if (!privateResult || privateResult.status !== "available") return null;
    const active = privateResult.data.relationships.find((r) => r.is_active) ?? null;
    return { profile: privateResult.data.profile, assignment: active, detail: privateResult.data };
  })();

  const flatId = resident?.assignment?.flat_id ?? null;
  // Moved-out residents have no active flat; show the history of their last house.
  const historyFlatId = flatId ?? resident?.detail.relationships[0]?.flat_id ?? null;

  const household = useQuery({
    enabled: !!resident && openSection === "household",
    queryKey: ["resident-household", id],
    queryFn: async () => getHousehold({ data: { userId: id } }),
  });

  const { data: outstanding } = useQuery({
    enabled: !!flatId,
    queryKey: ["flat-outstanding", flatId],
    queryFn: async () => getOutstanding({ data: { flatId: flatId! } }),
  });

  const { data: history } = useQuery({
    enabled: !!historyFlatId && openSection === "history",
    queryKey: ["flat-history", historyFlatId],
    queryFn: async () => getHistory({ data: { flatId: historyFlatId! } }),
  });

  const { data: bills } = useQuery({
    enabled: !!flatId && openSection === "bills",
    queryKey: ["flat-bills", flatId],
    queryFn: async () => {
      const { data } = await supabase
        .from("bills")
        .select("id, bill_number, period_label, amount, status, due_date, paid_at")
        .eq("flat_id", flatId ?? "")

        .order("bill_date", { ascending: false })
        .limit(24);
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      </PageShell>
    );
  }

  if (isError) {
    return (
      <PageShell>
        <div className="py-20 text-center space-y-3">
          <p className="font-medium">Couldn't load this resident</p>
          <p className="text-sm text-muted-foreground">Please check your connection and try again.</p>
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => void refetch()}>Try again</Button>
        </div>
      </PageShell>
    );
  }

  if (!resident) {
    return (
      <PageShell>
        <div className="py-20 text-center text-muted-foreground">Resident not found.</div>
      </PageShell>
    );
  }

  const p = resident.profile;
  const a = resident.assignment;

  function startEdit() {
    setForm({
      full_name: p.full_name ?? "",
      phone: p.phone ?? "",
      email: p.email ?? "",
      property_number: p.property_number ?? "",
      ugvcl_number: p.ugvcl_number ?? "",
      share_certificate_number: p.share_certificate_number ?? "",
      move_in_date: p.move_in_date ?? "",
    });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) {
        patch[k] = v === "" ? null : v;
      }
      await update({ data: { userId: p.id, patch } });
      toast.success("Profile updated");
      setEditing(false);
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  const phoneDigits = (p.phone ?? "").replace(/\D/g, "");
  const waLink = phoneDigits
    ? `https://wa.me/${phoneDigits.length === 10 ? "91" + phoneDigits : phoneDigits}`
    : null;

  const Section = ({ id: sid, title, icon: Icon, children }: any) => {
    const isOpen = openSection === sid;
    return (
      <section className="border-b border-border last:border-0">
        <h2>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={`sec-${sid}`}
            onClick={() => setOpenSection(isOpen ? "" : sid)}
            className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex items-center gap-2.5 text-sm font-medium"><Icon className="h-4 w-4 text-muted-foreground" />{title}</span>
            {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
        </h2>
        {isOpen && <div id={`sec-${sid}`} className="px-4 pb-4">{children}</div>}
      </section>
    );
  };

  const movedOut = !a && resident.detail.relationships.length > 0;
  const rel = a?.relationship ?? null;
  const relLabel = rel === "owner" || rel === "co-owner" ? (rel === "co-owner" ? "Co-owner" : "Owner") : rel === "tenant" ? "Tenant" : rel;
  const house = a ? `${a.block_name ? a.block_name + "-" : ""}${a.flat_number ?? ""}` : null;
  const pending = outstanding ? Number(outstanding.pending) : 0;

  return (
    <PageShell>
      <Button variant="ghost" className="mb-3 min-h-11 -ml-2" onClick={() => navigate({ to: "/society/residents" })}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Residents
      </Button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* Identity header */}
          <header className="flex items-start gap-4">
            <Avatar className="h-16 w-16 shrink-0">
              {p.avatar_url ? <AvatarImage src={p.avatar_url} alt="" /> : null}
              <AvatarFallback className="bg-primary-container text-primary-container-foreground text-lg font-semibold">{initials(p.full_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h1 className="type-section truncate">{p.full_name ?? "Unnamed resident"}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {house ? `House ${house}` : movedOut ? "No current house" : "Not linked to a house"}
                {a?.moved_in_at ? ` · since ${new Date(a.moved_in_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {relLabel && <StatusChip tone={rel === "tenant" ? "info" : "primary"}>{relLabel}</StatusChip>}
                {a ? <StatusChip tone="success">Current</StatusChip> : movedOut ? <StatusChip tone="muted">Moved out</StatusChip> : <StatusChip tone="warning">No house</StatusChip>}
                {p.aadhaar_verified && <StatusChip tone="success"><ShieldCheck className="mr-1 h-3 w-3" />KYC verified</StatusChip>}
              </div>
            </div>
          </header>

          {/* Contact actions */}
          {(p.phone || p.email) && (
            <div className="flex flex-wrap gap-2" aria-label="Contact resident">
              {p.phone && <Button asChild className="min-h-11 rounded-xl"><a href={`tel:${p.phone}`}><Phone className="h-4 w-4 mr-2" />Call</a></Button>}
              {waLink && <Button asChild variant="outline" className="min-h-11 rounded-xl"><a href={waLink} target="_blank" rel="noreferrer">WhatsApp</a></Button>}
              {p.email && <Button asChild variant="outline" className="min-h-11 rounded-xl"><a href={`mailto:${p.email}`}><Mail className="h-4 w-4 mr-2" />Email</a></Button>}
            </div>
          )}

          {!a && (
            <p className="rounded-2xl bg-warning-container px-4 py-3 text-sm text-warning-container-foreground">
              {movedOut ? "This resident has moved out. Past occupancy is kept in the history below." : "This resident isn't linked to any house yet. Assign a house from the Residents list."}
            </p>
          )}

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <Section id="basic" title="Identity & contact" icon={User}>
          {editing ? (
            <div className="space-y-3 pt-3">
              <Field label="Full name" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
              <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={save} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  <X className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <dl className="pt-3 space-y-2 text-sm">
              <Row label="Full name" value={p.full_name} />
              <Row label="Phone" value={p.phone} />
              <Row label="Email" value={p.email} />
              <Row label="Move-in date" value={p.move_in_date ? new Date(p.move_in_date).toLocaleDateString() : null} />
              <Button size="sm" variant="outline" onClick={startEdit} className="mt-2">
                <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
            </dl>
          )}
        </Section>

        <Section id="household" title="Household members" icon={Users}>
          <div className="pt-3 space-y-2">
            {household.isLoading ? (
              <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" /></div>
            ) : household.isError ? (
              <div className="py-3 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Couldn't load household members.</p>
                <Button size="sm" variant="outline" onClick={() => void household.refetch()}>Try again</Button>
              </div>
            ) : !household.data?.length ? (
              <p className="text-sm text-muted-foreground py-3 text-center">No family members added by this resident.</p>
            ) : (
              household.data.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                  <span className="font-medium truncate">{m.full_name}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-3 capitalize">
                    {m.relation}{m.age != null ? ` · ${m.age}y` : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </Section>
        <Section id="history" title="Occupancy history" icon={History}>
          <div className="pt-3 space-y-2">
            {!history ? (
              <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" /></div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">No history yet.</p>
            ) : (
              history.map((h: any) => (
                <div key={h.id} className="flex items-start justify-between text-sm py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{h.profiles?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      <span className="capitalize">{h.relationship}</span>{h.is_primary ? " · primary" : ""}
                    </div>
                    {h.ended_reason ? (
                      <div className="text-[11px] text-muted-foreground italic mt-0.5">"{h.ended_reason}"</div>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <Badge variant="outline" className={`text-[10px] ${h.is_active ? "border-emerald-500/30 text-emerald-600" : "text-muted-foreground"}`}>
                      {h.is_active ? "Current" : "Moved out"}
                    </Badge>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {h.moved_in_at ? new Date(h.moved_in_at).toLocaleDateString() : new Date(h.created_at).toLocaleDateString()}
                      {h.moved_out_at ? ` → ${new Date(h.moved_out_at).toLocaleDateString()}` : ""}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>
        <Section id="property" title="Resident information" icon={Home}>
          {editing ? (
            <div className="space-y-3 pt-3">
              <Field label="Property number" value={form.property_number} onChange={(v) => setForm({ ...form, property_number: v })} />
              <Field label="UGVCL number" value={form.ugvcl_number} onChange={(v) => setForm({ ...form, ugvcl_number: v })} />
              <Field label="Share certificate" value={form.share_certificate_number} onChange={(v) => setForm({ ...form, share_certificate_number: v })} />
              <Field label="Move-in date" value={form.move_in_date} onChange={(v) => setForm({ ...form, move_in_date: v })} type="date" />
            </div>
          ) : (
            <dl className="pt-3 space-y-2 text-sm">
              <Row label="House" value={a ? `${a.block_name ?? ""} ${a.flat_number ?? ""}`.trim() || null : null} />
              <Row label="Type" value={a?.relationship} />
              <Row label="Property number" value={p.property_number} />
              <Row label="UGVCL" value={p.ugvcl_number} />
              <Row label="Share certificate" value={p.share_certificate_number} />
              {!editing && (
                <Button size="sm" variant="outline" onClick={startEdit} className="mt-2">
                  <Edit2 className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
            </dl>
          )}
        </Section>

        <Section id="bills" title="Bills" icon={FileText}>
          <div className="pt-3 space-y-2">
            {!bills ? (
              <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" /></div>
            ) : bills.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3 text-center">No bills yet.</p>
            ) : (
              bills.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{b.period_label}</div>
                    <div className="text-xs text-muted-foreground">{b.bill_number ?? "—"}</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="font-medium">₹{Number(b.amount).toLocaleString("en-IN")}</div>
                    <div className={`text-[10px] font-medium ${b.status === "paid" ? "text-emerald-600" : b.status === "cancelled" ? "text-muted-foreground" : "text-amber-600"}`}>
                      {b.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Section>

        <Section id="documents" title="Documents" icon={Paperclip}>
          <DocumentsPanel userId={p.id} active={openSection === "documents"} />
        </Section>


          </div>
        </div>

        {/* Side summary: occupancy + dues */}
        <aside className="space-y-3" aria-label="Occupancy summary">
          <dl className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
            <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-muted-foreground">House</dt><dd className="font-medium">{house ?? "—"}</dd></div>
            <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-muted-foreground">Type</dt><dd className="font-medium">{relLabel ?? "—"}</dd></div>
            <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-muted-foreground">Outstanding</dt><dd className="font-semibold tabular-nums">{!flatId ? "—" : outstanding ? `₹${pending.toLocaleString("en-IN")}` : "—"}</dd></div>
            {outstanding && outstanding.overdue_count > 0 && (
              <div className="px-4 py-3"><StatusChip tone="warning">{outstanding.overdue_count} overdue period{outstanding.overdue_count === 1 ? "" : "s"}</StatusChip></div>
            )}
          </dl>
        </aside>
      </div>
    </PageShell>
  );
}

function Field({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="rounded-lg" />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium text-right">{value || "—"}</dd>
    </div>
  );
}

type DocRow = { name: string; size: number; updated_at: string | null };

function DocumentsPanel({ userId, active }: { userId: string; active: boolean }) {
  const [items, setItems] = useState<DocRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const prefix = useMemo(() => `residents/${userId}`, [userId]);

  async function refresh() {
    const { data, error } = await supabase.storage.from("uploads").list(prefix, {
      limit: 100, sortBy: { column: "updated_at", order: "desc" },
    });
    if (error) { toast.error(error.message); setItems([]); return; }
    setItems(
      (data ?? [])
        .filter((f) => f.name && !f.name.endsWith("/"))
        .map((f) => ({
          name: f.name,
          size: (f.metadata as any)?.size ?? 0,
          updated_at: f.updated_at ?? null,
        })),
    );
  }

  useEffect(() => { if (active && items === null) refresh(); /* eslint-disable-next-line */ }, [active]);

  async function onUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const file of Array.from(files)) {
      if (file.size > 15 * 1024 * 1024) { toast.error(`${file.name}: exceeds 15 MB`); fail++; continue; }
      const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
      const path = `${prefix}/${Date.now()}-${safe}`;
      const { error } = await supabase.storage.from("uploads").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type || undefined,
      });
      if (error) { toast.error(`${file.name}: ${error.message}`); fail++; } else ok++;
    }
    setBusy(false);
    if (ok) toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
    await refresh();
  }

  async function openDoc(name: string) {
    const { data, error } = await supabase.storage.from("uploads")
      .createSignedUrl(`${prefix}/${name}`, 60 * 10);
    if (error || !data?.signedUrl) { toast.error(error?.message ?? "Failed"); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function deleteDoc(name: string) {
    if (!confirm(`Delete ${name}?`)) return;
    const { error } = await supabase.storage.from("uploads").remove([`${prefix}/${name}`]);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    await refresh();
  }

  return (
    <div className="pt-3 space-y-3">
      <label className="inline-flex">
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
        <span className="inline-flex items-center px-3 h-9 rounded-lg border bg-primary text-primary-foreground text-xs font-medium cursor-pointer hover:opacity-90">
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          Upload documents
        </span>
      </label>

      {items === null ? (
        <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin inline text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 text-center">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((f) => {
            const display = f.name.replace(/^\d{10,}-/, "");
            return (
              <div key={f.name} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{display}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {(f.size / 1024).toFixed(1)} KB
                    {f.updated_at ? " · " + new Date(f.updated_at).toLocaleDateString() : ""}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openDoc(f.name)} title="Open">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => deleteDoc(f.name)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">Max 15 MB per file. Stored in the private "uploads" bucket.</p>
    </div>
  );
}
