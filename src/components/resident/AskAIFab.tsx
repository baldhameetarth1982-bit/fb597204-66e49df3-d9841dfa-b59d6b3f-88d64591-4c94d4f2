import { Link, useRouterState } from "@tanstack/react-router";
import { Bot } from "lucide-react";
import { tu } from "@/lib/i18n";

/** Floating Ask-AI action for resident screens. Hidden on the support page itself. */
export function AskAIFab() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Also hidden on post conversations, where it would cover the comment Send button.
  if (path.startsWith("/support") || path.startsWith("/app/feed/") || path.startsWith("/app/secretary")) return null;
  return (
    <Link
      to="/support"
      aria-label={tu("op.ask_ai_support")}
      className="fixed z-40 right-4 bg-primary text-primary-foreground shadow-lg rounded-full h-12 w-12 grid place-items-center hover:scale-105 active:scale-95 transition-transform"
      style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
    >
      <Bot className="h-5 w-5" />
    </Link>
  );
}
