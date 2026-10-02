// Self-contained preview of the Neon premium theme — does NOT toggle the global theme.
export function NeonThemePreview() {
  return (
    <div
      className="theme-neon rounded-2xl overflow-hidden border"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold tracking-wider">SOCIO<span style={{ color: "var(--primary)" }}>HUB.</span></div>
          <div className="h-2 w-2 rounded-full" style={{ background: "var(--primary)", boxShadow: "0 0 12px var(--primary)" }} />
        </div>
        <h3 className="text-2xl font-bold leading-tight">
          Dashboard <span className="italic" style={{ color: "var(--primary)" }}>Overview</span>
        </h3>
        <p className="text-xs opacity-70 mt-1">A premium look just for your society.</p>

        <div className="mt-4 rounded-xl p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex justify-between text-xs">
            <span className="opacity-70">Profile setup</span>
            <span style={{ color: "var(--primary)" }}>75%</span>
          </div>
          <div className="h-1.5 mt-2 rounded-full overflow-hidden" style={{ background: "var(--secondary)" }}>
            <div className="h-full w-3/4 rounded-full" style={{ background: "linear-gradient(90deg, var(--primary), var(--accent))" }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3">
          {["Active 3", "Earnings ₹0", "Pending ₹0", "Uploads 0"].map((t) => (
            <div key={t} className="rounded-xl p-3 text-xs" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="opacity-60 uppercase text-[10px] tracking-wider">{t.split(" ")[0]}</div>
              <div className="mt-1 font-bold">{t.split(" ").slice(1).join(" ")}</div>
            </div>
          ))}
        </div>

        <button
          className="mt-4 w-full rounded-xl py-3 text-sm font-semibold"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)", boxShadow: "0 8px 30px -8px var(--primary)" }}
        >
          View Campaign
        </button>
      </div>
    </div>
  );
}
