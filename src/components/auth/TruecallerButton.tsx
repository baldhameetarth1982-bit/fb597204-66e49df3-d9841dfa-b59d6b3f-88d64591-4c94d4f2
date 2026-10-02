import { Button } from "@/components/ui/button";
import { Loader2, Zap } from "lucide-react";

interface Props {
  onClick: () => void;
  loading?: boolean;
}

/**
 * Truecaller One-Tap button. Rendered only when the auth service reports
 * `capabilities.truecaller === true` (Capacitor native SDK or Truecaller
 * OAuth client id configured).
 */
export function TruecallerButton({ onClick, loading }: Props) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full h-12 rounded-2xl font-semibold gap-2 bg-[#00A8E4] hover:bg-[#0090c4] text-white"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
      Continue with Truecaller
    </Button>
  );
}
