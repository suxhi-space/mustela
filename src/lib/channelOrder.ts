import type { CategoryInfo } from "./backend/types";

/**
 * Rearranging a server's channel list the way Stoat stores it: categories in order, each
 * with its channels in order. Channels in no category sit above them all (Stoat has no
 * order for those), so dropping there just takes a channel out of its category.
 */

/** Moves a channel before `before` (a channel id), or to the end of category `into` (null: out of every category). */
export function moveChannel(cats: CategoryInfo[], id: string, target: { before: string } | { into: string | null }): CategoryInfo[] {
  const out = cats.map((c) => ({ ...c, channels: c.channels.filter((x) => x !== id) }));
  if ("before" in target) {
    const cat = out.find((c) => c.channels.includes(target.before));
    if (cat) cat.channels.splice(cat.channels.indexOf(target.before), 0, id);
    return out;
  }
  if (target.into) out.find((c) => c.id === target.into)?.channels.push(id);
  return out;
}

/** Moves a category before another one, or to the end. */
export function moveCategory(cats: CategoryInfo[], id: string, before: string | null): CategoryInfo[] {
  const cat = cats.find((c) => c.id === id);
  if (!cat || id === before) return cats;
  const rest = cats.filter((c) => c.id !== id);
  const at = before ? rest.findIndex((c) => c.id === before) : -1;
  return at < 0 ? [...rest, cat] : [...rest.slice(0, at), cat, ...rest.slice(at)];
}
