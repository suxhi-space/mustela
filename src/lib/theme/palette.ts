import {
  argbFromHex, DynamicScheme, Hct, hexFromArgb, MaterialDynamicColors,
  SchemeContent, SchemeExpressive, SchemeFidelity, SchemeFruitSalad, SchemeMonochrome, SchemeNeutral, SchemeRainbow, SchemeTonalSpot, SchemeVibrant,
} from "@material/material-color-utilities";

/**
 * Material You (M3) color roles from a single seed color.
 *
 * Tone numbers below are the M3 baseline mapping. Using the official tonal
 * palette generator means the colors match what Android 12+ produces for
 * "dynamic color", and contrast is guaranteed by the tone gaps (tested).
 */

export interface ThemeDef {
  id: string;
  name: string;
  seed: string;
  /** Low-chroma palettes for a near-neutral look. */
  neutral?: boolean;
}

export const THEMES: ThemeDef[] = [
  { id: "lagoon", name: "Lagoon", seed: "#1A9BB0" },
  { id: "cobalt", name: "Cobalt", seed: "#3E6EB4" },
  { id: "sakura", name: "Sakura", seed: "#C94F7C" },
  { id: "moss", name: "Moss", seed: "#4D7C4A" },
  { id: "amber", name: "Amber", seed: "#B7791F" },
  { id: "teal", name: "Teal", seed: "#1F8A8A" },
  { id: "plum", name: "Plum", seed: "#7B4FA0" },
  { id: "coral", name: "Coral", seed: "#D2573F" },
  { id: "graphite", name: "Graphite", seed: "#6B7480", neutral: true },
];

export const DEFAULT_THEME = "lagoon";
export type Mode = "light" | "dark";
export type Roles = Record<string, string>;

export function getTheme(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

export type Variant = "tonal" | "vibrant" | "expressive" | "fidelity" | "content" | "neutral" | "monochrome" | "rainbow" | "fruit";

export interface BuildOptions {
  /** Pure-black surfaces in dark mode (OLED). */
  amoled?: boolean;
  /** Theme asks for a near-neutral look (Graphite) */
  neutral?: boolean;
  /** Material You scheme style; default Tonal Spot (what Android uses) */
  variant?: Variant;
  /** -1 reduced, 0 normal, 0.5 more, 1 high */
  contrast?: number;
}

const SCHEMES: Record<Variant, new (hct: Hct, dark: boolean, contrast: number) => DynamicScheme> = {
  tonal: SchemeTonalSpot, vibrant: SchemeVibrant, expressive: SchemeExpressive, fidelity: SchemeFidelity, content: SchemeContent,
  neutral: SchemeNeutral, monochrome: SchemeMonochrome, rainbow: SchemeRainbow, fruit: SchemeFruitSalad,
};

const ROLES = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "surface", "onSurface", "surfaceVariant", "onSurfaceVariant",
  "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest",
  "outline", "outlineVariant", "inverseSurface", "inverseOnSurface",
] as const;

/** The scheme for a seed, so a second color (gradients) can be read at the same tones. */
export function schemeFor(seedHex: string, mode: Mode, opts: BuildOptions = {}): DynamicScheme {
  const variant: Variant = opts.neutral && opts.variant !== "monochrome" ? "neutral" : opts.variant ?? "tonal";
  const contrast = Math.max(-1, Math.min(1, opts.contrast ?? 0));
  return new SCHEMES[variant](Hct.fromInt(argbFromHex(seedHex)), mode === "dark", contrast);
}

export function buildRoles(seedHex: string, mode: Mode, opts: BuildOptions = {}): Roles {
  const scheme = schemeFor(seedHex, mode, opts);
  const r: Roles = {};
  const M = MaterialDynamicColors as unknown as Record<string, { getArgb(s: DynamicScheme): number }>;
  for (const k of ROLES) r[k] = hexFromArgb(M[k]!.getArgb(scheme));
  if (mode === "dark" && opts.amoled) {
    Object.assign(r, {
      surface: "#000000", surfaceContainerLowest: "#000000", surfaceContainerLow: "#0a0a0a",
      surfaceContainer: "#101010", surfaceContainerHigh: "#181818", surfaceContainerHighest: "#212121",
    });
  }
  return r;
}

/** A second seed's primary at the first scheme's primary tone: the far end of an accent gradient. */
export function gradientEnd(seed2Hex: string, mode: Mode, opts: BuildOptions = {}): string {
  const s = schemeFor(seed2Hex, mode, opts);
  return hexFromArgb(MaterialDynamicColors.primary.getArgb(s));
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** { onPrimaryContainer: "#abc" } -> { "--md-on-primary-container": "#abc" } */
export function toCssVars(roles: Roles): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(roles)) out[`--md-${kebab(k)}`] = v;
  return out;
}

/** Foreground/background pairs that must stay readable. Used by tests. */
export const TEXT_PAIRS: [fg: string, bg: string][] = [
  ["onPrimary", "primary"], ["onPrimaryContainer", "primaryContainer"],
  ["onSecondary", "secondary"], ["onSecondaryContainer", "secondaryContainer"],
  ["onTertiary", "tertiary"], ["onTertiaryContainer", "tertiaryContainer"],
  ["onError", "error"], ["onErrorContainer", "errorContainer"],
  ["onSurface", "surface"], ["onSurface", "surfaceContainer"], ["onSurface", "surfaceContainerHighest"],
  ["onSurfaceVariant", "surface"], ["onSurfaceVariant", "surfaceContainerHigh"],
  ["inverseOnSurface", "inverseSurface"],
  ["primary", "surface"], ["primary", "surfaceContainerHigh"],
];
