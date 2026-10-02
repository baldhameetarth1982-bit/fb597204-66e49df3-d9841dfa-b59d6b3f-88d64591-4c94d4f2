import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Boxes, CalendarClock, ClipboardList, FileText, LogOut, Phone, Wrench } from "lucide-react";
import { RoleShell, Loading, ErrorRow, errText } from "@/components/roles/RoleShell";
import { TicketEvidence } from "@/components/helpdesk/TicketEvidence";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import {
  consumeStaffInventory, getStaffContext, getStaffTimeline, listStaffAssets, listStaffDocuments, listStaffInventory,
  listStaffTickets, listStaffVendors, logStaffAssetService, openStaffDocument, updateStaffTicket, type StaffTicket,
} from "@/lib/role-access.functions";

export const Route = createFileRoute("/staff")({
  head: () => ({ meta: [
    { title: "Staff workspace — SociyoHub" },
    { name: "description", content: "Assigned helpdesk work, assets, inventory and shift details for society staff." },
    { property: "og:title", content: "Staff workspace — SociyoHub" },
    { property: "og:description", content: "Society staff see only the work and areas they've been given." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <RoleShell role="staff">{(a) => <StaffWorkspace permissions={a.permissions} />}</RoleShell>,
});

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_LABEL: Record<string, string> = { open: "Open", reopened: "Reopened", in_progress: "In progress", on_hold: "On hold", awaiting_approval: "Awaiting approval", resolved: "Done", closed: "Closed", rejected: "Rejected", cancelled: "Cancelled" };
const mutOpts = { networkMode: "always" as const, retry: false };

function StaffWorkspace({ permissions }: { permissions: string[] }) {
  const { signOut } = useAuth();
  const ctxFn = useServerFn(getStaffContext);
  const ctx = useQuery({ queryKey: ["staff-ctx"], queryFn: () => ctxFn(), retry: false });
  const has = (p: string) => permissions.includes(p);
  const tabs = [
    has("staff.helpdesk") && { v: "work", label: "My work" },
    has("staff.assets") && { v: "assets", label: "Assets" },
    has("staff.inventory") && { v: "inventory", label: "Inventory" },
    has("staff.vendors") && { v: "vendors", label: "Vendors" },
    has("staff.documents") && { v: "docs", label: "Documents" },
    { v: "shift", label: "Shift" },
  ].filter(Boolean) as { v: string; label: string }[];

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Staff · {ctx.data?.society_name ?? "Society"}</p>
          <h1 className="text-2xl font-semibold">{ctx.data ? `Hi, ${ctx.data.full_name}` : "Your work"}</h1>
          {ctx.data && <p className="text-sm capitalize text-muted-foreground">{ctx.data.job_type.replace(/_/g, " ")}</p>}
        </div>
        <Button variant="outline" className="min-h-11" onClick={async () => { await signOut(); window.location.replace("/login"); }}><LogOut className="mr-1 h-4 w-4" />Sign out</Button>
      </header>
      {permissions.length === 0 && (
        <div role="note" className="mb-4 rounded-lg border bg-muted/40 p-3 text-sm">The committee hasn't given you any work areas yet. You can still see your shift.</div>
      )}
      <Tabs defaultValue={tabs[0]!.v}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="mb-4 min-w-max">{tabs.map((t) => <TabsTrigger key={t.v} value={t.v}>{t.label}</TabsTrigger>)}</TabsList>
        </div>
        {has("staff.helpdesk") && <TabsContent value="work"><WorkTab /></TabsContent>}
        {has("staff.assets") && <TabsContent value="assets"><AssetsTab /></TabsContent>}
        {has("staff.inventory") && <TabsContent value="inventory"><InventoryTab /></TabsContent>}
        {has("staff.vendors") && <TabsContent value="vendors"><VendorsTab /></TabsContent>}
        {has("staff.documents") && <TabsContent value="docs"><DocsTab /></TabsContent>}
        <TabsContent value="shift">
          <SectionCard title="Shift & attendance" icon={CalendarClock}>
            {ctx.error ? <ErrorRow error={ctx.error} onRetry={() => ctx.refetch()} /> : !ctx.data ? <Loading /> : (
              <div className="space-y-3 text-sm">
                <p>{ctx.data.shift_start && ctx.data.shift_end ? `${ctx.data.shift_start.slice(0, 5)} – ${ctx.data.shift_end.slice(0, 5)}` : "No fixed shift time"}
                  {ctx.data.shift_days?.length ? ` · ${ctx.data.shift_days.map((d) => DAYS[d] ?? "").join(", ")}` : ""}</p>
                {ctx.data.attendance.length === 0 ? <p className="text-muted-foreground">No attendance recorded yet.</p> : (
                  <ul className="divide-y rounded-lg border">{ctx.data.attendance.map((a) => (
                    <li key={a.day} className="flex justify-between p-2"><span>{a.day}</span><Badge variant="outline" className="capitalize">{a.status.replace(/_/g, " ")}</Badge></li>
                  ))}</ul>
                )}
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorkTab() {
  const fn = useServerFn(listStaffTickets);
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["staff-tickets", done], queryFn: () => fn({ data: { includeDone: done } }), retry: false, placeholderData: (p) => p });
  return (
    <SectionCard title="Assigned requests" description="Only requests the committee assigned to you." icon={ClipboardList}
      action={<Button size="sm" variant="outline" className="min-h-11" onClick={() => setDone(!done)}>{done ? "Hide finished" : "Show finished"}</Button>}>
      {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : q.data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assigned work" description="New requests assigned to you will appear here." />
      ) : (
        <ul className="space-y-3">{q.data.map((t) => <TicketItem key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />)}</ul>
      )}
    </SectionCard>
  );
}

function TicketItem({ t, open, onToggle }: { t: StaffTicket; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const upd = useServerFn(updateStaffTicket);
  const tl = useServerFn(getStaffTimeline);
  const [note, setNote] = useState("");
  const timeline = useQuery({ queryKey: ["staff-timeline", t.id], enabled: open, queryFn: () => tl({ data: { ticketId: t.id } }), retry: false });
  const m = useMutation({ ...mutOpts,
    mutationFn: (status: "in_progress" | "on_hold" | "resolved" | null) => upd({ data: { ticketId: t.id, status, note: note.trim() || undefined } }),
    onSuccess: () => { toast.success("Updated"); setNote(""); qc.invalidateQueries({ queryKey: ["staff-tickets"] }); qc.invalidateQueries({ queryKey: ["staff-timeline", t.id] }); },
    onError: (e) => toast.error(errText(e)) });
  const finished = ["resolved", "closed", "rejected", "cancelled"].includes(t.status);
  const overdue = !finished && t.sla_due_at && new Date(t.sla_due_at) < new Date();
  return (
    <li className="rounded-lg border p-3">
      <button type="button" className="flex min-h-11 w-full flex-wrap items-start justify-between gap-2 text-left" aria-expanded={open} onClick={onToggle}>
        <div className="min-w-0">
          <p className="font-medium">#{t.ticket_no} {t.subject}</p>
          <p className="text-sm text-muted-foreground">{[t.flat_label && `Home ${t.flat_label}`, t.asset_name, t.asset_location].filter(Boolean).join(" · ") || t.category.replace(/_/g, " ")}</p>
        </div>
        <div className="flex gap-1">
          {overdue && <Badge variant="destructive">Overdue</Badge>}
          <Badge variant={finished ? "outline" : "secondary"}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
        </div>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t pt-3 text-sm">
          {t.description && <p className="whitespace-pre-wrap">{t.description}</p>}
          {t.hold_reason && <p className="text-muted-foreground">On hold: {t.hold_reason}</p>}
          {timeline.error ? <ErrorRow error={timeline.error} onRetry={() => timeline.refetch()} /> : !timeline.data ? <Loading /> : (
            <ol className="space-y-1">{timeline.data.map((e, i) => (
              <li key={i} className="text-muted-foreground"><span className="font-medium text-foreground capitalize">{e.actor_kind}</span> · {e.to_status ? `${STATUS_LABEL[e.from_status ?? ""] ?? e.from_status ?? ""} → ${STATUS_LABEL[e.to_status] ?? e.to_status}` : e.kind}{e.body ? ` — ${e.body}` : ""} <span className="text-xs">({new Date(e.created_at).toLocaleString("en-IN")})</span></li>
            ))}</ol>
          )}
          <TicketEvidence ticketId={t.id} canUpload={!finished} />
          {!finished && (
            <div className="space-y-2">
              <Label htmlFor={`n-${t.id}`}>Note (needed to pause or finish)</Label>
              <Textarea id={`n-${t.id}`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                {t.status !== "in_progress" && <Button size="sm" className="min-h-11" disabled={m.isPending} onClick={() => m.mutate("in_progress")}>Start work</Button>}
                {t.status !== "on_hold" && <Button size="sm" variant="outline" className="min-h-11" disabled={m.isPending || note.trim().length < 3} onClick={() => m.mutate("on_hold")}>Put on hold</Button>}
                <Button size="sm" variant="outline" className="min-h-11" disabled={m.isPending || note.trim().length < 3} onClick={() => m.mutate("resolved")}>Mark done</Button>
                <Button size="sm" variant="ghost" className="min-h-11" disabled={m.isPending || !note.trim()} onClick={() => m.mutate(null)}>Add note</Button>
              </div>
              <p className="text-xs text-muted-foreground">Marking done tells the resident; the committee closes the request. No charges are created.</p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function AssetsTab() {
  const qc = useQueryClient();
  const fn = useServerFn(listStaffAssets);
  const logFn = useServerFn(logStaffAssetService);
  const q = useQuery({ queryKey: ["staff-assets"], queryFn: () => fn(), retry: false });
  const [sel, setSel] = useState<string | null>(null);
  const [kind, setKind] = useState<"repair" | "service" | "inspection">("service");
  const [notes, setNotes] = useState("");
  const m = useMutation({ ...mutOpts, mutationFn: () => logFn({ data: { assetId: sel!, kind, notes } }),
    onSuccess: () => { toast.success("Work logged"); setSel(null); setNotes(""); qc.invalidateQueries({ queryKey: ["staff-assets"] }); }, onError: (e) => toast.error(errText(e)) });
  return (
    <SectionCard title="Assets" description="Log service or repairs you did. Costs are recorded by the committee." icon={Wrench}>
      {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : q.data.length === 0 ? <EmptyState icon={Wrench} title="No assets recorded" /> : (
        <ul className="divide-y rounded-lg border">{q.data.map((a) => (
          <li key={a.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-medium">{a.name}</p><p className="text-muted-foreground">{[a.category, a.location, a.last_service && `Last service ${a.last_service}`].filter(Boolean).join(" · ")}</p></div>
              <Button size="sm" variant="outline" className="min-h-11" onClick={() => setSel(sel === a.id ? null : a.id)}>Log work</Button>
            </div>
            {sel === a.id && (
              <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
                <div><Label htmlFor="ak">Type</Label><select id="ak" className="h-11 w-full rounded-md border border-input bg-background px-3" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="service">Service</option><option value="repair">Repair</option><option value="inspection">Inspection</option></select></div>
                <div className="sm:col-span-2"><Label htmlFor="an">What was done</Label><Input id="an" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></div>
                <Button type="submit" className="min-h-11 sm:w-fit" disabled={m.isPending || notes.trim().length < 3}>Save</Button>
              </form>
            )}
          </li>
        ))}</ul>
      )}
    </SectionCard>
  );
}

function InventoryTab() {
  const qc = useQueryClient();
  const fn = useServerFn(listStaffInventory);
  const useFn = useServerFn(consumeStaffInventory);
  const q = useQuery({ queryKey: ["staff-inventory"], queryFn: () => fn(), retry: false });
  const [sel, setSel] = useState<string | null>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const m = useMutation({ ...mutOpts, mutationFn: () => useFn({ data: { itemId: sel!, qty: Number(qty), reason } }),
    onSuccess: () => { toast.success("Stock updated"); setSel(null); setQty(""); setReason(""); qc.invalidateQueries({ queryKey: ["staff-inventory"] }); }, onError: (e) => toast.error(errText(e)) });
  return (
    <SectionCard title="Inventory" description="Record stock you took for work. Restocking is done by the committee." icon={Boxes}>
      {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : q.data.length === 0 ? <EmptyState icon={Boxes} title="No inventory items" /> : (
        <ul className="divide-y rounded-lg border">{q.data.map((i) => (
          <li key={i.id} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-medium">{i.name}</p><p className="text-muted-foreground">{i.quantity} {i.unit ?? ""}{i.location ? ` · ${i.location}` : ""}</p></div>
              <div className="flex items-center gap-2">
                {i.reorder_level !== null && i.quantity <= i.reorder_level && <Badge variant="destructive">Low</Badge>}
                <Button size="sm" variant="outline" className="min-h-11" disabled={i.quantity <= 0} onClick={() => setSel(sel === i.id ? null : i.id)}>Use stock</Button>
              </div>
            </div>
            {sel === i.id && (
              <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
                <div><Label htmlFor="iq">Quantity</Label><Input id="iq" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
                <div className="sm:col-span-2"><Label htmlFor="ir">Used for</Label><Input id="ir" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></div>
                <Button type="submit" className="min-h-11 sm:w-fit" disabled={m.isPending || !(Number(qty) > 0) || reason.trim().length < 3}>Save</Button>
              </form>
            )}
          </li>
        ))}</ul>
      )}
    </SectionCard>
  );
}

function VendorsTab() {
  const fn = useServerFn(listStaffVendors);
  const q = useQuery({ queryKey: ["staff-vendors"], queryFn: () => fn(), retry: false });
  return (
    <SectionCard title="Vendors" description="Service contacts only. Contract values and bank details stay with the committee." icon={Phone}>
      {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : q.data.length === 0 ? <EmptyState icon={Phone} title="No vendors" /> : (
        <ul className="divide-y rounded-lg border">{q.data.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><p className="font-medium">{v.name}</p><p className="text-muted-foreground">{[v.category, v.contract_end && `Contract till ${v.contract_end}`].filter(Boolean).join(" · ")}</p></div>
            {v.phone && <a className="inline-flex min-h-11 items-center rounded-md border px-3" href={`tel:${v.phone}`}>Call</a>}
          </li>
        ))}</ul>
      )}
    </SectionCard>
  );
}

function DocsTab() {
  const fn = useServerFn(listStaffDocuments);
  const openFn = useServerFn(openStaffDocument);
  const q = useQuery({ queryKey: ["staff-docs"], queryFn: () => fn(), retry: false });
  const m = useMutation({ ...mutOpts, mutationFn: (id: string) => openFn({ data: { id } }), onSuccess: (r) => window.open(r.url, "_blank", "noopener"), onError: (e) => toast.error(errText(e)) });
  return (
    <SectionCard title="Documents" description="Documents the committee has shared with all residents." icon={FileText}>
      {q.error ? <ErrorRow error={q.error} onRetry={() => q.refetch()} /> : !q.data ? <Loading /> : q.data.length === 0 ? <EmptyState icon={FileText} title="No shared documents" /> : (
        <ul className="divide-y rounded-lg border">{q.data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><p className="font-medium">{d.title}</p><p className="capitalize text-muted-foreground">{d.category ?? "Document"}</p></div>
            <Button size="sm" variant="outline" className="min-h-11" disabled={m.isPending} onClick={() => m.mutate(d.id)}>Open</Button>
          </li>
        ))}</ul>
      )}
    </SectionCard>
  );
}
