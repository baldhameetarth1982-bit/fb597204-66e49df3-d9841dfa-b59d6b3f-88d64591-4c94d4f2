import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/_resident/app/visitors")({
  head: () => ({ meta: [{ title: "My Visitors — SocioHub" }] }),
  component: MyVisitors,
});

interface VisitorRow {
  id: string;
  visitor_name: string;
  phone: string | null;
  vehicle_number: string | null;
  purpose: string | null;
  entry_at: string;
  exit_at: string | null;
}

function MyVisitors() {
  const { user } = useAuth();
  const [list, setList] = useState<VisitorRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: fr } = await supabase
        .from("flat_residents")
        .select("flat_id")
        .eq("user_id", user.id);
      const flatIds = (fr ?? []).map((r) => r.flat_id as string);
      if (flatIds.length === 0) {
        setList([]);
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("visitors")
        .select("id, visitor_name, phone, vehicle_number, purpose, entry_at, exit_at")
        .in("flat_id", flatIds)
        .order("entry_at", { ascending: false })
        .limit(50);
      setList((data as VisitorRow[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="px-5 py-6 space-y-4 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Visitors</h1>
        <p className="text-sm text-muted-foreground">Everyone who came to your flat</p>
      </header>
      {loading ? (
        <div className="text-center text-muted-foreground py-12"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center text-sm text-muted-foreground">No visitors recorded</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {list.map((v) => (
            <Card key={v.id} className="rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate flex-1">{v.visitor_name}</p>
                  {v.exit_at ? (
                    <Badge variant="secondary" className="rounded-full text-[10px]">Exited</Badge>
                  ) : (
                    <Badge className="rounded-full text-[10px] bg-success text-success-foreground">Inside</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {v.purpose || "Visit"}{v.vehicle_number ? ` · ${v.vehicle_number}` : ""}{v.phone ? ` · ${v.phone}` : ""}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  In: {new Date(v.entry_at).toLocaleString()}
                  {v.exit_at && ` · Out: ${new Date(v.exit_at).toLocaleString()}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
