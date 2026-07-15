import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone, ShieldCheck, Wrench, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_resident/app/contacts")({
  head: () => ({ meta: [{ title: "Contacts — SociyoHub" }] }),
  component: ContactsScreen,
});

type Contact = { id: string; category: "committee" | "service"; role_label: string; name: string; phone: string | null; notes: string | null };

function ContactsScreen() {
  const { societyId } = useSocietyId();
  const [items, setItems] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const { data } = await supabase.from("society_contacts").select("*").eq("society_id", societyId).order("category").order("sort_order");
      setItems((data ?? []) as Contact[]);
      setLoading(false);
    })();
  }, [societyId]);

  const committee = items.filter((c) => c.category === "committee");
  const services = items.filter((c) => c.category === "service");

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-sm text-muted-foreground">Committee members & service providers.</p>
      </header>

      {loading ? <div className="grid place-items-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
        <>
          <Group title="Committee" icon={ShieldCheck} list={committee} />
          <Group title="Services" icon={Wrench} list={services} />
          {items.length === 0 && <p className="text-sm text-muted-foreground">No contacts published yet.</p>}
        </>
      )}
    </div>
  );
}

function Group({ title, icon: Icon, list }: { title: string; icon: any; list: Contact[] }) {
  if (!list.length) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide"><Icon className="h-4 w-4" /> {title}</div>
      {list.map((c) => (
        <Card key={c.id} className="rounded-2xl">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">{c.role_label}</p>
              <p className="font-semibold truncate">{c.name}</p>
            </div>
            {c.phone && <a href={`tel:${c.phone}`}><Button size="sm"><Phone className="h-4 w-4 mr-1" />Call</Button></a>}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
