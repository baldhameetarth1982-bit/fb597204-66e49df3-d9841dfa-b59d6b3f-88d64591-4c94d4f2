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
import { localeTag, tu } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/config/roles";
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
const KIND_KEYS = ["offer", "request", "help", "opportunity"] as const;
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
  const { t } = useTranslation();
  const [tab, setTab] = useState<"browse" | "mine">("browse");
  const [cat, setCat] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | "new" | null>(null);
  const cats = useCategories();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("cm.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("cm.subtitle")}</p>
        </div>
        <Button className="min-h-11 rounded-xl" onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" />{t("cm.new")}</Button>
      </div>
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(["browse", "mine"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-11 rounded-lg text-sm font-medium ${tab === k ? "bg-background shadow-sm" : "text-muted-foreground"}`}>
            {k === "browse" ? t("cm.browse") : t("cm.mine")}
          </button>
        ))}
      </div>
      {tab === "browse" ? (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            <Chip active={!cat} onClick={() => setCat(null)}>{t("common.all")}</Chip>
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
  const { t } = useTranslation();
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
  if (q.isError) return <LoadError title={t("cm.loadFailed")} onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <ListEmpty icon={Store} title={t("cm.none")}>{t("cm.noneHint")}</ListEmpty>;
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
                  <StatusChip tone="info">{t(`cm.k.${l.kind}`)}</StatusChip>
                  {l.category_id && <StatusChip tone="muted">{cats.find((c) => c.id === l.category_id)?.label ?? t("cm.other")}</StatusChip>}
                  {l.creator_type === "sociyohub" && <StatusChip tone="success">SociyoHub</StatusChip>}
                  {l.creator_type === "society" && <StatusChip tone="success">{t("cm.badgeSociety")}</StatusChip>}
                  {l.is_mine && <StatusChip tone="success">{t("cm.yours")}</StatusChip>}
                </div>
                <p className="font-medium break-words">{l.title}</p>
                {l.price_inr != null && <p className="text-sm font-semibold tabular-nums">{l.price_inr === 0 ? t("cm.free") : inr(Number(l.price_inr))}</p>}
                {l.description && <p className="whitespace-pre-line text-sm text-muted-foreground break-words">{l.description}</p>}
                <p className="text-xs text-muted-foreground">{attribution(l, t, new Date(l.created_at).toLocaleDateString(localeTag(), { day: "numeric", month: "short" }))}</p>
                {!l.is_mine && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {l.contact_method === "in_app" && <Button className="min-h-11 rounded-xl" onClick={() => setContact(l)}><MessageCircle className="mr-2 h-4 w-4" />{t("cm.message")}</Button>}
                    {tel && <Button asChild className="min-h-11 rounded-xl"><a href={tel}><Phone className="mr-2 h-4 w-4" />{t("comm.call")}</a></Button>}
                    {wa && <Button asChild className="min-h-11 rounded-xl"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />{tu("op.whatsapp")}</a></Button>}
                    {link && <Button asChild variant="outline" className="min-h-11 rounded-xl"><a href={link} target="_blank" rel="noopener noreferrer nofollow"><Globe className="mr-2 h-4 w-4" />{t("cm.openLink")}</a></Button>}
                    <Button variant="ghost" className="min-h-11 rounded-xl text-muted-foreground" onClick={() => setReport(l)}><Flag className="mr-2 h-4 w-4" />{t("cm.report")}</Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {contact && <TextActionDialog title={t("cm.msgAbout", { title: contact.title })} description={t("cm.msgDesc")} label={t("cm.message")} cta={t("cm.send")}
        onClose={() => setContact(null)} run={async (msg) => { const { error } = await (supabase as any).rpc("market_contact", { _id: contact.id, _message: msg }); if (error) throw error; toast.success(t("cm.msgSent")); }} />}
      {report && <TextActionDialog title={t("cm.reportTitle")} description={t("cm.reportDesc")} label={t("cm.whatsWrong")} cta={t("cm.report")}
        onClose={() => setReport(null)} run={async (msg) => { const { error } = await (supabase as any).rpc("market_report", { _id: report.id, _reason: msg }); if (error) throw error; toast.success(t("cm.reported")); }} />}
    </>
  );
}

// Attribution never shows a resident's name; an unknown historical house stays neutral instead of guessed.
function attribution(l: MarketListing, t: (k: string, o?: Record<string, unknown>) => string, date: string) {
  if (l.creator_type === "sociyohub") return t("cm.by", { name: "SociyoHub", date });
  if (l.creator_type === "society") return l.society_name ? t("cm.by", { name: l.society_name, date }) : t("cm.byResident", { date });
  return l.house_label ? t("cm.byHouse", { house: l.house_label, date }) : t("cm.byResident", { date });
}

function TextActionDialog({ title, description, label, cta, onClose, run }: { title: string; description: string; label: string; cta: string; onClose: () => void; run: (t: string) => Promise<void> }) {
  const { t } = useTranslation();
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
          <Button variant="outline" className="min-h-11" onClick={onClose}>{t("common.cancel")}</Button>
          <Button className="min-h-11" disabled={invalid || m.isPending} onClick={() => m.mutate()}>{m.isPending ? t("cm.sending") : cta}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_TONE: Record<string, { label: string; tone: "success" | "warning" | "muted" | "info" }> = {
  published: { label: "cm.st.published", tone: "success" },
  paused: { label: "cm.st.paused", tone: "info" },
  archived: { label: "cm.st.archived", tone: "muted" },
  removed: { label: "cm.st.removed", tone: "warning" },
};

function Mine({ onEdit, cats }: { onEdit: (l: any) => void; cats: Cat[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fetchMine = useServerFn(listMyListings);
  const q = useQuery({ queryKey: ["community-mine"], queryFn: () => fetchMine(), staleTime: 15_000 });
  const setStatus = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async (v: { id: string; status: string }) => { const { error } = await (supabase as any).rpc("market_set_status", { _id: v.id, _status: v.status }); if (error) throw error; },
    onSuccess: () => { toast.success(t("cm.updated")); qc.invalidateQueries({ queryKey: ["community-mine"] }); qc.invalidateQueries({ queryKey: ["community-browse"] }); },
    onError: (e) => toast.error(communityError(e)),
  });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError) return <LoadError title={t("cm.mineFailed")} onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <ListEmpty icon={Store} title={t("cm.mineNone")}>{t("cm.mineNoneHint")}</ListEmpty>;
  return (
    <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
      {items.map((l: any) => {
        const expired = l.status === "published" && l.expires_at && new Date(l.expires_at) <= new Date();
        const st = expired ? { label: "cm.st.expired", tone: "muted" as const } : STATUS_TONE[l.status];
        return (
          <li key={l.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip tone={st.tone}>{t(st.label)}</StatusChip>
              {l.category_id && <StatusChip tone="muted">{cats.find((c) => c.id === l.category_id)?.label ?? t("cm.other")}</StatusChip>}
            </div>
            <p className="font-medium break-words">{l.title}</p>
            {l.status === "removed" && l.removed_reason && <InlineNotice icon={Flag} title={t("cm.reason")}>{l.removed_reason}</InlineNotice>}
            {l.expires_at && l.status !== "removed" && <p className="text-xs text-muted-foreground">{t(expired ? "cm.expiredOn" : "cm.expiresOn", { date: new Date(l.expires_at).toLocaleDateString(localeTag(), { day: "numeric", month: "short", year: "numeric" }) })}</p>}
            {l.status !== "removed" && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="min-h-11" onClick={() => onEdit(l)}><Pencil className="mr-1 h-4 w-4" />{t("common.edit")}</Button>
                {(l.status !== "published" || expired) && <Button size="sm" variant="outline" className="min-h-11" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: l.id, status: "published" })}><Play className="mr-1 h-4 w-4" />{expired ? t("cm.renew") : t("cm.publish")}</Button>}
                {l.status === "published" && !expired && <Button size="sm" variant="outline" className="min-h-11" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: l.id, status: "paused" })}><Pause className="mr-1 h-4 w-4" />{t("cm.pause")}</Button>}
                {l.status !== "archived" && <Button size="sm" variant="ghost" className="min-h-11" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: l.id, status: "archived" })}><Archive className="mr-1 h-4 w-4" />{t("cm.archive")}</Button>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ListingDialog({ target, cats, onClose }: { target: any | "new"; cats: Cat[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const upload = useServerFn(uploadListingImage);
  const e = target === "new" ? null : target;
  const { hasAnyRole } = useAuth();
  const canPostAsSociety = hasAnyRole([ROLES.SOCIETY_ADMIN]);
  const [as, setAs] = useState<"resident" | "society">(e?.creator_type === "society" ? "society" : "resident");
  const [visibility, setVisibility] = useState<"society" | "all">(e?.visibility === "all" ? "all" : "society");
  const globalQ = useQuery({
    queryKey: ["market-global-allowed"], enabled: as === "society", staleTime: 60_000,
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("market_global_allowed"); if (error) throw error; return !!data; },
  });
  const globalAllowed = globalQ.data === true;
  const [f, setF] = useState({
    category_id: e?.category_id ?? "", kind: e?.kind ?? "offer", title: e?.title ?? "", description: e?.description ?? "",
    price: e?.price_inr != null ? String(e.price_inr) : "", contact_method: e?.contact_method ?? "in_app",
    contact_phone: e?.contact_phone ?? "", contact_link: e?.contact_link ?? "", expires_days: "30",
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const errors: Record<string, string> = {};
  if (f.title.trim().length < 3 || f.title.length > 80) errors.title = t("cm.e.title");
  for (const k of ["title", "description"] as const) if (/[<>{}]/.test(f[k])) errors[k] = t("cm.e.chars");
  if (f.price && !(Number(f.price) >= 0)) errors.price = t("cm.e.price");
  if ((f.contact_method === "phone" || f.contact_method === "whatsapp") && !normalizePhone(f.contact_phone)) errors.contact_phone = t("cm.e.phone");
  if (f.contact_method === "link" && !safeHttpsUrl(f.contact_link)) errors.contact_link = t("cm.e.link");
  if (file && (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)) errors.file = t("cm.e.file");

  const save = useMutation({
    networkMode: "always", retry: false,
    mutationFn: async () => {
      const { data: id, error } = await (supabase as any).rpc("market_save_listing", {
        _id: e?.id ?? null, _category_id: f.category_id || null, _kind: f.kind, _title: f.title.trim(), _description: f.description.trim(),
        _price_inr: f.price ? Number(f.price) : null, _contact_method: f.contact_method, _contact_phone: f.contact_phone || null,
        _contact_link: f.contact_link || null, _expires_days: e ? null : Number(f.expires_days),
        _as: as, _visibility: as === "society" ? visibility : "society",
      });
      if (error) throw error;
      if (file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const r = await upload({ data: { listingId: id as string, base64: btoa(bin) } });
        if (!r.ok) toast.error(t("cm.photoFailed", { reason: r.message }));
      } else if (removeImage && e?.image_path) {
        await upload({ data: { listingId: id as string, base64: null } });
      }
    },
    onSuccess: () => { toast.success(e ? t("cm.updated") : t("cm.published")); qc.invalidateQueries({ queryKey: ["community-mine"] }); qc.invalidateQueries({ queryKey: ["community-browse"] }); onClose(); },
    onError: (err) => toast.error(communityError(err)),
  });
  const Err = ({ k }: { k: string }) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{e ? t("cm.editTitle") : t("cm.newTitle")}</DialogTitle><DialogDescription>{t("cm.visibleOnly")}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {canPostAsSociety && !e && (
            <div className="space-y-1"><Label>{t("cm.postAs")}</Label>
              <Select value={as} onValueChange={(v) => { setAs(v as "resident" | "society"); setVisibility("society"); }}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="resident">{t("cm.asMe")}</SelectItem><SelectItem value="society">{t("cm.asSociety")}</SelectItem></SelectContent></Select></div>
          )}
          {as === "society" && (
            <div className="space-y-1"><Label>{t("cm.visibility")}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as "society" | "all")}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="society">{t("cm.visSociety")}</SelectItem><SelectItem value="all" disabled={!globalAllowed}>{t("cm.visAll")}</SelectItem></SelectContent></Select>
              {globalQ.isSuccess && !globalAllowed && <p className="text-xs text-muted-foreground">{t("cm.visAllOff")}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>{t("cm.type")}</Label>
              <Select value={f.kind} onValueChange={(v) => set("kind", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{KIND_KEYS.map((k) => <SelectItem key={k} value={k}>{t(`cm.k.${k}`)}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1"><Label>{t("common.category")}</Label>
              <Select value={f.category_id || "none"} onValueChange={(v) => set("category_id", v === "none" ? "" : v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">{t("cm.other")}</SelectItem>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-1"><Label htmlFor="t">{t("cm.fTitle")}</Label><Input id="t" className="min-h-11" maxLength={80} value={f.title} onChange={(ev) => set("title", ev.target.value)} /><Err k="title" /></div>
          <div className="space-y-1"><Label htmlFor="d">{t("common.description")}</Label><Textarea id="d" maxLength={800} value={f.description} onChange={(ev) => set("description", ev.target.value)} /><Err k="description" /></div>
          <div className="space-y-1"><Label htmlFor="p">{t("cm.price")}</Label><Input id="p" inputMode="decimal" className="min-h-11" value={f.price} onChange={(ev) => set("price", ev.target.value)} /><Err k="price" /></div>
          <div className="space-y-1"><Label>{t("cm.howContact")}</Label>
            <Select value={f.contact_method} onValueChange={(v) => set("contact_method", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in_app">{t("cm.c.inApp")}</SelectItem>
                <SelectItem value="phone">{t("cm.c.phone")}</SelectItem>
                <SelectItem value="whatsapp">{t("cm.c.wa")}</SelectItem>
                <SelectItem value="link">{t("cm.c.link")}</SelectItem>
              </SelectContent></Select></div>
          {(f.contact_method === "phone" || f.contact_method === "whatsapp") && (
            <div className="space-y-1"><Label htmlFor="ph">{t("cm.numberPublish")}</Label><Input id="ph" inputMode="tel" className="min-h-11" value={f.contact_phone} onChange={(ev) => set("contact_phone", ev.target.value)} />
              <p className="text-xs text-muted-foreground">{t("cm.numberWarn")}</p><Err k="contact_phone" /></div>
          )}
          {f.contact_method === "link" && <div className="space-y-1"><Label htmlFor="ln">{t("cm.link")}</Label><Input id="ln" className="min-h-11" placeholder="https://" value={f.contact_link} onChange={(ev) => set("contact_link", ev.target.value)} /><Err k="contact_link" /></div>}
          {!e && <div className="space-y-1"><Label>{t("cm.showFor")}</Label>
            <Select value={f.expires_days} onValueChange={(v) => set("expires_days", v)}><SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>{["7", "14", "30", "60", "90"].map((d) => <SelectItem key={d} value={d}>{t("cm.days", { n: d })}</SelectItem>)}</SelectContent></Select></div>}
          <div className="space-y-1">
            <Label htmlFor="img" className="flex items-center gap-2"><ImagePlus className="h-4 w-4" />{t("cm.photo")}</Label>
            <Input id="img" type="file" accept="image/png,image/jpeg,image/webp" className="min-h-11" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} />
            <Err k="file" />
            {e?.image_url && !file && (
              <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setRemoveImage((r) => !r)}><Trash2 className="mr-1 h-4 w-4" />{removeImage ? t("cm.keepPhoto") : t("cm.removePhoto")}</Button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="min-h-11" onClick={onClose}>{t("common.cancel")}</Button>
          <Button className="min-h-11" disabled={Object.keys(errors).length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? t("cm.saving") : e ? t("common.save") : t("cm.publish")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
