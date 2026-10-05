import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface Props {
  onClick: () => void;
  loading?: boolean;
  label?: string;
}

export function GoogleButton({ onClick, loading, label }: Props) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={loading}
      className="w-full"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M12 11v3.2h4.5c-.2 1.2-1.6 3.5-4.5 3.5-2.7 0-4.9-2.2-4.9-5s2.2-5 4.9-5c1.5 0 2.6.6 3.2 1.2l2.2-2.1C15.9 5.5 14.1 4.7 12 4.7 7.9 4.7 4.6 8 4.6 12s3.3 7.3 7.4 7.3c4.3 0 7.1-3 7.1-7.2 0-.5 0-.9-.1-1.3H12z"
          />
        </svg>
      )}
      {label ?? t("auth.continueGoogle")}
    </Button>
  );
}
