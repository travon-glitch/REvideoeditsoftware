/*
 * Error monitoring. Every server error (pages, server actions, API routes) is written to the server log
 * as one JSON line that log tools can search ("lvs.error"). If LVS_ERROR_WEBHOOK_URL is set (for example
 * a Slack or Teams incoming webhook, or your monitoring service's intake URL), a short alert is posted there too.
 * Alerts contain the page path, the error type and the reference shown to the person — never request
 * bodies, cookies, listing data or keys.
 */
import type { Instrumentation } from "next";

const recent = new Map<string, number>();

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const err = error as Error & { digest?: string };
  const path = request.path.split("?")[0]!.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
  const event = {
    level: "error", event: "lvs.error", at: new Date().toISOString(), reference: err.digest ?? null,
    method: request.method, path, route: context.routePath, kind: context.routeType, error: err.name, message: String(err.message ?? "").slice(0, 300),
  };
  console.error(JSON.stringify(event));

  const hook = process.env.LVS_ERROR_WEBHOOK_URL;
  if (!hook || !/^https:\/\//.test(hook)) return;
  // at most one alert per route and error type every 10 minutes
  const key = `${context.routePath}|${err.name}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 10 * 60_000) return;
  recent.set(key, now);
  try {
    await fetch(hook, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ text: `Listing Video Studio error on ${event.method} ${event.route} (${event.error}). Reference ${event.reference ?? "—"}. Check the server log for "lvs.error".`, ...event, message: undefined }),
    });
  } catch { /* monitoring must never break the app */ }
};
