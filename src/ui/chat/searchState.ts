import { createSignal } from "solid-js";
import type { Person } from "../../lib/backend/types";

/**
 * Computers have one search box, in the chat's top bar, like Discord. What's typed there is shared with the results
 * panel (its Filters window writes into it too), and the panel shares the people filters can name.
 */
export const [searchDraft, setSearchDraft] = createSignal("");
export const [searchPeople, setSearchPeople] = createSignal<Person[]>([]);

const KEY = "mustela.searchHistory";
const read = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : []; } catch { return []; } };
const [history, setHistory] = createSignal<string[]>(read());
/** Your last few searches (on this device), newest first. */
export const searchHistory = history;
export function rememberSearch(q: string) {
  q = q.trim();
  if (!q) return;
  const next = [q, ...history().filter((x) => x !== q)].slice(0, 5);
  setHistory(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
}
export function clearSearchHistory() { setHistory([]); try { localStorage.removeItem(KEY); } catch { /* blocked */ } }
