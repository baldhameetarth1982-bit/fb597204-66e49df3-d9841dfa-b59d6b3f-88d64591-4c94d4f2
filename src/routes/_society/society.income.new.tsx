import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Coins } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  listIncomeCategoriesFn,
  listNonMemberPayersFn,
  createNonMemberIncomeRecordFn,
} from "@/lib/non-member-income.functions";

export const Route = createFileRoute("/_society/society/income/new")({
  head: () => ({
    meta: [
      { title: "Record Income — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="non_member_payments">
      <NewIncomePage />
    </FeatureGate>
  ),
});

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type PayerKind = "non_member" | "anonymous";
type PaymentMethod = "cash" | "bank_transfer" | "other_offline";

function NewIncomePage() {
  const { societyId, loading } = useSocietyId();
  const navigate = useNavigate();
  const listCatsFn = useServerFn(listIncomeCategoriesFn);
  const listPayersFn = useServerFn(listNonMemberPayersFn);
  const createFn = useServerFn(createNonMemberIncomeRecordFn);

  const catsQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "categories", societyId],
    queryFn: async () => listCatsFn({ data: { societyId: societyId! } }),
  });
  const payersQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "payers", societyId],
    queryFn: async () => listPayersFn({ data: { societyId: societyId! } }),
  });

  const activeCats = useMemo(
    () =>
      ((catsQ.data?.items ?? []) as Array<{ id: string; display_name: string; is_active: boolean }>).filter(
        (c) => c.is_active,
      ),
    [catsQ.data],
  );
  const activePayers = useMemo(
    () =>
      ((payersQ.data?.items ?? []) as Array<{ id: string; display_name: string; is_active: boolean }>).filter(
        (p) => p.is_active,
      ),
    [payersQ.data],
  );

  const [categoryId, setCategoryId] = useState<string>("");
  const [payerKind, setPayerKind] = useState<PayerKind>("non_member");
  const [payerId, setPayerId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paymentDate, setPaymentDate] = useState<string>(todayISO());
  const [reference, setReference] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const mut = useMutation({
    mutationFn: async () => {
      const amountNum = Number(amount);
      return createFn({
        data: {
          societyId: societyId!,
          category_id: categoryId,
          payer_kind: payerKind,
          non_member_payer_id: payerKind === "non_member" ? payerId : undefined,
          amount: amountNum,
          payment_method: method,
          payment_date: paymentDate,
          reference_number: reference.trim() || undefined,
          description: description.trim() || undefined,
        },
      });
    },
    onSuccess: (res) => {
      toast.success("Income recorded. Pending verification.");
      navigate({ to: "/society/income/$id", params: { id: res.id } });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "create_failed";
      toast.error(
        msg === "category_inactive"
          ? "Selected category is inactive"
          : msg === "payer_inactive"
            ? "Selected payer is inactive"
            : msg === "category_society_mismatch" || msg === "payer_society_mismatch"
              ? "Invalid selection for this society"
              : "Could not record income",
      );
    },
  });

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= 1e11;
  const canSubmit =
    !!categoryId &&
    amountValid &&
    !!paymentDate &&
    (payerKind === "anonymous" || (payerKind === "non_member" && !!payerId));

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      <Link
        to="/society/income"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Income
      </Link>
      <MobileHero
        icon={Coins}
        title="Record offline income"
        subtitle="Cash or Bank Transfer received from a non-member or anonymous payer."
      />

      <SectionCard
        title="Details"
        description="Records start as pending and must be verified by an admin."
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {activeCats.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No active categories. Create one first.
                  </div>
                ) : (
                  activeCats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {activeCats.length === 0 && (
              <Link
                to="/society/income/categories"
                className="text-xs text-primary underline mt-1 inline-block min-h-[32px]"
              >
                Manage categories
              </Link>
            )}
          </div>

          <div>
            <Label className="text-xs">Payer</Label>
            <Select value={payerKind} onValueChange={(v) => setPayerKind(v as PayerKind)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="non_member">Non-member payer</SelectItem>
                <SelectItem value="anonymous">Anonymous</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {payerKind === "non_member" && (
            <div>
              <Label className="text-xs">Select payer</Label>
              <Select value={payerId} onValueChange={setPayerId}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Select a payer" />
                </SelectTrigger>
                <SelectContent>
                  {activePayers.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No active payers. Add one first.
                    </div>
                  ) : (
                    activePayers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {activePayers.length === 0 && (
                <Link
                  to="/society/income/payers"
                  className="text-xs text-primary underline mt-1 inline-block min-h-[32px]"
                >
                  Manage payers
                </Link>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label htmlFor="amount" className="text-xs">Amount (₹)</Label>
              <Input
                id="amount"
                className="min-h-[44px] tabular-nums"
                type="number"
                inputMode="decimal"
                min={1}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
              {amount && !amountValid && (
                <p className="text-[11px] text-destructive mt-1">Enter a positive amount.</p>
              )}
            </div>
            <div>
              <Label htmlFor="pdate" className="text-xs">Payment date</Label>
              <Input
                id="pdate"
                className="min-h-[44px]"
                type="date"
                value={paymentDate}
                max={todayISO()}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger className="min-h-[44px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="other_offline">Other offline</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Online gateway collection will be introduced in a later release.
            </p>
          </div>

          <div>
            <Label htmlFor="ref" className="text-xs">Reference number (optional)</Label>
            <Input
              id="ref"
              className="min-h-[44px]"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt / UTR / cheque no."
            />
          </div>

          <div>
            <Label htmlFor="desc" className="text-xs">Description (optional)</Label>
            <Textarea
              id="desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="What was this payment for?"
            />
          </div>

          <div className="pt-2">
            <Button
              className="w-full min-h-[48px]"
              onClick={() => mut.mutate()}
              disabled={!canSubmit || mut.isPending}
            >
              {mut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Record income"
              )}
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
