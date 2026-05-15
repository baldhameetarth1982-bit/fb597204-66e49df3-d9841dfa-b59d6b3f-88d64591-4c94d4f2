import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Bot, User as UserIcon, Loader2, ArrowLeft, Ticket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/context/AuthContext";
import { supportChat, createSupportTicket } from "@/lib/support.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/support")({
  head: () => ({ meta: [{ title: "Support — SocioHub" }] }),
  component: SupportPage,
});

interface Msg { role: "user" | "assistant"; content: string }

function SupportPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const chat = useServerFn(supportChat);
  const ticket = useServerFn(createSupportTicket);

  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "Hi! I'm SocioHub's AI assistant. What do you need help with today?" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!isAuthenticated) { navigate({ to: "/login" }); return; }
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const res = await chat({ data: { messages: next } });
      setMessages([...next, { role: "assistant", content: res.reply || "(no reply)" }]);
      if (res.escalate && res.subject && res.summary) {
        const t = await ticket({
          data: {
            subject: res.subject,
            description: res.summary,
            transcript: next as any,
          },
        });
        setMessages((m) => [...m, {
          role: "assistant",
          content: `I've created support ticket #${t.id.slice(0, 8)} so a human can take a look. You'll get an update shortly.`,
        }]);
        toast.success("Support ticket created");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col h-[100dvh] max-w-[420px] mx-auto bg-background">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => history.back()} className="rounded-xl">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary grid place-items-center">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold leading-tight">Support</p>
          <p className="text-[11px] text-muted-foreground">AI-assisted · Escalates to a human if needed</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <Card className={`max-w-[78%] rounded-2xl ${m.role === "user" ? "bg-primary text-primary-foreground" : ""}`}>
              <CardContent className="p-3 text-sm whitespace-pre-line">{m.content}</CardContent>
            </Card>
            {m.role === "user" && (
              <div className="h-8 w-8 rounded-full bg-secondary grid place-items-center shrink-0">
                <UserIcon className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex gap-2 items-center text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border p-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Describe your issue…"
          className="rounded-xl"
          disabled={busy}
        />
        <Button onClick={send} disabled={busy || !input.trim()} className="rounded-xl">
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="px-4 pb-3 text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
        <Ticket className="h-3 w-3" /> Tickets are saved securely to your account.
      </p>
    </div>
  );
}
