import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search, Phone, MessageCircle, Globe, ChevronLeft, Store, ImageOff, WifiOff,
  Zap, Droplets, Hammer, Snowflake, Refrigerator, Sparkles, Bug, Paintbrush, GlassWater, Wifi, Truck, GraduationCap, Wrench, Calendar,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { listDiscovery, type DiscoveryItem } from "@/lib/discovery.functions";
import { safeHttpsUrl, telHref, whatsappHref } from "@/lib/discovery";
import { cn } from "@/lib/utils";

const ICONS: Record<string, typeof Wrench> = {
  zap: Zap, droplets: Droplets, hammer: Hammer, snowflake: Snowflake, refrigerator: Refrigerator, sparkles: Sparkles,
  bug: Bug, paintbrush: Paintbrush, "glass-water": GlassWater, wifi: Wifi, truck: Truck, "graduation-cap": GraduationCap,
  wrench: Wrench, calendar: Calendar,
};

/** Local services & campaigns. Kept apart from official society communication. */
export function ServiceDirectory() {
  const { user } = useAuth();
  const fetchItems = useServerFn(listDiscovery);
  const q = useQuery({
    enabled: !!user,
    queryKey: ["discovery", "directory", user?.id],
    staleTime: 5 * 60_000,
    queryFn: () => fetchItems({ data: {} }),
  });
  const [cat, setCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<DiscoveryItem | null>(null);

  const items = useMemo(() => (q.data?.items ?? []).filter((i) => i.kind !== "banner"), [q.data]);
  const categories = useMemo(() => {
    const used = new Set(items.map((i) => i.category_id));
    return (q.data?.categories ?? []).filter((c) => used.has(c.id));
  }, [q.data, items]);
  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((i) => (!cat || i.category_id === cat) &&
      (!s || `${i.title} ${i.business_name ?? ""} ${i.description ?? ""}`.toLowerCase().includes(s)));
  }, [items, cat, search]);
  const catLabel = (id: string | null) => q.data?.categories.find((c) => c.id === id)?.label ?? null;
  const campaigns = !cat && !search ? shown.filter((i) => i.kind === "campaign") : [];
  const listings = !cat && !search ? shown.filter((i) => i.kind !== "campaign") : shown;

  return (
    <section aria-labelledby="local-services" className="space-y-3">
      <div className="flex items-end justify-between px-1">
        <div>
          <h2 id="local-services" className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Local services</h2>
          <p className="text-xs text-muted-foreground">Listed by SociyoHub. Not endorsed by your society committee.</p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid grid-cols-3 gap-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
        </div>
      ) : q.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground"><WifiOff className="h-4 w-4" /> Couldn't load local services.</span>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => void q.refetch()}>Retry</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center">
          <Store className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No local services near you yet</p>
          <p className="text-xs text-muted-foreground">New listings for your area will show here.</p>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search local services" className="h-11 rounded-xl pl-9" placeholder="Search electrician, cleaning…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {cat ? (
            <button type="button" onClick={() => setCat(null)} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary">
              <ChevronLeft className="h-4 w-4" /> All categories · {catLabel(cat)}
            </button>
          ) : categories.length > 0 && !search && (
            <div className="grid grid-cols-3 gap-3">
              {categories.map((c) => {
                const Icon = ICONS[c.icon] ?? Wrench;
                return (
                  <button key={c.id} type="button" onClick={() => setCat(c.id)}
                    className="min-h-20 rounded-2xl bg-secondary/60 hover:bg-secondary p-3 flex flex-col items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="h-9 w-9 rounded-xl bg-background grid place-items-center text-primary"><Icon className="h-5 w-5" /></span>
                    <span className="text-xs font-medium text-center leading-tight">{c.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {campaigns.length > 0 && (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {campaigns.map((i) => <Card key={i.id} item={i} wide onOpen={() => setOpen(i)} cat={catLabel(i.category_id)} />)}
            </div>
          )}

          {(cat || search) && shown.length === 0 ? (
            <p className="rounded-2xl border bg-card p-4 text-center text-sm text-muted-foreground">{search ? "No matches. Try another word." : "Nothing listed in this category yet."}</p>
          ) : (cat || search) && (
            <ul className="space-y-3">{listings.map((i) => <li key={i.id}><Card item={i} onOpen={() => setOpen(i)} cat={catLabel(i.category_id)} /></li>)}</ul>
          )}
        </>
      )}

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-3xl">
          {open && <Details item={open} cat={catLabel(open.category_id)} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function Thumb({ item, className }: { item: DiscoveryItem; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!item.image_url || broken) {
    return <div className={cn("grid place-items-center bg-muted text-muted-foreground", className)}>{item.image_url ? <ImageOff className="h-5 w-5" /> : <Store className="h-5 w-5" />}</div>;
  }
  return <img src={item.image_url} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("object-cover", className)} />;
}

function Card({ item, onOpen, cat, wide }: { item: DiscoveryItem; onOpen: () => void; cat: string | null; wide?: boolean }) {
  return (
    <button type="button" onClick={onOpen}
      className={cn("flex w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", wide && "w-72 shrink-0")}>
      <Thumb item={item} className="h-16 w-16 shrink-0 rounded-xl" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {item.sponsored && <span className="rounded-full bg-warning/15 px-1.5 py-0.5 font-medium text-warning-foreground">Sponsored</span>}
          {cat && <span className="truncate">{cat}</span>}
        </span>
        <span className="block truncate font-semibold">{item.title}</span>
        {item.business_name && <span className="block truncate text-xs text-muted-foreground">{item.business_name}</span>}
      </span>
    </button>
  );
}

function Details({ item, cat }: { item: DiscoveryItem; cat: string | null }) {
  const tel = telHref(item.phone);
  const wa = whatsappHref(item.whatsapp);
  const link = safeHttpsUrl(item.link_url);
  return (
    <div className="space-y-4 pb-4">
      <Thumb item={item} className="aspect-[16/7] w-full rounded-2xl" />
      <SheetHeader className="text-left">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {item.sponsored && <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning-foreground">Sponsored</span>}
          {cat && <span>{cat}</span>}
        </div>
        <SheetTitle>{item.title}</SheetTitle>
        {item.business_name && <SheetDescription>{item.business_name}</SheetDescription>}
      </SheetHeader>
      {item.description && <p className="whitespace-pre-line text-sm">{item.description}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        {tel && <Button asChild className="min-h-11 rounded-xl"><a href={tel}><Phone className="mr-2 h-4 w-4" />Call</a></Button>}
        {wa && <Button asChild variant="outline" className="min-h-11 rounded-xl"><a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></Button>}
        {link && <Button asChild variant="outline" className="min-h-11 rounded-xl"><a href={link} target="_blank" rel="noopener noreferrer sponsored"><Globe className="mr-2 h-4 w-4" />{item.cta_label ?? "Website"}</a></Button>}
      </div>
      {!tel && !wa && !link && <p className="text-sm text-muted-foreground">Contact details aren't available for this listing right now.</p>}
      <p className="text-xs text-muted-foreground">SociyoHub and your society don't handle bookings or payments for this service.</p>
    </div>
  );
}
