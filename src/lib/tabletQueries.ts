/**
 * Phones and tablets build: a tablet held upright (up to 1100px wide) gets the phone layout, one screen at a time with
 * swipes, cards from the bottom and touch sizes, like Discord's tablet app; sideways it keeps the side-by-side layout.
 * Every media query is adjusted the same way, in the styles at build time (vite.config.ts) and in code (hooks.ts):
 * "narrow" queries (max-width 700 to 1099px) also match an upright tablet, and "wide" ones (min-width 701 to 1100px)
 * then need the tablet sideways or a screen wider than 1100px.
 */
export const TABLET_LIMIT = 1100;

export function adaptMedia(prelude: string): string {
  return prelude.split(",").flatMap((raw) => {
    const q = raw.trim();
    if (!q) return [];
    let out = [q];
    const max = /\(max-width:\s*(\d+)px\)/.exec(q);
    if (max && +max[1]! >= 700 && +max[1]! < TABLET_LIMIT && !/orientation/.test(q)) out.push(q.replace(max[0], `(max-width: ${TABLET_LIMIT}px) and (orientation: portrait)`));
    const min = /\(min-width:\s*(\d+)px\)/.exec(q);
    if (min && +min[1]! > 700 && +min[1]! <= TABLET_LIMIT) out = out.flatMap((x) => [`${x} and (orientation: landscape)`, x.replace(min[0], `(min-width: ${TABLET_LIMIT + 1}px)`)]);
    return out;
  }).join(", ");
}

/** Every @media rule in a stylesheet, adjusted. */
export const adaptCss = (css: string) => css.replace(/@media([^{;]+)\{/g, (_all, p: string) => `@media ${adaptMedia(p)} {`);
