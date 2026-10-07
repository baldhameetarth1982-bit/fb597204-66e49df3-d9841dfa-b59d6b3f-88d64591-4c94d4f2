import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, Flag, ImagePlus, Pause, Pencil, Play, Plus, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { ListEmpty, ListSkeleton, StatusChip } from "@/components/people/PeopleUI";
import { uploadListingImage } from "@/lib/community.functions";
import { communityError } from "@/lib/community-errors";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, normalizePhone, safeHttpsUrl } from "@/lib/discovery";

export const Route = createFileRoute("/_admin/admin/marketplace")({
  head: () => ({ meta: [{ title: "Marketplace — Super Admin" }, { name: "description", content: "Manage SociyoHub listings shown to every society." }] }),
  component: MarketplaceAdmin,
});

type Row = { id: string; category_id: string | null; kind: string; title: string; description: string | null; price_inr: number | null;
  contact_method: "phone" | "whatsapp" | "link"; contact_phone: string | null; contact_link: string | null; status: string; expires_at: string | null; created_at: string; updated_at: string };

const KINDS = [["offer", "Offering"], ["request", "Looking for"], ["help", "Community help"], ["opportunity", "Opportunity"]] as const;
const TONE: Record<string, "success" | "info" | "muted" | "warning"> = { published: "success", paused: "info", archived: "muted", removed: "warning" };
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function MarketplaceAdmin() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [reportsFor, setReportsFor] = useState<Row | null>(null);
  const q = useQuery({
    queryKey: ["admin-market"],
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("admin_market_list"); if (error) throw error; return (data ?? []) as Row[]; },
  });
  const status = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { id: string; status: string }) => { const { error } = await (supabase as any).rpc("admin_market_set_status", { _id: v.id, _status: v.status }); if (error) throw error; },
    onSuccess: () => { toast.success("Listing updated"); qc.invalidateQueries({ queryKey: ["admin-market"] }); },
    onError: (e) => toast.error(communityError(e)),
  });
  return (
    <PageShell>
      <PageHeader title="Marketplace" description="SociyoHub listings are shown to residents of every society. Only Super Admins can manage them."
        actions={<Button className="min-h-11" onClick={() => setEdit("new")}><Plus className="mr-1 h-4 w-4" />New listing</Button>} />
      {q.isLoading ? <ListSkeleton rows={3} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} showSupport={false} /> : !q.data!.length ? (
        <ListEmpty icon={Store} title="No SociyoHub listings yet">Create one to show it in every society's Marketplace.</ListEmpty>
      ) : (
        <ul className="mx-auto max-w-3xl divide-y overflow-hidden rounded-2xl border bg-card">
          {q.data!.map((l) => (
            <li key={l.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusChip tone="success">SociyoHub</StatusChip>
                <StatusChip tone={TONE[l.status] ?? "muted"}>{l.status}</StatusChip>
              </div>
              <p className="font-medium break-words">{l.title}</p>
              {l.price_inr != null && <p className="text-sm font-semibold tabular-nums">{l.price_inr === 0 ? "Free" : inr(Number(l.price_inr))}</p>}
              {l.expires_at && <p className="text-xs text-muted-foreground">Expires {new Date(l.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => setEdit(l)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                {l.status !== "published" && <Button size="sm" variant="outline" className="min-h-11" disabled={status.isPending} onClick={() => status.mutate({ id: l.id, status: "published" })}><Play className="mr-1 h-4 w-4" />Publish</Button>}
                {l.status === "published" && <Button size="sm" variant="outline" className="min-h-11" disabled={status.isPending} onClick={() => status.mutate({ id: l.id, status: "paused" })}><Pause className="mr-1 h-4 w-4" />Pause</Button>}
                {l.status !== "archived" && <Button size="sm" variant="ghost" className="min-h-11" disabled={status.isPending} onClick={() => status.mutate({ id: l.id, status: "archived" })}><Archive className="mr-1 h-4 w-4" />Archive</Button>}
                <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setReportsFor(l)}><Flag className="mr-1 h-4 w-4" />Reports</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && <EditDialog target={edit} onClose={() => setEdit(null)} />}
      {reportsFor && <ReportsDialog listing={reportsFor} onClose={() => setReportsFor(null)} />}
    </PageShell>
  );
}

function EditDialog({ target, onClose }: { target: Row | "new"; onClose: () => void }) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadListingImage);
  const e = target === "new" ? null : target;
  const [f, setF] = useState({ kind: e?.kind ?? "offer", title: e?.title ?? "", description: e?.description ?? "", price: e?.price_inr != null ? String(e.price_inr) : "",
    contact_method: e?.contact_method ?? "link", contact_phone: e?.contact_phone ?? "", contact_link: e?.contact_link ?? "", expires_days: "30" });
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const errors: string[] = [];
  if (f.title.trim().length < 3 || f.title.length > 80) errors.push("Title must be 3–80 characters.");
  if (/[<>{}]/.test(f.title + f.description)) errors.push("Remove < > { } characters.");
  if (f.price && !(Number(f.price) >= 0)) errors.push("Enter a valid price.");
  if (f.contact_method !== "link" && !normalizePhone(f.contact_phone)) errors.push("Enter a valid phone number.");
  if (f.contact_method === "link" && !safeHttpsUrl(f.contact_link)) errors.push("Enter a valid https link.");
  if (file && (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)) errors.push("Photo must be PNG, JPG or WebP and 2 MB or smaller.");
  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { data: id, error } = await (supabase as any).rpc("admin_market_save", {
        _id: e?.id ?? null, _category_id: null, _kind: f.kind, _title: f.title.trim(), _description: f.description.trim(),
        _price_inr: f.price ? Number(f.price) : null, _contact_method: f.contact_method, _contact_phone: f.contact_phone || null,
        _contact_link: f.contact_link || null, _expires_days: e ? null : Number(f.expires_days),
      });
      if (error) throw error;
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const r = await upload({ data: { listingId: id as string, base64: btoa(bin) } });
        if (!r.ok) toast.error(r.message ?? "Photo could not be saved.");
      } else if (removeImage && e) {
        await upload({ data: { listingId: id as string, base64: null } });
      }
    },
    onSuccess: () => { toast.success(e ? "Listing updated" : "Listing created"); qc.invalidateQueries({ queryKey: ["admin-market"] }); onClose(); },
    onError: (err) => toast.error(communityError(err)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{e ? "Edit SociyoHub listing" : "New SociyoHub listing"}</DialogTitle><DialogDescription>Shown to every society once published.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Type</Label>
            <Select value={f.kind} onValueChange={(v) => set("kind", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor="mt">Title</Label><Input id="mt" className="min-h-11" maxLength={80} value={f.title} onChange={(ev) => set("title", ev.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="md">Description</Label><Textarea id="md" maxLength={800} value={f.description} onChange={(ev) => set("description", ev.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="mp">Price (₹, optional)</Label><Input id="mp" inputMode="decimal" className="min-h-11" value={f.price} onChange={(ev) => set("price", ev.target.value)} /></div>
          <div className="space-y-1"><Label>Contact</Label>
            <Select value={f.contact_method} onValueChange={(v) => set("contact_method", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="link">Website link</SelectItem><SelectItem value="phone">Phone</SelectItem><SelectItem value="whatsapp">WhatsApp</SelectItem></SelectContent></Select></div>
          {f.contact_method === "link"
            ? <div className="space-y-1"><Label htmlFor="ml">Link</Label><Input id="ml" className="min-h-11" value={f.contact_link} onChange={(ev) => set("contact_link", ev.target.value)} placeholder="https://" /></div>
            : <div className="space-y-1"><Label htmlFor="mph">Business phone</Label><Input id="mph" inputMode="tel" className="min-h-11" value={f.contact_phone} onChange={(ev) => set("contact_phone", ev.target.value)} /></div>}
          {!e && <div className="space-y-1"><Label>Show for</Label>
            <Select value={f.expires_days} onValueChange={(v) => set("expires_days", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{["7", "14", "30", "60", "90", "180"].map((d) => <SelectItem key={d} value={d}>{d} days</SelectItem>)}</SelectContent></Select></div>}
          <div className="space-y-1">
            <Label htmlFor="mi" className="flex items-center gap-2"><ImagePlus className="h-4 w-4" />Photo</Label>
            <Input id="mi" type="file" accept="image/png,image/jpeg,image/webp" className="min-h-11" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
            {e && !file && <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setRemoveImage((r) => !r)}><Trash2 className="mr-1 h-4 w-4" />{removeImage ? "Keep current photo" : "Remove current photo"}</Button>}
          </div>
          {errors.length > 0 && <p className="text-xs text-destructive">{errors[0]}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportsDialog({ listing, onClose }: { listing: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-market-reports", listing.id],
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("admin_market_reports", { _id: listing.id }); if (error) throw error; return (data ?? []) as { id: string; reason: string; created_at: string }[]; },
  });
  const dismiss = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => { const { error } = await (supabase as any).rpc("admin_market_dismiss_reports", { _id: listing.id }); if (error) throw error; },
    onSuccess: () => { toast.success("Reports dismissed"); qc.invalidateQueries({ queryKey: ["admin-market-reports", listing.id] }); },
    onError: (e) => toast.error(communityError(e)),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle className="break-words">Reports — {listing.title}</DialogTitle><DialogDescription>Reporter identities are not shown.</DialogDescription></DialogHeader>
        {q.isLoading ? <ListSkeleton rows={2} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} showSupport={false} /> : !q.data!.length ? <p className="text-sm text-muted-foreground">No open reports.</p> : (
          <ul className="space-y-2">{q.data!.map((r) => <li key={r.id} className="rounded-xl border p-3 text-sm break-words">{r.reason}<p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-IN")}</p></li>)}</ul>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
          <Button className="min-h-11" disabled={!q.data?.length || dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss all</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
