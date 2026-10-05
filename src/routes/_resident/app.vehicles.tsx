import { useTranslation } from "react-i18next";
import { localeTag } from "@/lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Car, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_resident/app/vehicles")({
  head: () => ({ meta: [{ title: "My Vehicles — SociyoHub" }, { name: "description", content: "Add your vehicles so guards can verify you at the gate." }] }),
  component: VehiclesPage,
});

interface Vehicle {
  id: string;
  plate_number: string;
  make_model: string | null;
  color: string | null;
  type: string;
}

function VehiclesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const [list, setList] = useState<Vehicle[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ plate_number: "", make_model: "", color: "", type: "car" });
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("vehicles")
      .select("id, plate_number, make_model, color, type")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setList((data as Vehicle[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [user]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !societyId) {
      toast.error(t("vh.joinFirst"));
      return;
    }
    if (!form.plate_number.trim()) return toast.error(t("vh.plateReq"));
    setSubmitting(true);
    const { error } = await supabase.from("vehicles").insert({
      user_id: user.id,
      society_id: societyId,
      plate_number: form.plate_number.trim().toUpperCase(),
      make_model: form.make_model.trim() || null,
      color: form.color.trim() || null,
      type: form.type,
    });
    setSubmitting(false);
    if (error) return toast.error(userMessage(error));
    toast.success(t("vh.added"));
    setForm({ plate_number: "", make_model: "", color: "", type: "car" });
    setOpen(false);
    void load();
  }

  async function remove(id: string) {
    if (!user) return;
    const { error } = await supabase.from("vehicles").delete().eq("id", id).eq("user_id", user.id);
    if (error) return toast.error(t("vh.removeFailed"));
    toast.success(t("vh.removed"));
    void load();
  }

  return (
    <div className="px-5 py-6 space-y-4 pb-24">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("nav.vehicles")}</h1>
          <p className="text-sm text-muted-foreground">{t("vh.subtitle")}</p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              {t("vh.add")}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="mx-auto max-h-[92dvh] max-w-[480px] overflow-y-auto rounded-t-lg pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <SheetHeader className="text-left">
              <SheetTitle>{t("vh.addTitle")}</SheetTitle>
            </SheetHeader>
            <form onSubmit={add} className="space-y-3">
              <div>
                <Label htmlFor="vehicle-plate">{t("vh.plate")}</Label>
                <Input
                  id="vehicle-plate"
                  value={form.plate_number}
                  onChange={(e) => setForm({ ...form, plate_number: e.target.value })}
                  placeholder="MH 12 AB 1234"
                  required
                />
              </div>
              <div>
                <Label htmlFor="vehicle-model">{t("vh.model")}</Label>
                <Input
                  id="vehicle-model"
                  value={form.make_model}
                  onChange={(e) => setForm({ ...form, make_model: e.target.value })}
                  placeholder="Honda City"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="vehicle-color">{t("vh.color")}</Label>
                  <Input
                    id="vehicle-color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    placeholder="White"
                  />
                </div>
                <div>
                  <Label htmlFor="vehicle-type">{t("cm.type")}</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger aria-label={t("cm.type")} id="vehicle-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="car">{t("vh.car")}</SelectItem>
                      <SelectItem value="bike">{t("vh.bike")}</SelectItem>
                      <SelectItem value="other">{t("cm.other")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.save")}
              </Button>
            </form>
          </SheetContent>
        </Sheet>
      </header>
      <MyParking />

      {loading ? (
        <div className="text-center py-10">
          <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {t("vh.none")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((v) => (
            <Card key={v.id} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-primary/10 grid place-items-center text-primary">
                  <Car className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold tracking-wide">{v.plate_number}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[v.make_model, v.color, v.type === "car" ? t("vh.car") : v.type === "bike" ? t("vh.bike") : t("cm.other")].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(v.id)} aria-label={t("vh.removeLabel", { plate: v.plate_number })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function MyParking() {
  const { t } = useTranslation();
  type Row = { id: string; kind: string; ends_at: string | null; starts_at: string; slot: { label: string; slot_type: string; floor: string | null; notes: string | null } | null };
  type Viol = { id: string; violation_type: string; status: string; occurred_at: string; resolution_note: string | null };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [viols, setViols] = useState<Viol[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // RLS limits both reads to the resident's own current home.
    void Promise.all([
      supabase.from("parking_allocations").select("id, kind, starts_at, ends_at, slot:parking_slots(label, slot_type, floor, notes)").eq("status", "active").order("starts_at"),
      supabase.from("parking_violations").select("id, violation_type, status, occurred_at, resolution_note").order("occurred_at", { ascending: false }).limit(10),
    ]).then(([a, v]) => {
      if (a.error) { setFailed(true); setRows([]); return; }
      const now = Date.now();
      setRows(((a.data ?? []) as unknown as Row[]).filter((r) => !r.ends_at || new Date(r.ends_at).getTime() > now));
      setViols((v.data ?? []) as Viol[]);
    });
  }, []);
  if (rows === null) return <div className="h-16 rounded-2xl bg-muted animate-pulse" />;
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">{t("vh.parking")}</p>
        {failed ? (
          <p role="alert" className="text-sm text-muted-foreground">{t("vh.parkingFailed")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("vh.noSlot")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {rows.map((r) => (
              <span key={r.id} className="rounded-xl bg-primary/10 text-primary px-3 py-2 text-sm font-medium">
                {r.slot?.label ?? t("vh.slot")} <span className="capitalize text-xs opacity-80">· {r.slot?.slot_type}</span>
                {r.slot?.floor ? <span className="text-xs opacity-80"> · {t("vh.floor", { floor: r.slot.floor })}</span> : null}
                {r.kind === "temporary" && r.ends_at ? <span className="text-xs opacity-80"> · {t("vh.tempUntil", { date: new Date(r.ends_at).toLocaleString(localeTag(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })}</span> : null}
              </span>
            ))}
          </div>
        )}
        {viols.length > 0 && (
          <div>
            <p className="text-sm font-semibold">{t("vh.notices")}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {viols.map((v) => (
                <li key={v.id} className="text-muted-foreground">
                  <span className="capitalize text-foreground">{v.violation_type.replace(/_/g, " ")}</span> · {v.status} · {new Date(v.occurred_at).toLocaleDateString(localeTag())}
                  {v.resolution_note ? ` · ${v.resolution_note}` : ""}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground mt-1">{t("vh.noticesNote")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
