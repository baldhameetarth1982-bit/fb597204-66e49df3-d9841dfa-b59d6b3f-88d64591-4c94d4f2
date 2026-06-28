import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Save, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/bylaws")({
  head: () => ({ meta: [{ title: "Society By-Laws — SocioHub" }] }),
  component: BylawsAdmin,
});

function BylawsAdmin() {
  const { societyId } = useSocietyId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const { data, error } = await supabase.from("society_settings").select("bylaws_html").eq("society_id", societyId).maybeSingle();
      if (error) toast.error(error.message);
      setText(data?.bylaws_html ?? "");
      setLoading(false);
    })();
  }, [societyId]);

  async function save() {
    if (!societyId) return;
    setSaving(true);
    const { error } = await supabase.from("society_settings").upsert({ society_id: societyId, bylaws_html: text }, { onConflict: "society_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("By-laws saved");
  }

  return (
    <PageShell>
      <PageHeader title="Society By-Laws" description="Write the rules and house policies your residents should follow" />
      {loading ? <div className="grid place-items-center h-40"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={20} placeholder="Type your society by-laws here. Use simple sections like 'Parking', 'Noise hours', 'Pets', etc." />
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save</Button>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
