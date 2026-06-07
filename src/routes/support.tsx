import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowLeft, Bot, TicketCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { toast } from "sonner";

export const Route = createFileRoute("/support")({
  head: () => ({ meta: [{ title: "Support — SocioHub" }] }),
  component: SupportPage,
});

const initialMessages: UIMessage[] = [
  {
    id: "support-welcome",
    role: "assistant",
    parts: [{ type: "text", text: "Hi — I’m SocioHub Support. Tell me what’s stuck and I’ll either solve it here or open a support ticket automatically." }],
  },
];

function SupportPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/support-chat",
        fetch: async (input, init) => {
          const { data } = await supabase.auth.getSession();
          const headers = new Headers(init?.headers);
          if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
          return fetch(input, { ...init, headers });
        },
      }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat({
    id: "support-session",
    messages: initialMessages,
    transport,
  });

  useEffect(() => { textareaRef.current?.focus(); }, [status]);
  useEffect(() => { if (error) toast.error(error.message || "Support chat failed"); }, [error]);

  const busy = status === "submitted" || status === "streaming";

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
          <p className="text-[11px] text-muted-foreground">AI chat · Auto-ticketing when needed</p>
        </div>
      </header>

      <Conversation className="min-h-0">
        <ConversationContent className="gap-5 px-4 py-5">
          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent className="group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground">
                {message.parts.map((part, index) => {
                  if (part.type === "text") {
                    return <MessageResponse key={index}>{part.text}</MessageResponse>;
                  }
                  if (part.type.startsWith("tool-")) {
                    const toolPart = part as any;
                    return (
                      <Tool key={index} defaultOpen={false}>
                        <ToolHeader type={toolPart.type} state={toolPart.state} title="Support ticket" />
                        <ToolContent>
                          <ToolInput input={toolPart.input} />
                          <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && <Shimmer>Thinking…</Shimmer>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border p-3">
        <PromptInput
          onSubmit={(message) => {
            const text = message.text.trim();
            if (!text || busy) return;
            if (!isAuthenticated) { navigate({ to: "/login" }); return; }
            void sendMessage({ text });
          }}
          className="rounded-xl bg-card"
        >
          <PromptInputTextarea ref={textareaRef} placeholder="Describe your issue…" disabled={busy} />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit status={status} onStop={stop} />
          </PromptInputFooter>
        </PromptInput>
      </div>
      <p className="px-4 pb-3 text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
        <TicketCheck className="h-3 w-3" /> Unresolved issues are saved as support tickets.
      </p>
    </div>
  );
}
