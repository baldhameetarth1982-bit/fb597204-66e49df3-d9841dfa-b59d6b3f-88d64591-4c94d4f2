import { tu } from "@/lib/i18n";
import { formatDate } from "@/utils/format";
import type { AdminBillDetail } from "@/lib/billing-generate.functions";

/**
 * Default printable bill layout (owner-approved sample): society header,
 * bill details, resident details, maintenance charges table, final total bar,
 * thank-you note and chairman signature line. Hidden on screen, shown in print.
 */
export function BillSheet({ detail }: { detail: AdminBillDetail }) {
  const b = detail.bill;
  const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const house = `${detail.flat?.block_name ? `${detail.flat.block_name}-` : ""}${detail.flat?.flat_number ?? "—"}`;
  const maint = detail.lines.filter((l) => l.kind === "maintenance");
  const other = detail.lines.filter((l) => l.kind !== "maintenance");
  const maintTotal = maint.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const total = Number(b.total_payable ?? b.amount ?? 0);
  const adjustments = Number(b.adjustments ?? 0);
  const row = (k: string, v: string) => (
    <div className="bill-sheet-row"><span>{k}</span><span>{v}</span></div>
  );

  return (
    <section className="bill-sheet" aria-hidden>
      <header className="bill-sheet-head">
        <h1>{(detail.society?.name ?? "").toUpperCase()}</h1>
        {detail.society?.address && <p>{detail.society.address}</p>}
        {detail.society?.registration && <p className="bill-sheet-small">{tu("ln.bs.reg")}: {detail.society.registration}</p>}
        <span className="bill-sheet-badge">{tu("ln.bs.badge")}</span>
      </header>

      <h2>{tu("ln.bs.billDetails")}</h2>
      <div className="bill-sheet-box">
        {row(tu("ln.bs.billNo"), b.bill_number ?? "—")}
        {row(tu("ln.bs.billDate"), b.bill_date ? formatDate(b.bill_date) : "—")}
        {row(tu("rbd.dueDate"), b.due_date ? formatDate(b.due_date) : "—")}
      </div>

      <h2>{tu("ln.bs.resident")}</h2>
      <div className="bill-sheet-box">
        {row(tu("ln.bs.houseNo"), house)}
        {row(tu("ln.bs.name"), detail.resident?.full_name ?? "—")}
        {row(tu("ln.bs.mobile"), detail.resident?.phone ?? "—")}
        {detail.resident?.property_number && row(tu("ln.bs.propNo"), detail.resident.property_number)}
        {detail.resident?.ugvcl_number && row(tu("ln.bs.ugvcl"), detail.resident.ugvcl_number)}
        {detail.resident?.share_certificate_number && row(tu("ln.bs.shareCert"), detail.resident.share_certificate_number)}
      </div>

      <h2>{tu("ln.bs.charges")}</h2>
      <div className="bill-sheet-box">
        <div className="bill-sheet-th"><span>{tu("ln.bs.month")}</span><span>{tu("common.amount")}</span></div>
        {maint.map((l) => (
          <div key={String(l.id)} className="bill-sheet-row"><span>{String(l.description ?? "").replace(/^Maintenance — /, "")}</span><span>{inr(Number(l.amount))}</span></div>
        ))}
        {maint.length > 0 && <div className="bill-sheet-sub"><span>{tu("ln.bs.subtotal")}</span><span>{inr(maintTotal)}</span></div>}
        {other.map((l) => (
          <div key={String(l.id)} className="bill-sheet-row"><span>{String(l.description ?? tu("rbd.charge"))}</span><span>{inr(Number(l.amount))}</span></div>
        ))}
        {adjustments !== 0 && <div className="bill-sheet-row"><span>{tu("ln.bs.adjust")}</span><span>{inr(adjustments)}</span></div>}
      </div>

      <div className="bill-sheet-total"><span>{tu("ln.bs.final")}</span><span>{inr(total)}</span></div>

      <footer className="bill-sheet-foot">
        <p>{tu("ln.bs.thanks")}<br />{tu("ln.bs.computer")}</p>
        <p className="bill-sheet-sign">{tu("ln.bs.sign")}</p>
      </footer>
    </section>
  );
}
