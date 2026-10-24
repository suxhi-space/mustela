import { argbFromHex, hexFromArgb, themeFromSourceColor, TonalPalette } from "@material/material-color-utilities";

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

interface Palettes {
  primary: TonalPalette; secondary: TonalPalette; tertiary: TonalPalette;
  neutral: TonalPalette; neutralVariant: TonalPalette; error: TonalPalette;
}

function palettesFor(seedHex: string, neutral: boolean): Palettes {
  const t = themeFromSourceColor(argbFromHex(seedHex));
  const p = t.palettes;
  if (!neutral) return p as Palettes;
  const hue = p.primary.hue;
  return {
    primary: TonalPalette.fromHueAndChroma(hue, 10),
    secondary: TonalPalette.fromHueAndChroma(hue, 6),
    tertiary: TonalPalette.fromHueAndChroma(hue + 60, 10),
    neutral: TonalPalette.fromHueAndChroma(hue, 2),
    neutralVariant: TonalPalette.fromHueAndChroma(hue, 4),
    error: p.error,
  };
}

export interface BuildOptions {
  /** Pure-black surfaces in dark mode (OLED). */
  amoled?: boolean;
  neutral?: boolean;
}

export function buildRoles(seedHex: string, mode: Mode, opts: BuildOptions = {}): Roles {
  const P = palettesFor(seedHex, !!opts.neutral);
  const h = (p: TonalPalette, tone: number) => hexFromArgb(p.tone(tone));
  const dark = mode === "dark";
  const r: Roles = dark
    ? {
        primary: h(P.primary, 80), onPrimary: h(P.primary, 20),
        primaryContainer: h(P.primary, 30), onPrimaryContainer: h(P.primary, 90),
        secondary: h(P.secondary, 80), onSecondary: h(P.secondary, 20),
        secondaryContainer: h(P.secondary, 30), onSecondaryContainer: h(P.secondary, 90),
        tertiary: h(P.tertiary, 80), onTertiary: h(P.tertiary, 20),
        tertiaryContainer: h(P.tertiary, 30), onTertiaryContainer: h(P.tertiary, 90),
        error: h(P.error, 80), onError: h(P.error, 20),
        errorContainer: h(P.error, 30), onErrorContainer: h(P.error, 90),
        surface: h(P.neutral, 6), onSurface: h(P.neutral, 90),
        surfaceVariant: h(P.neutralVariant, 30), onSurfaceVariant: h(P.neutralVariant, 80),
        surfaceContainerLowest: h(P.neutral, 4), surfaceContainerLow: h(P.neutral, 10),
        surfaceContainer: h(P.neutral, 12), surfaceContainerHigh: h(P.neutral, 17),
        surfaceContainerHighest: h(P.neutral, 22),
        outline: h(P.neutralVariant, 60), outlineVariant: h(P.neutralVariant, 30),
        inverseSurface: h(P.neutral, 90), inverseOnSurface: h(P.neutral, 20),
      }
    : {
        primary: h(P.primary, 40), onPrimary: h(P.primary, 100),
        primaryContainer: h(P.primary, 90), onPrimaryContainer: h(P.primary, 10),
        secondary: h(P.secondary, 40), onSecondary: h(P.secondary, 100),
        secondaryContainer: h(P.secondary, 90), onSecondaryContainer: h(P.secondary, 10),
        tertiary: h(P.tertiary, 40), onTertiary: h(P.tertiary, 100),
        tertiaryContainer: h(P.tertiary, 90), onTertiaryContainer: h(P.tertiary, 10),
        error: h(P.error, 40), onError: h(P.error, 100),
        errorContainer: h(P.error, 90), onErrorContainer: h(P.error, 10),
        surface: h(P.neutral, 98), onSurface: h(P.neutral, 10),
        surfaceVariant: h(P.neutralVariant, 90), onSurfaceVariant: h(P.neutralVariant, 30),
        surfaceContainerLowest: h(P.neutral, 100), surfaceContainerLow: h(P.neutral, 96),
        surfaceContainer: h(P.neutral, 94), surfaceContainerHigh: h(P.neutral, 92),
        surfaceContainerHighest: h(P.neutral, 90),
        outline: h(P.neutralVariant, 50), outlineVariant: h(P.neutralVariant, 80),
        inverseSurface: h(P.neutral, 20), inverseOnSurface: h(P.neutral, 95),
      };
  if (dark && opts.amoled) {
    Object.assign(r, {
      surface: "#000000", surfaceContainerLowest: "#000000", surfaceContainerLow: "#0a0a0a",
      surfaceContainer: "#101010", surfaceContainerHigh: "#181818", surfaceContainerHighest: "#212121",
    });
  }
  return r;
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
