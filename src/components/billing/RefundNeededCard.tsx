import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/utils/format";

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Online payments that arrived after a bill was already settled; committee records the refund. */
export function RefundNeededCard({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const key = ["refund-needed-orders", societyId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_refund_needed_orders", { _society_id: societyId });
      if (error) throw error;
      return data ?? [];
    },
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    networkMode: "always",
    retry: false,
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("admin_mark_order_refunded", { _order_id: id, _reference: ref.trim(), _note: note.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Refund recorded");
      setOpenId(null); setRef(""); setNote("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: () => toast.error("Couldn't record the refund. Check the details and try again."),
  });

  if (error) return null; // not permitted or unavailable: hide quietly
  if (isLoading || !data || data.length === 0) return null;
  const open = data.filter((r) => !r.refund_resolved_at).length;

  return (
    <Card className="mb-4">
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Online payments needing a refund</h2>
          <p className="text-sm text-muted-foreground">
            These were paid online after the bill was already settled. Refund the resident from your payment account, then record it here.
            {open > 0 ? ` ${open} still open.` : " All recorded."}
          </p>
        </div>
        <ul className="divide-y">
          {data.map((r) => (
            <li key={r.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">House {r.flat_number} · {inr(Number(r.amount_paise))}</div>
                  <div className="text-muted-foreground">Paid {formatDate(r.created_at)}{r.razorpay_payment_id ? ` · ${r.razorpay_payment_id}` : ""}</div>
                </div>
                {r.refund_resolved_at ? (
                  <span className="text-sm text-success">Refunded {formatDate(r.refund_resolved_at)} · {r.refund_reference}</span>
                ) : (
                  <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    Record refund
                  </Button>
                )}
              </div>
              {openId === r.id && !r.refund_resolved_at && (
                <div className="space-y-2 rounded-xl bg-muted p-3">
                  <Label htmlFor={`ref-${r.id}`}>Refund reference</Label>
                  <Input id={`ref-${r.id}`} value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} />
                  <Label htmlFor={`note-${r.id}`}>Note (at least 10 characters)</Label>
                  <Textarea id={`note-${r.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                  <Button className="min-h-11" disabled={save.isPending || ref.trim().length < 4 || note.trim().length < 10} onClick={() => save.mutate(r.id)}>
                    Save refund
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
