import type { StoredSession } from "../backend/types";

/**
 * The list of signed-in accounts and which one is active.
 *
 * Pure functions over a plain object, plus a thin storage wrapper, so the
 * logic is testable without a browser.
 *
 * SECURITY NOTE: session tokens are stored in the webview's app-private
 * storage (localStorage). That is sandboxed per app on Android, but on desktop
 * it is a plain file in the user's profile. Moving tokens to the OS keychain is
 * on the to-do list (README). Tokens are never logged or put in URLs.
 */

export interface Account {
  id: string;
  kind: "stoat" | "demo";
  name: string;
  avatarUrl?: string;
  /** API base URL for self-hosted instances; undefined = official */
  baseURL?: string;
  session?: StoredSession;
  /** Demo accounts only */
  persona?: number;
}

export interface Book {
  v: 1;
  active: string | null;
  accounts: Account[];
}

export const EMPTY_BOOK: Book = { v: 1, active: null, accounts: [] };
export const BOOK_KEY = "mustela:accounts";
export const MAX_ACCOUNTS = 12;

export const stoatAccountId = (userId: string, baseURL?: string) => `${normalizeBase(baseURL) ?? "official"}#${userId}`;
export const demoAccountId = (persona: number) => `demo#${persona}`;

/** https only, except localhost for development. Returns undefined for the official instance. */
export function normalizeBase(raw: string | undefined | null): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return undefined;
    if (u.username || u.password) return undefined;
    return (u.origin + u.pathname).replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

const str = (x: unknown, max: number) => (typeof x === "string" && x.length > 0 && x.length <= max ? x : null);

function sanitizeAccount(raw: unknown): Account | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const id = str(r.id, 300), name = str(r.name, 100);
  if (!id || !name) return null;
  if (r.kind === "demo") {
    return { id, kind: "demo", name, persona: typeof r.persona === "number" ? Math.max(0, Math.min(9, Math.round(r.persona))) : 0 };
  }
  if (r.kind !== "stoat") return null;
  const s = r.session;
  const session = s && str(s._id, 100) && str(s.token, 500) && str(s.user_id, 100)
    ? { _id: s._id as string, token: s.token as string, user_id: s.user_id as string } : undefined;
  if (!session) return null; // a stoat account without a session can't do anything
  const avatar = typeof r.avatarUrl === "string" && /^https:\/\//.test(r.avatarUrl) && r.avatarUrl.length < 600 ? r.avatarUrl : undefined;
  return { id, kind: "stoat", name, avatarUrl: avatar, baseURL: normalizeBase(r.baseURL), session };
}

export function parseBook(json: string | null | undefined): Book {
  if (!json) return { ...EMPTY_BOOK, accounts: [] };
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object" || raw.v !== 1 || !Array.isArray(raw.accounts)) return { ...EMPTY_BOOK, accounts: [] };
    const seen = new Set<string>();
    const accounts: Account[] = [];
    for (const a of raw.accounts) {
      const acc = sanitizeAccount(a);
      if (acc && !seen.has(acc.id) && accounts.length < MAX_ACCOUNTS) { seen.add(acc.id); accounts.push(acc); }
    }
    const active = typeof raw.active === "string" && seen.has(raw.active) ? raw.active : accounts[0]?.id ?? null;
    return { v: 1, active, accounts };
  } catch {
    return { ...EMPTY_BOOK, accounts: [] };
  }
}

/** Add or refresh an account (same id = same person on the same instance) and make it active. */
export function addAccount(book: Book, acc: Account): Book {
  const rest = book.accounts.filter((a) => a.id !== acc.id);
  const accounts = [...rest, acc].slice(-MAX_ACCOUNTS);
  return { v: 1, active: acc.id, accounts };
}

export function removeAccount(book: Book, id: string): Book {
  const accounts = book.accounts.filter((a) => a.id !== id);
  const active = book.active === id ? accounts[0]?.id ?? null : book.active;
  return { v: 1, active, accounts };
}

export function setActive(book: Book, id: string): Book {
  return book.accounts.some((a) => a.id === id) ? { ...book, active: id } : book;
}

export function updateAccount(book: Book, id: string, patch: Partial<Pick<Account, "name" | "avatarUrl" | "session">>): Book {
  return { ...book, accounts: book.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

type KV = Pick<Storage, "getItem" | "setItem">;

export function loadBook(kv: KV): Book {
  try { return parseBook(kv.getItem(BOOK_KEY)); } catch { return { ...EMPTY_BOOK, accounts: [] }; }
}

export function saveBook(kv: KV, b: Book): void {
  try { kv.setItem(BOOK_KEY, JSON.stringify(b)); } catch { /* storage unavailable: stay signed in for this run only */ }
}

export const activeAccount = (b: Book) => b.accounts.find((a) => a.id === b.active) ?? null;
