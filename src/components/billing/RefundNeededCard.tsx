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
import { tu } from "@/lib/i18n";

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
      toast.success(tu("op.refund_recorded"));
      setOpenId(null); setRef(""); setNote("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: () => toast.error(tu("op.couldn_t_record_the_refund")),
  });

  if (error) return null; // not permitted or unavailable: hide quietly
  if (isLoading || !data || data.length === 0) return null;
  const open = data.filter((r) => !r.refund_resolved_at).length;

  return (
    <Card className="mb-4">
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="font-semibold">{tu("op.online_payments_needing_a_refund")}</h2>
          <p className="text-sm text-muted-foreground">
            {tu("op.these_were_paid_online_after")}
            {open > 0 ? ` ${open} still open.` : tu("op.all_recorded")}
          </p>
        </div>
        <ul className="divide-y">
          {data.map((r) => (
            <li key={r.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <div className="font-medium">{tu("gd.houseLabel")} {r.flat_number} · {inr(Number(r.amount_paise))}</div>
                  <div className="text-muted-foreground">{tu("bills.paid")} {formatDate(r.created_at)}{r.razorpay_payment_id ? ` · ${r.razorpay_payment_id}` : ""}</div>
                </div>
                {r.refund_resolved_at ? (
                  <span className="text-sm text-success">{tu("op.refunded")} {formatDate(r.refund_resolved_at)} · {r.refund_reference}</span>
                ) : (
                  <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    {tu("op.record_refund")}
                  </Button>
                )}
              </div>
              {openId === r.id && !r.refund_resolved_at && (
                <div className="space-y-2 rounded-xl bg-muted p-3">
                  <Label htmlFor={`ref-${r.id}`}>{tu("op.refund_reference")}</Label>
                  <Input id={`ref-${r.id}`} value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} />
                  <Label htmlFor={`note-${r.id}`}>{tu("op.note_at_least_10_characters")}</Label>
                  <Textarea id={`note-${r.id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
                  <Button className="min-h-11" disabled={save.isPending || ref.trim().length < 4 || note.trim().length < 10} onClick={() => save.mutate(r.id)}>
                    {tu("op.save_refund")}
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
