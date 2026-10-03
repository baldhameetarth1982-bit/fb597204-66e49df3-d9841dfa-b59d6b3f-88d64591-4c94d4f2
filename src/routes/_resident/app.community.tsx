import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Flag, Globe, ImagePlus, MessageCircle, Pause, Pencil, Phone, Play, Plus, Archive, Store, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineNotice, ListEmpty, ListSkeleton, LoadError, StatusChip } from "@/components/people/PeopleUI";
import { listMarketplace, listMyListings, uploadListingImage, type MarketListing } from "@/lib/community.functions";
import { communityError } from "@/lib/community-errors";
import { normalizePhone, safeHttpsUrl, telHref, whatsappHref, IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/discovery";

export const Route = createFileRoute("/_resident/app/community")({
  head: () => ({
    meta: [
      { title: "Community Marketplace — SociyoHub" },
      { name: "description", content: "Offer and find services, items and help from neighbours in your society." },
      { property: "og:title", content: "Community Marketplace — SociyoHub" },
      { property: "og:description", content: "Resident-to-resident listings, only visible inside your society." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CommunityScreen,
});

type Cat = { id: string; label: string };
const KIND_LABEL = { offer: "Offering", request: "Looking for", help: "Community help", opportunity: "Opportunity" } as const;
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

function useCategories() {
  return useQuery({
    queryKey: ["community-categories"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("community_listing_categories").select("id,label").eq("active", true).order("sort_order");
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });
}

function CommunityScreen() {
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [cat, setCat] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const cats = useCategories();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Community</h1>
          <p className="text-sm text-muted-foreground">Listings from neighbours — only people in your society can see them.</p>
        </div>
        <Button className="min-h-11 rounded-xl" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" />New</Button>
      </div>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(["browse", "mine"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`min-h-11 rounded-lg text-sm font-medium ${tab === t ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
            {t === "browse" ? "Browse" : "My listings"}
          </button>
        ))}
      </div>
      {tab === "browse" ? (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <Chip active={!cat} onClick={() => setCat(null)}>All</Chip>
            {(cats.data ?? []).map((c) => <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</Chip>)}
          </div>
          <Browse categoryId={cat} cats={cats.data ?? []} />
        </>
      ) : (
        <Mine onEdit={setEditing} cats={cats.data ?? []} />
      )}
      {editing && <ListingDialog target={editing} cats={cats.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${active ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>
      {children}
    </button>
  );
}

function Browse({ categoryId, cats }: { categoryId: string | null; cats: Cat[] }) {
  const fetchList = useServerFn(listMarketplace);
  const q = useQuery({
    queryKey: ["community-browse", categoryId],
    queryFn: () => fetchList({ data: { categoryId } }),
    placeholderData: (p) => p,
    staleTime: 30_000,
  });
  const [contact, setContact] = useState<MarketListing | null>(null);
  const [report, setReport] = useState<MarketListing | null>(null);
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError) return <LoadError title="Couldn't load listings" onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <ListEmpty icon={Store} title="No listings yet">Be the first to offer something to your neighbours.</ListEmpty>;
  return (
    <>
      <ul className="space-y-3">
        {items.map((l) => {
          const tel = l.contact_method === "phone" ? telHref(l.contact_phone) : null;
          const wa = l.contact_method === "whatsapp" ? whatsappHref(l.contact_phone) : null;
          const link = l.contact_method === "link" ? safeHttpsUrl(l.contact_link) : null;
          return (
            <li key={l.id} className="overflow-hidden rounded-2xl border bg-card">
              {l.image_url && <img src={l.image_url} alt="" loading="lazy" className="aspect-[16/9] w-full object-cover" />}
              <div className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip tone="info">{KIND_LABEL[l.kind]}</StatusChip>
                  {l.category_id && <StatusChip tone="muted">{cats.find((c) => c.id === l.category_id)?.label ?? "Other"}</StatusChip>}
                  {l.is_mine && <StatusChip tone="success">Yours</StatusChip>}
                </div>
                <p className="font-medium break-words">{l.title}</p>
                {l.price_inr != null && <p className="text-sm font-semibold tabular-nums">{l.price_inr === 0 ? "Free" : inr(Number(l.price_inr))}</p>}
                {l.description && <p className="whitespace-pre-line text-sm text-muted-foreground break-words">{l.description}</p>}
                <p className="text-xs text-muted-foreground">By {l.owner_name} · {new Date(l.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
                {!l.is_mine && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {l.contact_method === "in_app" && <Button className="min-h-11 rounded-xl" onClick={() => setContact(l)}><MessageCircle className="mr-2 h-4 w-4" />Message</Button>}
                    {tel && <Button asChild className="min-h-11 rounded-xl"><a href={tel}><Phone className="mr-2 h-4 w-4" />Call</a></Button>}
                    {wa && <Button asChild className="min-h-11 rounded-xl"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button>}
                    {link && <Button asChild variant="outline" className="min-h-11 rounded-xl"><a href={link} target="_blank" rel="noopener noreferrer nofollow"><Globe className="mr-2 h-4 w-4" />Open link</a></Button>}
                    <Button variant="ghost" className="min-h-11 rounded-xl text-muted-foreground" onClick={() => setReport(l)}><Flag className="mr-2 h-4 w-4" />Report</Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {contact && <TextActionDialog title={`Message about “${contact.title}”`} description="The owner gets an in-app notification with your first name and house. Your phone number is not shared." label="Message" cta="Send"
        onClose={() => setContact(null)} run={async (t) => { const { error } = await (supabase as any).rpc("market_contact", { _id: contact.id, _message: t }); if (error) throw error; toast.success("Message sent to the owner"); }} />}
      {report && <TextActionDialog title="Report listing" description="The committee will review it. The owner won't see who reported." label="What's wrong?" cta="Report"
        onClose={() => setReport(null)} run={async (t) => { const { error } = await (supabase as any).rpc("market_report", { _id: report.id, _reason: t }); if (error) throw error; toast.success("Reported to the committee"); }} />}
    </>
  );
}

function TextActionDialog({ title, description, label, cta, onClose, run }: { title: string; description: string; label: string; cta: string; onClose: () => void; run: (t: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const m = useMutation({ networkMode: "always", retry: false, mutationFn: () => run(text.trim()), onSuccess: onClose, onError: (e) => toast.error(communityError(e)) });
  const invalid = text.trim().length < 3 || /[<>{}]/.test(text);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <Label htmlFor="ta">{label}</Label>
        <Textarea id="ta" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={invalid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Sending…" : cta}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TONE: Record<string, { label: string; tone: "success" | "warning" | "muted" | "info" }> = {
  published: { label: "Live", tone: "success" },
  paused: { label: "Paused", tone: "info" },
  archived: { label: "Archived", tone: "muted" },
  removed: { label: "Removed by committee", tone: "warning" },
};

function Mine({ onEdit, cats }: { onEdit: (l: any) => void; cats: Cat[] }) {
  const qc = useQueryClient();
  const fetchMine = useServerFn(listMyListings);
  const q = useQuery({ queryKey: ["community-mine"], queryFn: () => fetchMine(), staleTime: 15_000 });
  const setStatus = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { id: string; status: string }) => { const { error } = await (supabase as any).rpc("market_set_status", { _id: v.id, _status: v.status }); if (error) throw error; },
    onSuccess: () => { toast.success("Listing updated"); qc.invalidateQueries({ queryKey: ["community-mine"] }); qc.invalidateQueries({ queryKey: ["community-browse"] }); },
    onError: (e) => toast.error(communityError(e)),
  });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError) return <LoadError title="Couldn't load your listings" onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <ListEmpty icon={Store} title="You have no listings">Tap New to offer a service, item or help.</ListEmpty>;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
      {items.map((l: any) => {
        const expired = l.status === "published" && l.expires_at && new Date(l.expires_at) <= new Date();
        const st = expired ? { label: "Expired", tone: "muted" as const } : STATUS_TONE[l.status];
        return (
          <li key={l.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip tone={st.tone}>{st.label}</StatusChip>
              {l.category_id && <StatusChip tone="muted">{cats.find((c) => c.id === l.category_id)?.label ?? "Other"}</StatusChip>}
            </div>
            <p className="font-medium break-words">{l.title}</p>
            {l.status === "removed" && l.removed_reason && <InlineNotice icon={Flag} title="Reason">{l.removed_reason}</InlineNotice>}
            {l.expires_at && l.status !== "removed" && <p className="text-xs text-muted-foreground">{expired ? "Expired" : "Expires"} {new Date(l.expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>}
            {l.status !== "removed" && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => onEdit(l)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                {(l.status !== "published" || expired) && <Button size="sm" variant="outline" className="min-h-11" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: l.id, status: "published" })}><Play className="mr-1 h-4 w-4" />{expired ? "Renew 30 days" : "Publish"}</Button>}
                {l.status === "published" && !expired && <Button size="sm" variant="outline" className="min-h-11" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: l.id, status: "paused" })}><Pause className="mr-1 h-4 w-4" />Pause</Button>}
                {l.status !== "archived" && <Button size="sm" variant="ghost" className="min-h-11" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: l.id, status: "archived" })}><Archive className="mr-1 h-4 w-4" />Archive</Button>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ListingDialog({ target, cats, onClose }: { target: any | "new"; cats: Cat[]; onClose: () => void }) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadListingImage);
  const e = target === "new" ? null : target;
  const [f, setF] = useState({
    category_id: e?.category_id ?? "", kind: e?.kind ?? "offer", title: e?.title ?? "", description: e?.description ?? "",
    price: e?.price_inr != null ? String(e.price_inr) : "", contact_method: e?.contact_method ?? "in_app",
    contact_phone: e?.contact_phone ?? "", contact_link: e?.contact_link ?? "", expires_days: "30",
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const errors: Record<string, string> = {};
  if (f.title.trim().length < 3 || f.title.length > 80) errors.title = "Use 3–80 characters.";
  for (const k of ["title", "description"] as const) if (/[<>{}]/.test(f[k])) errors[k] = "Remove < > { } characters.";
  if (f.price && !(Number(f.price) >= 0)) errors.price = "Enter a valid amount.";
  if ((f.contact_method === "phone" || f.contact_method === "whatsapp") && !normalizePhone(f.contact_phone)) errors.contact_phone = "Enter 8–15 digits.";
  if (f.contact_method === "link" && !safeHttpsUrl(f.contact_link)) errors.contact_link = "Only full https:// links.";
  if (file && (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)) errors.file = "PNG, JPG or WebP up to 2 MB.";

  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { data: id, error } = await (supabase as any).rpc("market_save_listing", {
        _id: e?.id ?? null, _category_id: f.category_id || null, _kind: f.kind, _title: f.title.trim(), _description: f.description.trim(),
        _price_inr: f.price ? Number(f.price) : null, _contact_method: f.contact_method, _contact_phone: f.contact_phone || null,
        _contact_link: f.contact_link || null, _expires_days: e ? null : Number(f.expires_days),
      });
      if (error) throw error;
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const r = await upload({ data: { listingId: id as string, base64: btoa(bin) } });
        if (!r.ok) toast.error(`Listing saved, but the photo failed: ${r.message}`);
      } else if (removeImage && e?.image_path) {
        await upload({ data: { listingId: id as string, base64: null } });
      }
    },
    onSuccess: () => { toast.success(e ? "Listing updated" : "Listing published"); qc.invalidateQueries({ queryKey: ["community-mine"] }); qc.invalidateQueries({ queryKey: ["community-browse"] }); onClose(); },
    onError: (err) => toast.error(communityError(err)),
  });
  const Err = ({ k }: { k: string }) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{e ? "Edit listing" : "New listing"}</DialogTitle><DialogDescription>Visible only to members of your society.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Type</Label>
              <Select value={f.kind} onValueChange={(v) => set("kind", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KIND_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>Category</Label>
              <Select value={f.category_id || "none"} onValueChange={(v) => set("category_id", v === "none" ? "" : v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Other</SelectItem>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label htmlFor="t">Title</Label><Input id="t" className="min-h-11" maxLength={80} value={f.title} onChange={(ev) => set("title", ev.target.value)} /><Err k="title" /></div>
          <div className="space-y-1"><Label htmlFor="d">Description</Label><Textarea id="d" maxLength={800} value={f.description} onChange={(ev) => set("description", ev.target.value)} /><Err k="description" /></div>
          <div className="space-y-1"><Label htmlFor="p">Price in ₹ (optional, 0 = free)</Label><Input id="p" inputMode="decimal" className="min-h-11" value={f.price} onChange={(ev) => set("price", ev.target.value)} /><Err k="price" /></div>
          <div className="space-y-1"><Label>How should people contact you?</Label>
            <Select value={f.contact_method} onValueChange={(v) => set("contact_method", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in_app">In-app message (phone stays private)</SelectItem>
                <SelectItem value="phone">Show my phone for calls</SelectItem>
                <SelectItem value="whatsapp">Show WhatsApp number</SelectItem>
                <SelectItem value="link">A website link</SelectItem>
              </SelectContent></Select></div>
          {(f.contact_method === "phone" || f.contact_method === "whatsapp") && (
            <div className="space-y-1"><Label htmlFor="ph">Number to publish</Label><Input id="ph" inputMode="tel" className="min-h-11" value={f.contact_phone} onChange={(ev) => set("contact_phone", ev.target.value)} />
              <p className="text-xs text-muted-foreground">Everyone in your society will see this number.</p><Err k="contact_phone" /></div>
          )}
          {f.contact_method === "link" && <div className="space-y-1"><Label htmlFor="ln">Link</Label><Input id="ln" className="min-h-11" placeholder="https://" value={f.contact_link} onChange={(ev) => set("contact_link", ev.target.value)} /><Err k="contact_link" /></div>}
          {!e && <div className="space-y-1"><Label>Show for</Label>
            <Select value={f.expires_days} onValueChange={(v) => set("expires_days", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{["7", "14", "30", "60", "90"].map((d) => <SelectItem key={d} value={d}>{d} days</SelectItem>)}</SelectContent></Select></div>}
          <div className="space-y-1">
            <Label htmlFor="img" className="flex items-center gap-2"><ImagePlus className="h-4 w-4" />Photo (optional)</Label>
            <Input id="img" type="file" accept="image/png,image/jpeg,image/webp" className="min-h-11" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
            <Err k="file" />
            {e?.image_url && !file && (
              <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setRemoveImage((r) => !r)}><Trash2 className="mr-1 h-4 w-4" />{removeImage ? "Keep current photo" : "Remove current photo"}</Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button className="min-h-11" disabled={Object.keys(errors).length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : e ? "Save" : "Publish"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
