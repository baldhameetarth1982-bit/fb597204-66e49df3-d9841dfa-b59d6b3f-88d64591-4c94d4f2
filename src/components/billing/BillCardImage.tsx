import { forwardRef } from "react";

export interface BillCardData {
  societyName: string;
  flatLabel: string;
  residentName?: string;
  period: string;
  amount: number;
  dueDate: string;
  status: "paid" | "due" | "unpaid" | "overdue" | "cancelled";
  adminSignature?: string; // verified signature text or URL
  themeBg?: string; // image url for background canvas
}

export const BillCardImage = forwardRef<HTMLDivElement, { data: BillCardData }>(
  ({ data }, ref) => {
    const isPaid = data.status === "paid";
    return (
      <div
        ref={ref}
        style={{
          width: 720,
          minHeight: 960,
          background: data.themeBg
            ? `url(${data.themeBg}) center/cover no-repeat`
            : "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
          color: "#fff",
          fontFamily: "Inter, system-ui, sans-serif",
          padding: 48,
          borderRadius: 32,
          position: "relative",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>{data.societyName}</div>
          <div
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: isPaid ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.18)",
              border: "1px solid rgba(255,255,255,0.35)",
              fontSize: 14,
              textTransform: "uppercase",
              letterSpacing: 1,
              fontWeight: 600,
            }}
          >
            {isPaid ? "Paid" : "Due"}
          </div>
        </div>

        <div style={{ marginTop: 56 }}>
          <div style={{ opacity: 0.8, fontSize: 14, textTransform: "uppercase", letterSpacing: 2 }}>
            Maintenance Invoice
          </div>
          <div style={{ fontSize: 22, marginTop: 8, fontWeight: 500 }}>{data.period}</div>
        </div>

        <div
          style={{
            marginTop: 40,
            padding: 28,
            borderRadius: 24,
            background: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
            <span style={{ opacity: 0.85 }}>Flat</span>
            <span style={{ fontWeight: 600 }}>{data.flatLabel}</span>
          </div>
          {data.residentName && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
              <span style={{ opacity: 0.85 }}>Resident</span>
              <span style={{ fontWeight: 600 }}>{data.residentName}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
            <span style={{ opacity: 0.85 }}>Due date</span>
            <span style={{ fontWeight: 600 }}>{data.dueDate}</span>
          </div>
          <div style={{ height: 1, background: "rgba(255,255,255,0.2)", margin: "18px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ opacity: 0.85 }}>Amount</span>
            <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>
              ₹{Number(data.amount).toLocaleString("en-IN")}
            </span>
          </div>
        </div>

        <div style={{ position: "absolute", bottom: 48, left: 48, right: 48 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Pay securely in the SociyoHub app
              <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                Powered by SociyoHub · 100% cashless settlement
              </div>
            </div>
            {data.adminSignature && (
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontFamily: "'Caveat', 'Brush Script MT', cursive",
                    fontSize: 28,
                    fontWeight: 600,
                    color: "#fff",
                    marginBottom: 4,
                  }}
                >
                  {data.adminSignature}
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, borderTop: "1px solid rgba(255,255,255,0.3)", paddingTop: 4 }}>
                  Verified Admin Signature
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);
BillCardImage.displayName = "BillCardImage";

/**
 * Render a BillCardData into a PNG blob via html-to-image.
 * Mounts an offscreen DOM node, snapshots it, and returns the blob.
 */
export async function renderBillToImageBlob(data: BillCardData): Promise<Blob> {
  const { toBlob } = await import("html-to-image");
  const { createRoot } = await import("react-dom/client");
  const React = await import("react");

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  const root = createRoot(host);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const ref = React.createRef<HTMLDivElement>();
      root.render(React.createElement(BillCardImage, { data, ref }));
      // Wait for fonts/backgrounds to load
      setTimeout(async () => {
        try {
          if (!ref.current) throw new Error("Render target missing");
          const blob = await toBlob(ref.current, { cacheBust: true, pixelRatio: 2 });
          if (!blob) throw new Error("Failed to render image");
          resolve(blob);
        } catch (e) {
          reject(e);
        }
      }, 350);
    });
  } finally {
    setTimeout(() => {
      try { root.unmount(); host.remove(); } catch {}
    }, 50);
  }
}

/**
 * Share a bill as an image to WhatsApp / native share sheet.
 * Falls back to downloading the image if Web Share API can't handle files.
 */
export async function shareBillAsImage(data: BillCardData) {
  const blob = await renderBillToImageBlob(data);
  const file = new File([blob], `bill-${data.flatLabel.replace(/\s+/g, "-")}-${data.period.replace(/\s+/g, "-")}.png`, { type: "image/png" });

  const nav: any = navigator;
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: `Bill — ${data.flatLabel}`,
        text: `${data.societyName} · ${data.period} · ₹${data.amount}`,
      });
      return;
    } catch {
      // user cancelled or share failed — fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  // Also nudge WhatsApp Web with caption so they can attach the saved image
  const caption = `${data.societyName}\n${data.flatLabel} · ${data.period}\nAmount: ₹${data.amount.toLocaleString("en-IN")}\nDue: ${data.dueDate}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, "_blank");
}
