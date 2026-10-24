import { DEFAULT_API } from "../backend/login";
import { normalizeBase } from "./book";
import type { StoredSession } from "../backend/types";

/**
 * Ends a session on the server so a removed account's token stops working.
 * Best effort: offline or already-expired is fine, we still forget it locally.
 */
export async function revokeSession(baseURL: string | undefined, s: StoredSession, f: typeof fetch = fetch): Promise<boolean> {
  const base = normalizeBase(baseURL) ?? DEFAULT_API;
  try {
    const r = await f(`${base}/auth/session/logout`, { method: "POST", headers: { "x-session-token": s.token } });
    return r.ok;
  } catch {
    return false;
  }
}
