import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const SYSTEM = `You are SocioHub Support, a crisp AI assistant for residents, society admins, and guards using the SocioHub housing society app.

You can help with maintenance bills, payments, invite codes, creating or joining societies, referral partner earnings, withdrawals, visitors, polls, notices, offline emergency contacts, and app navigation.

If you cannot solve the issue, if a payment/account/bug needs human action, or if the user explicitly asks for a human, call the create_support_ticket tool with a short subject and actionable description. After tool success, tell the user the ticket was created. Keep normal answers short and practical.`;

type ChatRequestBody = { messages?: unknown };

function getAuthedClient(request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const authHeader = request.headers.get("authorization") ?? "";
  if (!url || !key) throw new Response("Backend auth is not configured", { status: 500 });
  if (!authHeader.startsWith("Bearer ")) throw new Response("Please sign in to use support", { status: 401 });
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const Route = createFileRoute("/api/support-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const lovableApiKey = process.env.LOVABLE_API_KEY;
        if (!lovableApiKey) {
          return new Response("AI support is not configured", { status: 500 });
        }

        const supabase = getAuthedClient(request);
        const token = request.headers.get("authorization")!.replace("Bearer ", "");
        const { data: claims, error: authError } = await supabase.auth.getClaims(token);
        if (authError || !claims?.claims?.sub) {
          return new Response("Please sign in to use support", { status: 401 });
        }
        const userId = claims.claims.sub;

        const {
          createLovableAiGatewayProvider,
          getLovableAiGatewayResponseHeaders,
          getLovableAiGatewayRunId,
          withLovableAiGatewayRunIdHeader,
        } = await import("@/lib/ai-gateway.server");
        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayProvider(lovableApiKey, initialRunId);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: SYSTEM,
          messages: await convertToModelMessages(messages as UIMessage[]),
          stopWhen: stepCountIs(50),
          tools: {
            create_support_ticket: tool({
              description: "Create a human support ticket when the SocioHub AI cannot solve the user's issue directly.",
              inputSchema: z.object({
                subject: z.string().min(3).max(120),
                description: z.string().min(10).max(1200),
              }),
              execute: async ({ subject, description }) => {
                const { data: profile } = await supabase
                  .from("profiles")
                  .select("society_id")
                  .eq("id", userId)
                  .maybeSingle();
                const { data: row, error } = await supabase
                  .from("support_tickets")
                  .insert({
                    user_id: userId,
                    society_id: profile?.society_id ?? null,
                    subject,
                    description,
                    ai_transcript: messages as Database["public"]["Tables"]["support_tickets"]["Insert"]["ai_transcript"],
                  })
                  .select("id")
                  .single();
                if (error) throw new Error(error.message);
                return { ticketId: row.id, shortId: row.id.slice(0, 8), status: "created" };
              },
            }),
          },
        });

        const response = result.toUIMessageStreamResponse({
          originalMessages: messages as UIMessage[],
          headers: getLovableAiGatewayResponseHeaders(undefined, {
            ...(initialRunId ? { "X-Lovable-AIG-Run-ID": initialRunId } : {}),
          }),
        });

        return withLovableAiGatewayRunIdHeader(response, gateway);
      },
    },
  },
});