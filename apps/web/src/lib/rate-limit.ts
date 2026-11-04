import "server-only";
/*
 * A small per-person rate limit for expensive endpoints that run on this server (speech synthesis).
 * It lives in this server's memory: with several web servers each one keeps its own count, which is
 * fine for its purpose (stopping one person from keeping the CPU busy).
 */
const hits = new Map<string, number[]>();

export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > now - windowMs)) hits.delete(k);
  return true;
}
