import { createHash } from "node:crypto";
import type { DbClient } from "./db";
import { DomainError } from "./errors";

export function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Fixed-window limiter backed by Postgres so it works across server instances.
 * Records the hit, then refuses if the window already holds `limit` hits.
 */
export async function enforceRateLimit(
  client: DbClient,
  key: string,
  limit: number,
  windowSeconds: number,
  message = "Too many attempts. Please wait a few minutes and try again.",
) {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const count = await client.rateLimitHit.count({ where: { key, createdAt: { gte: since } } });
  if (count >= limit) throw new DomainError("RATE_LIMITED", message);
  await client.rateLimitHit.create({ data: { key } });
}
