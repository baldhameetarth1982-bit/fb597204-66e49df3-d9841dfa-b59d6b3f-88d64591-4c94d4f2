import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Global toast surface. Grid alignment and close-button centering are
 * enforced in src/styles.css (see [data-sonner-toaster] rules) so every
 * variant renders with a perfectly aligned icon / message / close.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast border bg-popover text-popover-foreground border-border shadow-lg",
          title: "text-sm font-semibold leading-tight",
          description: "text-xs text-muted-foreground leading-snug",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
          success: "!bg-[var(--success-container)] !text-[var(--success-container-foreground)] !border-[color:color-mix(in_oklab,var(--success)_35%,transparent)]",
          error: "!bg-[var(--danger-container)] !text-[var(--danger-container-foreground)] !border-[color:color-mix(in_oklab,var(--destructive)_35%,transparent)]",
          warning: "!bg-[var(--warning-container)] !text-[var(--warning-container-foreground)] !border-[color:color-mix(in_oklab,var(--warning)_35%,transparent)]",
          info: "!bg-[var(--info-container)] !text-[var(--info-container-foreground)] !border-[color:color-mix(in_oklab,var(--info)_35%,transparent)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
