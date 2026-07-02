import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

/** High-contrast legal footer shown on every page. */
export function LegalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer
      className={`w-full border-t border-border bg-background text-foreground ${
        compact ? "py-3" : "py-5"
      }`}
      style={{ paddingBottom: `calc(${compact ? "0.75rem" : "1.25rem"} + env(safe-area-inset-bottom))` }}
    >
      <div className="mx-auto max-w-6xl px-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
          <Link to="/privacy" className="hover:underline">Privacy</Link>
          <span className="opacity-30">·</span>
          <Link to="/terms" className="hover:underline">Terms</Link>
          <span className="opacity-30">·</span>
          <Link to="/refund" className="hover:underline">Refund Policy</Link>
          <span className="opacity-30">·</span>
          <Link to="/contact" className="hover:underline">Contact</Link>
          <span className="opacity-30">·</span>
          <Link to="/legal" className="hover:underline">Legal Center</Link>
        </nav>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          <span>Secured by Razorpay · 128-bit SSL Encrypted</span>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-5 mt-2 text-[10px] text-muted-foreground">
        © {new Date().getFullYear()} SocioHub. A SaaS platform for housing society management. Pethapur, Gandhinagar, Gujarat — 382610.
      </div>
    </footer>
  );
}
