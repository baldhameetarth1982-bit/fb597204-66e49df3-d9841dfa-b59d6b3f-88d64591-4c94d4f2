/**
 * Reusable rate-limit middleware for createServerFn.
 *
 * Usage:
 *   .middleware([requireSupabaseAuth, withRateLimit({ bucket: "create-post", limit: 10 })])
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { checkRateLimit } from "./rate-limit.server";

export function withRateLimit(opts: { bucket: string; limit: number; windowSec?: number; perUser?: boolean }) {
  return createMiddleware({ type: "function" }).server(async ({ next, context }) => {
    const userId = (context as any)?.userId as string | undefined;
    let subject = opts.perUser === false ? null : userId;
    if (!subject) {
      try { subject = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { subject = "anon"; }
    }
    await checkRateLimit({
      bucket: opts.bucket,
      subject: subject!,
      limit: opts.limit,
      windowSec: opts.windowSec ?? 60,
    });
    return next();
  });
}
