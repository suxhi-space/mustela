import { normalizeBase } from "../session/book";
import type { StoredSession } from "./types";

/**
 * Stoat sign-in, done directly against the REST API so we can handle
 * two-factor login (the SDK's own login() throws on MFA).
 */

export const DEFAULT_API = "https://stoat.chat/api";

export type LoginResult =
  | { kind: "ok"; session: StoredSession; name: string }
  | { kind: "mfa"; ticket: string; methods: string[] };

/** Never echo server text verbatim; map known error types to friendly messages. */
export function loginErrorMessage(type: unknown, status?: number): string {
  switch (type) {
    case "InvalidCredentials": return "That email or password isn't right.";
    case "LockedOut": return "Too many attempts. Wait a bit and try again.";
    case "UnverifiedAccount": return "Verify your email first, then sign in.";
    case "InvalidToken": case "InvalidSession": return "Your session expired. Sign in again.";
    case "DisabledAccount": return "This account is disabled.";
    case "InvalidTotpCode": case "InvalidMfaResponse": return "That code didn't work. Try the next one.";
    case "CompromisedPassword": return "This password is on a breach list. Reset it on the Stoat website, then sign in.";
  }
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status && status >= 500) return "The server had a problem. Try again shortly.";
  return "Couldn't sign in. Check your details and instance address.";
}

async function post(base: string, body: unknown): Promise<LoginResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/auth/session/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and instance address.");
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(loginErrorMessage(data?.type, res.status));
  if (data?.result === "Success" && typeof data._id === "string" && typeof data.token === "string" && typeof data.user_id === "string") {
    return { kind: "ok", session: { _id: data._id, token: data.token, user_id: data.user_id }, name: typeof data.name === "string" ? data.name : "" };
  }
  if (data?.result === "MFA" && typeof data.ticket === "string") {
    return { kind: "mfa", ticket: data.ticket, methods: Array.isArray(data.allowed_methods) ? data.allowed_methods.map(String) : [] };
  }
  if (data?.result === "Disabled") throw new Error(loginErrorMessage("DisabledAccount"));
  throw new Error(loginErrorMessage(undefined));
}

function baseOf(raw?: string): string {
  const b = normalizeBase(raw);
  if (raw && raw.trim() && !b) throw new Error("Instance address must start with https://");
  return b ?? DEFAULT_API;
}

export const FRIENDLY = "Mustela";

export function beginLogin(p: { baseURL?: string; email: string; password: string }): Promise<LoginResult> {
  return post(baseOf(p.baseURL), { email: p.email, password: p.password, friendly_name: FRIENDLY });
}

export async function finishMfa(p: { baseURL?: string; ticket: string; method: "totp" | "recovery"; code: string }): Promise<LoginResult> {
  const response = p.method === "totp" ? { totp_code: p.code.replace(/\s+/g, "") } : { recovery_code: p.code.trim() };
  return post(baseOf(p.baseURL), { mfa_ticket: p.ticket, mfa_response: response, friendly_name: FRIENDLY });
}
