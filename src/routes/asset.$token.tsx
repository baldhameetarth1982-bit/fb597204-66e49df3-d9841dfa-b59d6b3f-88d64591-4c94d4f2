import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/asset/$token")({
  head: () => ({
    meta: [
      { title: "Report a problem — SociyoHub" },
      { name: "description", content: "Scan a society asset QR to report a problem through your society Helpdesk." },
      { property: "og:title", content: "Report a problem — SociyoHub" },
      { property: "og:description", content: "Scan a society asset QR to report a problem through your society Helpdesk." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AssetQr,
});

// Public: shows only name/category/location. Reporting requires sign-in via Helpdesk.
function AssetQr() {
  const { token } = Route.useParams();
  const q = useQuery({
    queryKey: ["asset-qr", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("asset_qr_lookup", { _token: token });
      if (error) throw error;
      return (data as { name: string; category: string; location: string | null; status: string }[] | null)?.[0] ?? null;
    },
  });
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <Wrench className="h-10 w-10 text-primary" aria-hidden />
      {q.isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : q.isError ? <p className="text-destructive">Couldn't check this code. Try again.</p> : !q.data ? (
        <p className="text-muted-foreground">This code isn't active.</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{q.data.name}</h1>
          <p className="text-sm text-muted-foreground">{q.data.location ?? "Society asset"}{q.data.status === "under_repair" ? " · already under repair" : ""}</p>
          <p className="text-sm">Noticed a problem? Report it to your society office.</p>
          <Button asChild className="min-h-12 rounded-xl"><Link to="/app/helpdesk">Report in Helpdesk</Link></Button>
        </>
      )}
    </main>
  );
}
