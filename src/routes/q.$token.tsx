import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Copy, CheckCircle2, Loader2, QrCode, AlertCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { getPublicQrFn, submitPublicQrFn, type PublicQr } from "@/lib/smart-qr.functions";
import { inr, SUBMIT_MESSAGES, todayIST } from "@/lib/smart-qr-ui";

export const Route = createFileRoute("/q/$token")({
  head: () => ({
    meta: [
      { title: "Pay your society — SociyoHub" },
      { name: "description", content: "Bank transfer details for a society collection, powered by SociyoHub." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Society collection — SociyoHub" },
      { property: "og:description", content: "Transfer to your society's bank account and send the payment details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicQrPage,
});

function PublicQrPage() {
  const { token } = Route.useParams();
  const getFn = useServerFn(getPublicQrFn);
  const q = useQuery({ queryKey: ["public-qr", token], queryFn: () => getFn({ data: { token } }), retry: 1, staleTime: 60_000 });

  return (
    <div className="min-h-dvh bg-background">
      <div className="bg-[oklch(0.22_0.05_260)] px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-md items-center gap-2 text-sm opacity-80">
          <QrCode className="h-4 w-4" /> SociyoHub collection
        </div>
      </div>
      <main className="mx-auto -mt-7 max-w-md px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {q.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-40 rounded-3xl" /><Skeleton className="h-64 rounded-3xl" /></div>
        ) : q.error ? (
          <Notice title="Couldn't load this page" body="Check your connection and try again." action={<Button className="mt-3 min-h-11" variant="outline" onClick={() => q.refetch()}>Retry</Button>} />
        ) : !q.data || q.data.status === "not_found" ? (
          <Notice title="QR code not valid" body="Ask your society committee for the correct QR code." />
        ) : q.data.status === "inactive" ? (
          <Notice title={q.data.title} body={`${q.data.societyName} is no longer accepting payments for this collection.`} />
        ) : (
          <Collect qr={q.data} token={token} />
        )}
      </main>
    </div>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
      <AlertCircle className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-all font-medium">{value}</p>
      </div>
      <Button
        type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Copy ${label}`}
        onClick={async () => { try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`); } catch { /* ignore */ } }}
      >
        <Copy className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Collect({ qr, token }: { qr: Extract<PublicQr, { status: "ok" }>; token: string }) {
  const submitFn = useServerFn(submitPublicQrFn);
  const [f, setF] = useState({
    payerName: "", payerPhone: "", amount: qr.fixedAmount ? String(qr.fixedAmount) : "",
    method: "bank_transfer" as "bank_transfer" | "cash", reference: "", paidOn: todayIST(), note: "",
  });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (f.payerName.trim().length < 2) e.payerName = "Enter your name";
    if (f.payerPhone && !/^[0-9]{10}$/.test(f.payerPhone)) e.payerPhone = "10-digit mobile number";
    if (!(Number(f.amount) > 0) || !/^\d+(\.\d{1,2})?$/.test(f.amount)) e.amount = "Enter the amount you paid";
    if (f.method === "bank_transfer" && !/^[A-Za-z0-9/-]{4,64}$/.test(f.reference.replace(/\s/g, ""))) e.reference = "Enter the UTR / transaction reference";
    if (!f.paidOn || f.paidOn > todayIST()) e.paidOn = "Pick the date you paid";
    setErr(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || !validate()) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await submitFn({
        data: {
          token, payerName: f.payerName.trim(), payerPhone: f.payerPhone, amount: Number(f.amount), method: f.method,
          reference: f.reference.replace(/\s/g, ""), paidOn: f.paidOn, note: f.note.trim(), idempotencyKey: key,
        },
      });
      if (r.status === "submitted") setDone(true);
      else {
        setFormError(SUBMIT_MESSAGES[r.status] ?? SUBMIT_MESSAGES.temporary_error);
        // A definitive rejection means a corrected retry is a new submission.
        if (r.status === "invalid_input" || r.status === "duplicate_reference") setKey(crypto.randomUUID());
      }
    } catch {
      setFormError(SUBMIT_MESSAGES.temporary_error);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><CheckCircle2 className="h-6 w-6" /></div>
        <p className="text-lg font-semibold">Details sent</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {qr.societyName} will check their bank account and confirm your payment of {inr(Number(f.amount))}. This is not a receipt yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border bg-card p-5 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">{qr.societyName}</p>
        <h1 className="mt-1 text-xl font-semibold leading-tight">{qr.title}</h1>
        {qr.purpose && <p className="mt-1 text-sm text-muted-foreground">{qr.purpose}</p>}
        {qr.fixedAmount && <p className="mt-3 text-3xl font-semibold tabular-nums">{inr(qr.fixedAmount)}</p>}
      </section>

      <section className="rounded-3xl border bg-card p-5 shadow-sm">
        <p className="text-sm font-semibold">Step 1 · Transfer from your bank app</p>
        <div className="mt-2 divide-y">
          <CopyRow label="Account name" value={qr.payeeName} />
          <CopyRow label="Account number" value={qr.accountNumber} />
          <CopyRow label="IFSC" value={qr.ifsc} />
          {qr.bankName && <div className="py-2"><p className="text-xs text-muted-foreground">Bank</p><p className="font-medium">{qr.bankName}</p></div>}
        </div>
        {qr.instructions && <p className="mt-2 rounded-xl bg-muted/50 p-3 text-sm">{qr.instructions}</p>}
      </section>

      <form onSubmit={submit} noValidate className="space-y-4 rounded-3xl border bg-card p-5 shadow-sm">
        <p className="text-sm font-semibold">Step 2 · Tell the society you paid</p>
        {qr.acceptsCash && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How did you pay">
            {(["bank_transfer", "cash"] as const).map((m) => (
              <button
                key={m} type="button" role="radio" aria-checked={f.method === m} onClick={() => set("method", m)}
                className={`min-h-11 rounded-xl border text-sm font-medium ${f.method === m ? "border-primary bg-primary/10 text-primary" : ""}`}
              >
                {m === "cash" ? "Cash" : "Bank transfer"}
              </button>
            ))}
          </div>
        )}
        <F id="name" label="Your name" error={err.payerName}><Input id="name" autoComplete="name" maxLength={100} value={f.payerName} onChange={(e) => set("payerName", e.target.value)} /></F>
        <F id="phone" label="Mobile (optional)" error={err.payerPhone}><Input id="phone" inputMode="tel" autoComplete="tel-national" maxLength={10} value={f.payerPhone} onChange={(e) => set("payerPhone", e.target.value.replace(/\D/g, ""))} /></F>
        <F id="amt" label="Amount paid (₹)" error={err.amount}><Input id="amt" inputMode="decimal" readOnly={!!qr.fixedAmount} value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.]/g, ""))} /></F>
        {f.method === "bank_transfer" && (
          <F id="ref" label="UTR / transaction reference" error={err.reference}><Input id="ref" autoCapitalize="characters" maxLength={64} value={f.reference} onChange={(e) => set("reference", e.target.value)} /></F>
        )}
        <F id="date" label="Date paid" error={err.paidOn}><Input id="date" type="date" max={todayIST()} value={f.paidOn} onChange={(e) => set("paidOn", e.target.value)} /></F>
        <F id="note" label="Note (optional)"><Textarea id="note" rows={2} maxLength={300} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. Flat A-203 guest" /></F>
        {formError && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{formError}</p>}
        <Button type="submit" className="min-h-12 w-full" disabled={busy}>
          {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…</> : "Send payment details"}
        </Button>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Your payment is confirmed only after the society checks its bank account.
        </p>
      </form>
    </div>
  );
}

function F({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
