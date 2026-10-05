import { useTranslation } from "react-i18next";
import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<"input">, "type"> & { revealLabel?: string };

/** Secret input, hidden by default, with an accessible show/hide toggle. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(
  ({ className, revealLabel, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    const { t } = useTranslation();
    const what = revealLabel ?? t("password.what");
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? "text" : "password"} className={cn("pr-12", className)} {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("password.hide", { what }) : t("password.show", { what })}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";
