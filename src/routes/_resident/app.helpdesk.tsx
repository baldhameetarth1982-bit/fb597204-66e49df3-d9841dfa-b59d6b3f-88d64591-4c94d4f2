import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  LifeBuoy, Plus, Loader2, AlertCircle, Sparkles, Wrench, PackageSearch,
  CheckCircle2, Clock, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";

type Category = "complaint" | "daily_help" | "maintenance" | "lost_found";

const searchSchema = z.object({
  cat: z.enum(["complaint", "daily_help", "maintenance", "lost_found", "all"]).optional(),
  new: z.coerce.boolean().optional(),
});

export const Route = createFileRoute("/_resident/app/helpdesk")({
  head: () => ({ meta: [{ title: "Helpdesk — SocioHub" }] }),
  validateSearch: searchSchema,
  component: HelpdeskPage,
});

const CATS: Record<Category, { label: string; icon: typeof AlertCircle; accent: string }> = {
  complaint:   { label: "Complaint",   icon: AlertCircle,   accent: "bg-destructive/10 text-destructive" },
  daily_help:  { label: "Daily Help",  icon: Sparkles,      accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  maintenance: { label: "Maintenance", icon: Wrench,        accent: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  lost_found:  { label: "Lost & Found",icon: PackageSearch, accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
};

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "closed" | string;
  priority: "low" | "normal" | "high" | "urgent" | string;
  category: Category;
  created_at: string;
}

function HelpdeskPage() {
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_resident/app/helpdesk" });

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const initialCat: Category =
    search.cat && search.cat !== "all" ? (search.cat as Category) : "complaint";

  const [form, setForm] = useState({
    category: initialCat,
    subject: "",
    description: "",
    priority: "normal" as Ticket["priority"],
  });

  // open "new" sheet if URL says so
  useEffect(() => {
    if (search.new) {
      setForm((f) => ({ ...f, category: initialCat }));
      setOpen(true);
      navigate({ to: "/app/helpdesk", search: { cat: search.cat }, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("support_tickets")
      .select("id, subject, description, status, priority, category, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) return toast.error(error.message);
    setTickets((data ?? []) as Ticket[]);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [user]);

  const filter: Category | "all" = (search.cat as any) || "all";
  const filtered = useMemo(
    () => (filter === "all" ? tickets : tickets.filter((t) => t.category === filter)),
    [tickets, filter],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const subject = form.subject.trim();
    const description = form.description.trim();
    if (subject.length < 3) return toast.error("Subject is too short");
    if (description.length < 5) return toast.error("Please describe the issue");
    setSubmitting(true);
    const { error } = await supabase.from("support_tickets").insert({
      user_id: user.id,
      society_id: societyId,
      category: form.category,
      subject: subject.slice(0, 120),
      description: description.slice(0, 2000),
      priority: form.priority,
      status: "open",
    });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    toast.success("Ticket raised — society admin notified");
    setOpen(false);
    setForm({ category: form.category, subject: "", description: "", priority: "normal" });
    void load();
  }

  function openNew(cat: Category) {
    setForm({ category: cat, subject: "", description: "", priority: "normal" });
    setOpen(true);
  }

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <LifeBuoy className="h-6 w-6 text-primary" /> Helpdesk
          </h1>
          <p className="text-sm text-muted-foreground">
            Raise a request and track its resolution.
          </p>
        </div>
        <Button onClick={() => openNew(initialCat)} className="rounded-xl h-10 shrink-0">
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </header>

      {/* Quick category tiles */}
      <section className="grid grid-cols-2 gap-3">
        {(Object.keys(CATS) as Category[]).map((c) => {
          const meta = CATS[c];
          const Icon = meta.icon;
          return (
            <button
              key={c}
              type="button"
              onClick={() => openNew(c)}
              className="rounded-2xl bg-secondary/60 hover:bg-secondary p-4 flex items-center gap-3 active:scale-[0.98] transition-transform text-left"
            >
              <span className={`h-10 w-10 rounded-xl grid place-items-center ${meta.accent}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold">{meta.label}</span>
            </button>
          );
        })}
      </section>

      {/* Filter pills */}
      <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1">
        <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
          <Filter className="h-3 w-3" /> Filter:
        </span>
        {(["all", "complaint", "daily_help", "maintenance", "lost_found"] as const).map((c) => {
          const active = filter === c;
          const label = c === "all" ? "All" : CATS[c as Category].label;
          return (
            <button
              key={c}
              type="button"
              onClick={() => navigate({ to: "/app/helpdesk", search: { cat: c } })}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tickets */}
      {loading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-8 text-center space-y-2">
            <LifeBuoy className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm font-medium">No tickets yet</p>
            <p className="text-xs text-muted-foreground">
              Tap a tile above to raise your first request.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {filtered.map((t) => {
            const meta = CATS[t.category] ?? CATS.complaint;
            const Icon = meta.icon;
            const resolved = t.status === "resolved" || t.status === "closed";
            return (
              <li key={t.id}>
                <Card className="rounded-2xl">
                  <CardContent className="p-4 flex gap-3">
                    <span className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${meta.accent}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold truncate">{t.subject}</p>
                        <Badge variant={resolved ? "secondary" : "outline"} className="rounded-md text-[10px]">
                          {resolved ? (
                            <><CheckCircle2 className="h-3 w-3 mr-1" />{t.status}</>
                          ) : (
                            <><Clock className="h-3 w-3 mr-1" />{t.status.replace("_", " ")}</>
                          )}
                        </Badge>
                        {t.priority === "high" || t.priority === "urgent" ? (
                          <Badge variant="destructive" className="rounded-md text-[10px]">{t.priority}</Badge>
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {t.description}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {meta.label} · {new Date(t.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a request</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v as Category })}
              >
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATS) as Category[]).map((c) => (
                    <SelectItem key={c} value={c}>{CATS[c].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Subject</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Short title (e.g. Lift not working on B-wing)"
                maxLength={120}
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Add details so the admin can act faster…"
                rows={4}
                maxLength={2000}
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select
                value={form.priority}
                onValueChange={(v) => setForm({ ...form, priority: v })}
              >
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="rounded-xl">
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="rounded-xl">
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit ticket
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
