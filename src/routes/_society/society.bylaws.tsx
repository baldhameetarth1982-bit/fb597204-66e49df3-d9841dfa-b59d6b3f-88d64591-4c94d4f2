import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Textarea } from "@/components/ui/textarea";
import { SaveBar } from "@/components/settings/SettingsUI";
import { ErrorState } from "@/components/system/ErrorState";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/bylaws")({
  head: () => ({ meta: [{ title: "Society By-Laws — SociyoHub" }] }),
  component: BylawsAdmin,
});

const TIPS = ["Parking", "Noise hours", "Pets", "Visitors", "Move-in / move-out", "Common areas"];

function BylawsAdmin() {
  const { societyId } = useSocietyId();
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!societyId) return;
    setLoading(true);
    setFailed(false);
    const { data, error } = await supabase.from("society_settings").select("bylaws_html").eq("society_id", societyId).maybeSingle();
    if (error) setFailed(true);
    const v = data?.bylaws_html ?? "";
    setSaved(v);
    setText(v);
    setLoading(false);
  }
  useEffect(() => { void load(); }, [societyId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!societyId) return;
    setSaving(true);
    const { error } = await supabase.from("society_settings").upsert({ society_id: societyId, bylaws_html: text }, { onConflict: "society_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    setSaved(text);
    toast.success("By-laws saved");
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <PageShell>
      <PageHeader title="Society By-Laws" description="The rules and house policies every resident can read." />
      {loading ? (
        <div className="h-96 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
      ) : failed ? (
        <ErrorState onRetry={load} showSupport={false} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-border bg-card focus-within:ring-2 focus-within:ring-ring">
              <label htmlFor="bylaws" className="sr-only">By-laws text</label>
              <Textarea
                id="bylaws"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={22}
                className="min-h-[50vh] resize-y rounded-none border-0 p-4 leading-relaxed shadow-none focus-visible:ring-0"
                placeholder="Start with a heading per topic, e.g. 'Parking', then the rules under it."
              />
              <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground tabular-nums">{words} words</div>
            </div>
            <SaveBar dirty={text !== saved} saving={saving} onSave={save} onDiscard={() => setText(saved)} saveLabel="Save by-laws" />
          </div>
          <aside className="h-fit rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <p className="font-medium">Suggested sections</p>
            <ul className="mt-2 flex flex-wrap gap-1.5 lg:flex-col lg:gap-1">
              {TIPS.map((t) => <li key={t} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs lg:border-0 lg:bg-transparent lg:px-0">{t}</li>)}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Residents see the saved version. Keep each rule short and specific.</p>
          </aside>
        </div>
      )}
    </PageShell>
  );
}
