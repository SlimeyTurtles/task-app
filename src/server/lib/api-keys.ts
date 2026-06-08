import { randomBytes, createHash } from "crypto";

/**
 * API key issuance and verification.
 *
 * Keys are shown to the user exactly once (at creation), then stored only
 * as a SHA-256 hash. Verification recomputes the hash and looks up by hash
 * — no plaintext is ever in the DB, but lookup is still O(1).
 *
 * Format: `alm_<prefix>_<secret>`
 *   - `alm_`     — fixed prefix so leaked keys are unambiguously ours
 *                  (greppable in repos, recognisable to scanners)
 *   - `<prefix>` — first 8 hex chars of the secret; shown in the UI to
 *                  identify a key without exposing it ("alm_a1b2c3d4_…")
 *   - `<secret>` — 32 bytes of entropy, base64url
 */

const KEY_BYTES = 32;

export function generateApiKey(): { key: string; prefix: string; hashedKey: string } {
  const raw = randomBytes(KEY_BYTES).toString("base64url");
  const prefix = raw.slice(0, 8);
  const key = `alm_${prefix}_${raw}`;
  const hashedKey = hashApiKey(key);
  return { key, prefix, hashedKey };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** True if the string at least looks like one of our keys (cheap pre-check
 *  before we hit the DB). Doesn't prove validity — only filters obvious
 *  garbage so we don't waste a query. */
export function looksLikeApiKey(s: string): boolean {
  return /^alm_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{20,}$/.test(s);
}
