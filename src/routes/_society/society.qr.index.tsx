import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QrCode, Plus, ChevronRight, Loader2, Clock, AlertCircle, Landmark } from "lucide-react";
import { toast } from "sonner";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { MobileScreen } from "@/components/shared/MobileScreen";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSmartQrFn, createSmartQrFn } from "@/lib/smart-qr.functions";
import { listIncomeCategoriesFn } from "@/lib/non-member-income.functions";
import { toSafeFinanceError } from "@/lib/finance-safe-error";
import { inr, QR_CREATE_ERRORS } from "@/lib/smart-qr-ui";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/qr/")({
  head: () => ({
    meta: [
      { title: "Smart QR Collections — SociyoHub" },
      { name: "description", content: "Create QR codes for events, donations and amenities and track bank transfer collections." },
    ],
  }),
  component: () => (
    <IncomeAccessBoundary>{(societyId) => <SmartQrListPage societyId={societyId} />}</IncomeAccessBoundary>
  ),
});

function SmartQrListPage({ societyId }: { societyId: string }) {
  const listFn = useServerFn(listSmartQrFn);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["smart-qr", "list", societyId],
    queryFn: () => listFn({ data: { societyId } }),
    staleTime: 30_000,
  });
  const items = q.data?.items ?? [];
  const pendingTotal = items.reduce((a, i) => a + i.pendingCount, 0);
  const activeCount = items.filter((i) => i.isActive).length;
  const safe = q.error ? toSafeFinanceError(q.error) : null;

  return (
    <div>
      <MobileHero
        title={tu("op.smart_qr_collections")}
        subtitle={tu("op.share_a_qr_payers_transfer")}
        icon={QrCode}
        variant="navy"
        action={
          <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> {tu("op.new_qr")}
          </Button>
        }
      />
      <MobileScreen className="-mt-6 max-w-3xl">
        <AccountsCenterTabs />
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Stat label={tu("op.active_qr_codes")} value={q.isLoading ? "—" : String(activeCount)} />
          <Stat label={tu("op.awaiting_review")} value={q.isLoading ? "—" : String(pendingTotal)} highlight={pendingTotal > 0} />
        </div>

        {q.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        ) : safe ? (
          <div className="rounded-2xl border bg-card p-5 text-center">
            <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
            <p className="font-medium">{safe.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{safe.message}</p>
            {safe.retryable && (
              <Button className="mt-3 min-h-11" variant="outline" disabled={q.isFetching} onClick={() => q.refetch()}>
                {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : tu("common.retry")}
              </Button>
            )}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-dashed bg-card p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <QrCode className="h-6 w-6" />
            </div>
            <p className="font-semibold">{tu("op.no_qr_codes_yet")}</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              {tu("op.create_one_for_a_festival")}
            </p>
            <Button className="mt-4 min-h-11" onClick={() => setOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> {tu("op.create_your_first_qr")}
            </Button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {items.map((i) => {
              const expired = i.expiresAt && new Date(i.expiresAt) <= new Date();
              return (
                <li key={i.id}>
                  <Link
                    to="/society/qr/$id"
                    params={{ id: i.id }}
                    className="flex min-h-16 items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <QrCode className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {i.categoryName} · {i.fixedAmount ? inr(i.fixedAmount) : tu("op.any_amount")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {!i.isActive || expired ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {expired ? tu("cm.st.expired") : tu("cm.st.paused")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">{tu("common.active")}</span>
                      )}
                      {i.pendingCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                          <Clock className="h-3 w-3" /> {i.pendingCount} {tu("op.to_review_3")}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </MobileScreen>
      <CreateQrSheet open={open} onOpenChange={setOpen} societyId={societyId} />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5 shadow-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${highlight ? "text-warning" : ""}`}>{value}</p>
    </div>
  );
}

const EMPTY = {
  title: "", purpose: "", categoryId: "", amount: "", payeeName: "", bankName: "",
  accountNumber: "", ifsc: "", instructions: "", acceptsCash: false, expiresOn: "",
};

function CreateQrSheet({ open, onOpenChange, societyId }: { open: boolean; onOpenChange: (v: boolean) => void; societyId: string }) {
  const createFn = useServerFn(createSmartQrFn);
  const catFn = useServerFn(listIncomeCategoriesFn);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cats = useQuery({
    enabled: open,
    queryKey: ["income-categories", societyId],
    queryFn: () => catFn({ data: { societyId } }),
    staleTime: 60_000,
  });
  const activeCats = (cats.data?.items ?? []).filter((c: any) => c.is_active);
  const set = (k: keyof typeof EMPTY, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 2) e.title = "Enter a name for this collection";
    if (!f.categoryId) e.categoryId = "Pick an income category";
    if (f.amount && !(Number(f.amount) > 0 && /^\d+(\.\d{1,2})?$/.test(f.amount))) e.amount = "Enter a valid amount or leave empty";
    if (f.payeeName.trim().length < 2) e.payeeName = "Enter the account holder name";
    if (!/^[0-9]{6,20}$/.test(f.accountNumber)) e.accountNumber = "6–20 digits, numbers only";
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.toUpperCase())) e.ifsc = "Enter a valid 11-character IFSC";
    if (f.expiresOn && new Date(f.expiresOn + "T23:59:59") <= new Date()) e.expiresOn = "Pick a future date";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    try {
      const res = await createFn({
        data: {
          title: f.title.trim(),
          purpose: f.purpose.trim() || null,
          categoryId: f.categoryId,
          fixedAmount: f.amount ? Number(f.amount) : null,
          payeeName: f.payeeName.trim(),
          bankName: f.bankName.trim() || null,
          accountNumber: f.accountNumber,
          ifsc: f.ifsc.toUpperCase(),
          instructions: f.instructions.trim() || null,
          acceptsCash: f.acceptsCash,
          expiresAt: f.expiresOn ? new Date(f.expiresOn + "T23:59:59").toISOString() : null,
        },
      });
      if (res.status === "created" && res.id) {
        toast.success(tu("op.qr_code_created"));
        await qc.invalidateQueries({ queryKey: ["smart-qr"] });
        setF(EMPTY);
        onOpenChange(false);
        navigate({ to: "/society/qr/$id", params: { id: res.id } });
      } else {
        toast.error(QR_CREATE_ERRORS[res.status] ?? QR_CREATE_ERRORS.temporary_error);
      }
    } catch {
      toast.error(tu("op.couldn_t_create_the_qr"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-lg">
        <SheetHeader className="text-left">
          <SheetTitle>{tu("op.new_smart_qr")}</SheetTitle>
          <SheetDescription>{tu("op.payers_see_these_bank_details")}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <Field id="title" label={tu("op.collection_name")} error={errors.title}>
            <Input id="title" value={f.title} maxLength={80} placeholder={tu("op.e_g_ganesh_utsav_2026")} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field id="purpose" label={tu("op.what_is_it_for_optional")}>
            <Textarea id="purpose" value={f.purpose} maxLength={300} rows={2} onChange={(e) => set("purpose", e.target.value)} />
          </Field>
          <Field id="cat" label={tu("acc.incomeCategory")} error={errors.categoryId}>
            <Select value={f.categoryId} onValueChange={(v) => set("categoryId", v)}>
              <SelectTrigger id="cat" className="min-h-11">
                <SelectValue placeholder={cats.isLoading ? tu("common.loading") : tu("op.choose_category")} />
              </SelectTrigger>
              <SelectContent>
                {activeCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
            {!cats.isLoading && activeCats.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {tu("op.no_categories_yet")} <Link to="/society/income/categories" className="text-primary underline">{tu("op.add_one")}</Link>.
              </p>
            )}
          </Field>
          <Field id="amount" label={tu("op.fixed_amount_optional")} error={errors.amount} hint={tu("op.leave_empty_to_let_payers")}>
            <Input id="amount" inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>

          <div className="rounded-2xl border bg-muted/30 p-3.5 space-y-3">
            <p className="flex items-center gap-2 text-sm font-medium"><Landmark className="h-4 w-4 text-primary" /> {tu("op.society_bank_account")}</p>
            <Field id="payee" label={tu("op.account_holder_name")} error={errors.payeeName}>
              <Input id="payee" value={f.payeeName} maxLength={100} onChange={(e) => set("payeeName", e.target.value)} />
            </Field>
            <Field id="acct" label={tu("prof.wd.account")} error={errors.accountNumber}>
              <Input id="acct" inputMode="numeric" autoComplete="off" value={f.accountNumber} maxLength={20} onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="ifsc" label="IFSC" error={errors.ifsc}>
                <Input id="ifsc" autoCapitalize="characters" value={f.ifsc} maxLength={11} onChange={(e) => set("ifsc", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              </Field>
              <Field id="bank" label={tu("op.bank_optional")}>
                <Input id="bank" value={f.bankName} maxLength={100} onChange={(e) => set("bankName", e.target.value)} />
              </Field>
            </div>
          </div>

          <Field id="instr" label={tu("op.note_for_payers_optional")}>
            <Textarea id="instr" value={f.instructions} maxLength={500} rows={2} placeholder={tu("op.e_g_mention_your_name")} onChange={(e) => set("instructions", e.target.value)} />
          </Field>
          <Field id="exp" label={tu("op.stop_accepting_after_optional")} error={errors.expiresOn}>
            <Input id="exp" type="date" value={f.expiresOn} onChange={(e) => set("expiresOn", e.target.value)} />
          </Field>
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border p-3">
            <span className="text-sm">
              <span className="font-medium">{tu("op.also_accept_cash")}</span>
              <span className="block text-xs text-muted-foreground">{tu("op.payers_can_report_cash_handed")}</span>
            </span>
            <Switch checked={f.acceptsCash} onCheckedChange={(v) => set("acceptsCash", v)} />
          </label>
          <div className="sticky bottom-0 -mx-6 border-t bg-background px-6 pt-3">
            <Button type="submit" className="min-h-12 w-full" disabled={busy}>
              {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tu("op.creating")}</> : tu("op.create_qr_code")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
