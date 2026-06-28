import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone, Plus, Trash2, ShieldCheck, Wrench, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/contacts")({
  head: () => ({ meta: [{ title: "Society Contacts — SocioHub" }] }),
  component: ContactsPage,
});

type Contact = { id: string; category: "committee" | "service"; role_label: string; name: string; phone: string | null; notes: string | null; sort_order: number };

const COMMITTEE_ROLES = ["Chairman", "Secretary", "Treasurer", "Committee Member"];
const SERVICE_ROLES = ["Plumber", "Electrician", "Lift Contractor", "Security Contractor", "Water Electrician", "Cleaning", "Garbage"];

function ContactsPage() {
  const { societyId } = useSocietyId();
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Contact>>({ category: "committee", role_label: "Chairman" });

  async function load() {
    if (!societyId) return;
    setLoading(true);
    const { data, error } = await supabase.from("society_contacts").select("*").eq("society_id", societyId).order("category").order("sort_order");
    if (error) toast.error(error.message);
    setItems((data ?? []) as Contact[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [societyId]);

  async function save() {
    if (!societyId || !form.name || !form.role_label || !form.category) { toast.error("Name & role required"); return; }
    const { error } = await supabase.from("society_contacts").insert({ society_id: societyId, category: form.category, role_label: form.role_label, name: form.name, phone: form.phone ?? null, notes: form.notes ?? null });
    if (error) return toast.error(error.message);
    toast.success("Added"); setOpen(false); setForm({ category: "committee", role_label: "Chairman" }); load();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("society_contacts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((x) => x.filter((c) => c.id !== id));
  }

  const committee = items.filter((c) => c.category === "committee");
  const services = items.filter((c) => c.category === "service");

  return (
    <PageShell>
      <PageHeader title="Contacts" description="Committee members & service providers — visible to all residents"
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Add</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New contact</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Category</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as any, role_label: v === "committee" ? "Chairman" : "Plumber" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="committee">Committee</SelectItem><SelectItem value="service">Service</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>Role</Label>
                  <Select value={form.role_label} onValueChange={(v) => setForm({ ...form, role_label: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{(form.category === "committee" ? COMMITTEE_ROLES : SERVICE_ROLES).map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Notes</Label><Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <Button className="w-full" onClick={save}>Save</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />
      {loading ? <div className="grid place-items-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> :
        items.length === 0 ? <EmptyState icon={ShieldCheck} title="No contacts yet" description="Add committee members & vendors." /> :
          (<>
            <Section title="Committee" icon={ShieldCheck} list={committee} onDelete={remove} canEdit />
            <Section title="Services" icon={Wrench} list={services} onDelete={remove} canEdit />
          </>)
      }
    </PageShell>
  );
}

function Section({ title, icon: Icon, list, onDelete, canEdit }: { title: string; icon: any; list: Contact[]; onDelete: (id: string) => void; canEdit: boolean }) {
  if (!list.length) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide"><Icon className="h-4 w-4" /> {title}</div>
      <div className="grid sm:grid-cols-2 gap-3">
        {list.map((c) => (
          <Card key={c.id} className="rounded-2xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{c.role_label}</p>
                <p className="font-semibold truncate">{c.name}</p>
                {c.notes && <p className="text-xs text-muted-foreground truncate">{c.notes}</p>}
              </div>
              {c.phone && <a href={`tel:${c.phone}`}><Button size="sm" variant="outline"><Phone className="h-4 w-4 mr-1" />{c.phone}</Button></a>}
              {canEdit && <Button size="icon" variant="ghost" onClick={() => onDelete(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
