import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { useSocietyId } from "@/hooks/useSocietyId";
import { generateCommunityDigest } from "@/lib/digest.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/digest")({
  head: () => ({ meta: [{ title: "AI Community Digest — SocioHub" }] }),
  component: DigestPage,
});

function DigestPage() {
  const { societyId } = useSocietyId();
  const generate = useServerFn(generateCommunityDigest);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    if (!societyId) return;
    setLoading(true); setResult(null);
    try {
      const res = await generate({ data: { societyId } });
      setResult(res.summary);
      toast.success("Digest published to residents");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="AI Community Digest"
        description="Generate a weekly summary of resident discussions and publish it to the community feed."
      />

      <Card className="rounded-2xl mb-6">
        <CardContent className="p-6 flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary grid place-items-center">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Generate this week's digest</p>
            <p className="text-sm text-muted-foreground">
              Summarises the past 7 days of posts and comments. Published as the active digest at the top of every resident's feed.
            </p>
          </div>
          <Button onClick={run} disabled={loading || !societyId} className="rounded-xl">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Generate
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Preview</p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{result}</p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
