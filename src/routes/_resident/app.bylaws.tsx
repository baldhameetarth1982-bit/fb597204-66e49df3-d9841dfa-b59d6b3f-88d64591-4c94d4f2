import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_resident/app/bylaws")({
  head: () => ({ meta: [{ title: "By-Laws — SocioHub" }] }),
  component: BylawsScreen,
});

function BylawsScreen() {
  const { societyId } = useSocietyId();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const { data } = await supabase.from("society_settings").select("bylaws_html").eq("society_id", societyId).maybeSingle();
      setText(data?.bylaws_html ?? "");
      setLoading(false);
    })();
  }, [societyId]);

  return (
    <div className="px-5 py-6 space-y-6 pb-24">
      <header className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Society By-Laws</h1>
          <p className="text-sm text-muted-foreground">House rules & policies.</p>
        </div>
      </header>
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
            text ? <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{text}</pre> :
              <p className="text-sm text-muted-foreground">The admin hasn't published any by-laws yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
