import { describe, expect, it } from "vitest";
import { addAccount, BOOK_KEY, EMPTY_BOOK, loadBook, MAX_ACCOUNTS, normalizeBase, parseBook, removeAccount, saveBook, setActive, stoatAccountId, updateAccount, activeAccount, type Account, type Book } from "./book";
import { createLimiter } from "../limit";
import { loginErrorMessage } from "../backend/login";

const acc = (n: number, base?: string): Account => ({
  id: stoatAccountId(`u${n}`, base), kind: "stoat", name: `User ${n}`, baseURL: base,
  session: { _id: `s${n}`, token: `tok${n}`, user_id: `u${n}` },
});

describe("account book", () => {
  it("adds, makes active, and dedupes the same account", () => {
    let b: Book = { ...EMPTY_BOOK, accounts: [] };
    b = addAccount(b, acc(1));
    b = addAccount(b, acc(2));
    expect(b.active).toBe(acc(2).id);
    b = addAccount(b, { ...acc(1), name: "Renamed", session: { _id: "new", token: "newtok", user_id: "u1" } });
    expect(b.accounts.length).toBe(2);
    expect(b.accounts.find((a) => a.id === acc(1).id)).toMatchObject({ name: "Renamed", session: { token: "newtok" } });
    expect(b.active).toBe(acc(1).id);
  });

  it("same user id on a different instance is a different account", () => {
    expect(stoatAccountId("u1")).not.toBe(stoatAccountId("u1", "https://chat.example.com/api"));
  });

  it("removing the active account falls back to another, and the last one leaves none", () => {
    let b = addAccount(addAccount({ ...EMPTY_BOOK, accounts: [] }, acc(1)), acc(2));
    b = removeAccount(b, acc(2).id);
    expect(b.active).toBe(acc(1).id);
    b = removeAccount(b, acc(1).id);
    expect(b).toEqual({ v: 1, active: null, accounts: [] });
    expect(activeAccount(b)).toBeNull();
  });

  it("removing a non-active account keeps the active one", () => {
    let b = addAccount(addAccount({ ...EMPTY_BOOK, accounts: [] }, acc(1)), acc(2));
    b = removeAccount(b, acc(1).id);
    expect(b.active).toBe(acc(2).id);
  });

  it("setActive ignores unknown ids; updateAccount patches only the target", () => {
    let b = addAccount(addAccount({ ...EMPTY_BOOK, accounts: [] }, acc(1)), acc(2));
    expect(setActive(b, "nope")).toBe(b);
    b = setActive(b, acc(1).id);
    expect(b.active).toBe(acc(1).id);
    b = updateAccount(b, acc(2).id, { name: "X" });
    expect(b.accounts.map((a) => a.name)).toEqual(["User 1", "X"]);
  });

  it("caps the number of accounts", () => {
    let b: Book = { ...EMPTY_BOOK, accounts: [] };
    for (let i = 0; i < MAX_ACCOUNTS + 5; i++) b = addAccount(b, acc(i));
    expect(b.accounts.length).toBe(MAX_ACCOUNTS);
    expect(b.active).toBe(acc(MAX_ACCOUNTS + 4).id);
  });

  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const b = addAccount(addAccount({ ...EMPTY_BOOK, accounts: [] }, acc(1)), { id: "demo#0", kind: "demo", name: "You", persona: 0 });
    saveBook(kv, b);
    expect(loadBook(kv)).toEqual(b);
    expect(store.has(BOOK_KEY)).toBe(true);
  });

  it("survives corrupted or hostile storage", () => {
    for (const j of [null, "", "{", "[]", JSON.stringify({ v: 9 }), JSON.stringify({ v: 1, accounts: "x" })]) {
      expect(parseBook(j)).toEqual({ v: 1, active: null, accounts: [] });
    }
    const hostile = JSON.stringify({
      v: 1, active: "ghost",
      accounts: [
        { id: "a", kind: "stoat", name: "ok", session: { _id: "1", token: "t", user_id: "u" }, baseURL: "javascript:alert(1)", avatarUrl: "javascript:x" },
        { id: "b", kind: "stoat", name: "no session" },
        { id: "c", kind: "weird", name: "x" },
        { id: "a", kind: "stoat", name: "dupe", session: { _id: "1", token: "t", user_id: "u" } },
        { id: "d", kind: "stoat", name: "x".repeat(500), session: { _id: "1", token: "t", user_id: "u" } },
        null, 5,
      ],
    });
    const b = parseBook(hostile);
    expect(b.accounts.map((a) => a.id)).toEqual(["a"]);
    expect(b.accounts[0]!.baseURL).toBeUndefined();
    expect(b.accounts[0]!.avatarUrl).toBeUndefined();
    expect(b.active).toBe("a"); // unknown active falls back to the first
  });

  it("storage that throws doesn't crash", () => {
    const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    expect(loadBook(bad)).toEqual({ v: 1, active: null, accounts: [] });
    expect(() => saveBook(bad, EMPTY_BOOK)).not.toThrow();
  });
});

describe("instance address", () => {
  it("accepts https, trims trailing slashes, rejects the rest", () => {
    expect(normalizeBase("https://chat.example.com/api/")).toBe("https://chat.example.com/api");
    expect(normalizeBase("")).toBeUndefined();
    expect(normalizeBase(undefined)).toBeUndefined();
    expect(normalizeBase("http://evil.example.com")).toBeUndefined(); // tokens must not go over plain http
    expect(normalizeBase("ftp://x")).toBeUndefined();
    expect(normalizeBase("https://user:pw@x.com")).toBeUndefined();
    expect(normalizeBase("not a url")).toBeUndefined();
  });
  it("allows http only for localhost development", () => {
    expect(normalizeBase("http://localhost:8000")).toBe("http://localhost:8000");
    expect(normalizeBase("http://127.0.0.1:8000/api")).toBe("http://127.0.0.1:8000/api");
  });
});

describe("login errors", () => {
  it("maps known types to friendly text and never echoes unknown server text", () => {
    expect(loginErrorMessage("InvalidCredentials")).toMatch(/email or password/);
    expect(loginErrorMessage("UnverifiedAccount")).toMatch(/Verify/);
    expect(loginErrorMessage("<script>alert(1)</script>")).toBe("Couldn't sign in. Check your details and instance address.");
    expect(loginErrorMessage(undefined, 429)).toMatch(/Too many/);
    expect(loginErrorMessage(undefined, 503)).toMatch(/server/);
  });
});

describe("limiter", () => {
  it("never runs more than n at once, finishes everything, preserves order of start", async () => {
    const limit = createLimiter(3);
    let active = 0, peak = 0;
    const started: number[] = [];
    const jobs = Array.from({ length: 12 }, (_, i) => limit(async () => {
      started.push(i); active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return i;
    }));
    expect(await Promise.all(jobs)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBe(3);
    expect(started).toEqual([...started].sort((a, b) => a - b));
  });
  it("a rejected job doesn't block the queue", async () => {
    const limit = createLimiter(1);
    const a = limit(async () => { throw new Error("x"); });
    const b = limit(async () => 7);
    await expect(a).rejects.toThrow();
    expect(await b).toBe(7);
  });
});
