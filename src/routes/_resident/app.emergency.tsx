import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone, ShieldAlert, ArrowLeft, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  loadEmergencyContacts,
  saveEmergencyContacts,
  DEFAULT_EMERGENCY_CONTACTS,
  type EmergencyContact,
} from "@/lib/emergency-contacts";
import { isOnline } from "@/lib/offline-cache";

export const Route = createFileRoute("/_resident/app/emergency")({
  head: () => ({ meta: [{ title: "Emergency Contacts — SocioHub" }] }),
  component: EmergencyPage,
});

function EmergencyPage() {
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setContacts(loadEmergencyContacts());
    saveEmergencyContacts(DEFAULT_EMERGENCY_CONTACTS);
    setOnline(isOnline());
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="rounded-xl">
          <Link to="/app/dashboard"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Emergency</h1>
          <p className="text-sm text-muted-foreground">Works offline — saved on your device</p>
        </div>
      </header>

      {!online && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10">
          <CardContent className="p-3 flex items-center gap-2 text-xs">
            <WifiOff className="h-4 w-4 text-warning" /> You're offline. Showing cached contacts.
          </CardContent>
        </Card>
      )}

      <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-destructive to-destructive/85 text-destructive-foreground">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 mb-1 opacity-90">
            <ShieldAlert className="h-4 w-4" />
            <p className="text-xs uppercase tracking-wider">In an emergency</p>
          </div>
          <p className="text-3xl font-semibold">Dial 112</p>
          <Button
            asChild
            className="mt-4 w-full h-12 rounded-xl bg-background text-destructive hover:bg-background/90 font-semibold"
          >
            <a href="tel:112"><Phone className="h-4 w-4 mr-2" /> Call now</a>
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          All numbers
        </h2>
        {contacts.map((c) => (
          <Card key={c.label} className="rounded-2xl">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl grid place-items-center bg-destructive/10 text-destructive">
                <Phone className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">
                  {c.category === "national" ? "National" : "Society"}
                </p>
              </div>
              <Badge variant="secondary" className="rounded-full font-mono">{c.number}</Badge>
              <Button asChild size="sm" className="rounded-xl">
                <a href={`tel:${c.number}`}><Phone className="h-3.5 w-3.5" /></a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
