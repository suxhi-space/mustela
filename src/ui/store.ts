import { setTimePrefs } from "../lib/time";
import { batch, createEffect, createRoot, createSignal } from "solid-js";
import type { ChatBackend, StoredSession } from "../lib/backend/types";
import { DemoBackend } from "../lib/backend/mock";
import { AnimationBudget } from "../lib/decor/rating";
import { parseHex } from "../lib/color";
import { DEFAULT_DEVICE, DENSITY_VARS, sanitizeDevice, type DeviceSettings } from "../lib/device";
import { detectPlatform, inTauri } from "../lib/platform";
import {
  activeAccount, addAccount, demoAccountId, loadBook, normalizeBase, removeAccount, saveBook, setActive,
  stoatAccountId, updateAccount, type Account, type Book,
} from "../lib/session/book";
import { revokeSession } from "../lib/session/revoke";
import { DEFAULT_SETTINGS, parseRemote, resolve, sanitize, type MustelaSettings } from "../lib/sync/settings";
import { buildRoles, getTheme, gradientEnd, toCssVars } from "../lib/theme/palette";
import { getSystemSeed } from "../lib/theme/system";

/* ---------- storage (every access is guarded: private mode, quota, blocked) ---------- */
const kv = {
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* run without persistence */ } },
};
const DEVICE_KEY = "mustela:device";
const BACKDROP_KEY = "mustela:backdrop-image";
const settingsKey = (accountId: string) => `mustela:settings:${accountId}`;

export const platform = detectPlatform();

/* ---------- state ---------- */
export type Phase = "boot" | "login" | "connecting" | "ready" | "error";

export const [phase, setPhase] = createSignal<Phase>("boot");
export const [error, setError] = createSignal("");
export const [book, setBookSig] = createSignal<Book>(loadBook(kv));
export const [backend, setBackend] = createSignal<ChatBackend | null>(null);
const [settings, setSettingsRaw] = createSignal<MustelaSettings>(structuredClone(DEFAULT_SETTINGS));
export { settings };
/** Every settings change passes through here so non-UI helpers (time formatting) stay in step. */
export const setSettings = (s: MustelaSettings) => { setTimePrefs(s.locale); return setSettingsRaw(s); };
export const [device, setDevice] = createSignal<DeviceSettings>(sanitizeDevice(safeJson(kv.getItem(DEVICE_KEY))));
export const [syncState, setSyncState] = createSignal<"local" | "syncing" | "synced" | "error">("local");
export const [systemSeed, setSystemSeed] = createSignal<string | null>(null);
export const [materials, setMaterials] = createSignal<string[]>([]);
/** Surface color as 0xRRGGBB, so names can be made readable against it. */
export const [surfaceInt, setSurfaceInt] = createSignal(0x1b1b1f);
export const [addingAccount, setAddingAccount] = createSignal(false);
/** Your backdrop picture as a data URL (kept on this device only). */
export const [backdropImage, setBackdropImageSig] = createSignal<string | null>(kv.getItem(BACKDROP_KEY));

/** Downscales a picture to at most 1920px and stores it. Returns false if it couldn't be saved. */
export async function setBackdropImage(file: File | null): Promise<boolean> {
  if (!file) { try { localStorage.removeItem(BACKDROP_KEY); } catch { /* ignore */ } setBackdropImageSig(null); return true; }
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", 0.82);
  try { localStorage.setItem(BACKDROP_KEY, url); } catch { return false; }
  setBackdropImageSig(url);
  return true;
}
/** Bumped when my own account changes, so name/avatar/status redraw. */
const [meTick, setMeTick] = createSignal(0);
export const bumpMe = () => setMeTick((n) => n + 1);
export const meNow = () => { meTick(); const b = backend(); return b ? { ...b.me } : null; };

/** One animation budget for the whole window, so a crowded list can't melt the GPU. */
export const budget = new AnimationBudget();

function safeJson(s: string | null): unknown { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function commitBook(b: Book) { setBookSig(b); saveBook(kv, b); }

/* ---------- settings: synced (look + profile) vs device (density, material, ...) ---------- */
let syncTimer: ReturnType<typeof setTimeout> | undefined;

function persistSettings(s: MustelaSettings) {
  const a = activeAccount(book());
  if (a) kv.setItem(settingsKey(a.id), JSON.stringify(s));
}

function applyLimits(s: MustelaSettings) { budget.setLimits({ maxRating: s.maxRating, budget: 260 }); }

export function updateSettings(fn: (s: MustelaSettings) => MustelaSettings) {
  const next = sanitize({ ...fn(settings()), updatedAt: Date.now() });
  setSettings(next);
  persistSettings(next);
  applyLimits(next);
  const b = backend();
  if (!b) return;
  clearTimeout(syncTimer);
  setSyncState("syncing");
  syncTimer = setTimeout(async () => {
    try { await b.pushSettings(settings()); setSyncState("synced"); } catch { setSyncState("error"); }
  }, 1500); // debounce: dragging a slider shouldn't hit the API on every tick
}

export function updateDevice(patch: Partial<DeviceSettings>) {
  const next = sanitizeDevice({ ...device(), ...patch });
  setDevice(next);
  kv.setItem(DEVICE_KEY, JSON.stringify(next));
}

/* ---------- accounts ---------- */
function adopt(acc: Account, b: ChatBackend) {
  clearTimeout(syncTimer);
  const prev = backend();
  if (prev && prev !== b) prev.dispose();
  const me = b.me;
  const avatar = me.avatarUrl && /^https:\/\//.test(me.avatarUrl) ? me.avatarUrl : undefined;
  const nextBook = addAccount(book(), { ...acc, name: me.name || acc.name, avatarUrl: avatar ?? acc.avatarUrl });
  batch(() => {
    commitBook(nextBook);
    const local = parseRemote(kv.getItem(settingsKey(acc.id))) ?? structuredClone(DEFAULT_SETTINGS);
    setSettings(local);
    applyLimits(local);
    setBackend(b);
    setError("");
    setAddingAccount(false);
    setPhase("ready");
    setSyncState("syncing");
  });
  // Merge with what the account has on the server, in the background.
  void (async () => {
    try {
      const remote = await b.pullSettings();
      if (backend() !== b) return; // switched away meanwhile
      const { winner, push } = resolve(settings(), remote);
      setSettings(winner); persistSettings(winner); applyLimits(winner);
      if (push) await b.pushSettings(winner);
      setSyncState("synced");
    } catch { if (backend() === b) setSyncState("error"); }
  })();
}

async function connect(acc: Account): Promise<ChatBackend> {
  if (acc.kind === "demo") return new DemoBackend(acc.persona ?? 0);
  const { StoatBackend } = await import("../lib/backend/stoat"); // SDK loads only for real accounts
  return StoatBackend.open(acc.baseURL, acc.session!);
}

export async function openAccount(acc: Account) {
  setPhase("connecting");
  setError("");
  try {
    adopt(acc, await connect(acc));
  } catch (e) {
    setError(e instanceof Error && e.message ? e.message : "Couldn't connect. Try again.");
    commitBook(setActive(book(), acc.id));
    setPhase("error");
  }
}

export const switchAccount = (id: string) => {
  const acc = book().accounts.find((a) => a.id === id);
  if (acc && acc.id !== book().active) return openAccount(acc);
  return Promise.resolve();
};

/** After a successful password (+MFA) login. Opens the connection and adds the account. */
export async function addStoatAccount(session: StoredSession, baseURL?: string) {
  const base = normalizeBase(baseURL);
  const { StoatBackend } = await import("../lib/backend/stoat");
  const b = await StoatBackend.open(base, session); // throws a friendly Error the login form shows
  adopt({ id: stoatAccountId(session.user_id, base), kind: "stoat", name: b.me.name, baseURL: base, session }, b);
}

export function enterDemo() {
  const have = new Set(book().accounts.filter((a) => a.kind === "demo").map((a) => a.persona));
  const persona = have.has(0) ? 1 : 0;
  const acc: Account = { id: demoAccountId(persona), kind: "demo", name: persona === 0 ? "You" : "Moonbeam", persona };
  adopt(acc, new DemoBackend(persona));
}

export async function removeAccountById(id: string) {
  const acc = book().accounts.find((a) => a.id === id);
  if (!acc) return;
  if (acc.kind === "stoat" && acc.session) void revokeSession(acc.baseURL, acc.session);
  kv.setItem(settingsKey(id), "");
  const next = removeAccount(book(), id);
  commitBook(next);
  if (book().active !== id && backend() && activeAccount(book())?.id === next.active) return; // removed a background account
  const nextActive = activeAccount(next);
  const cur = backend();
  if (nextActive) { await openAccount(nextActive); }
  else { cur?.dispose(); batch(() => { setBackend(null); setSettings(structuredClone(DEFAULT_SETTINGS)); setPhase("login"); }); }
}

export function refreshAccountCard() {
  const a = activeAccount(book()), b = backend();
  if (a && b) commitBook(updateAccount(book(), a.id, { name: b.me.name }));
}

export async function boot() {
  if (inTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setMaterials(await invoke<string[]>("material_support"));
    } catch { /* older shell: no materials */ }
  }
  void refreshSystemSeed();
  addEventListener("focus", () => void refreshSystemSeed()); // the OS accent may have changed while we were away
  const acc = activeAccount(book());
  if (!acc) { setPhase("login"); return; }
  await openAccount(acc);
}

/** Pop-out window only: read the active account's saved look so it matches the main window. */
export function loadLocalAppearance() {
  const a = activeAccount(book());
  const raw = a ? safeJson(kv.getItem(settingsKey(a.id))) : null;
  if (raw) setSettings(sanitize(raw));
}

export async function refreshSystemSeed() { setSystemSeed(await getSystemSeed()); }

/* ---------- appearance: roles -> CSS variables, density, material ---------- */
export function startAppearance() {
  createRoot(() => {
    // Keep the backend's sync-server list in step with settings.
    createEffect(() => { const b = backend(); if (b) b.cloud.setServers(settings().cloud.servers); });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const [sysDark, setSysDark] = createSignal(mq.matches);
    mq.addEventListener("change", (e) => setSysDark(e.matches));
    const root = document.documentElement;
    root.dataset.platform = platform;
    if (inTauri()) root.classList.add("tauri");
    if (inTauri() && (platform === "windows" || platform === "mac" || platform === "linux")) root.dataset.titlebar = platform;

    createEffect(() => {
      const l = settings().look, d = device();
      const sys = d.colorSource === "system" ? systemSeed() : null;
      const def = getTheme(l.theme);
      const seed = sys ?? (l.theme === "custom" ? l.seed : def.seed);
      const neutral = !sys && l.theme !== "custom" && !!def.neutral;
      const dark = l.mode === "auto" ? sysDark() : l.mode === "dark";
      const opts = { amoled: l.amoled, neutral, variant: l.variant, contrast: l.contrast };
      const roles = buildRoles(seed, dark ? "dark" : "light", opts);
      for (const [k, v] of Object.entries(toCssVars(roles))) root.style.setProperty(k, v);
      // Accent gradient: primary fills run from the primary into a second color at the same tone.
      if (l.gradient.on) {
        const end = gradientEnd(l.gradient.seed2, dark ? "dark" : "light", opts);
        root.style.setProperty("--pri-2", end);
        root.style.setProperty("--pri-grad", `linear-gradient(${l.gradient.angle}deg, ${roles.primary}, ${end})`);
        root.dataset.gradient = "";
      } else { root.style.removeProperty("--pri-grad"); root.style.removeProperty("--pri-2"); delete root.dataset.gradient; }
      root.dataset.mode = dark ? "dark" : "light";
      setSurfaceInt(parseHex(roles.surfaceContainerLow!) ?? 0x1b1b1f);
    });

    createEffect(() => {
      const d = device();
      root.dataset.style = d.style;
      const img = backdropImage();
      root.dataset.backdrop = d.backdrop === "image" && !img ? "stars" : d.backdrop;
      if (d.backdrop === "image" && img) root.style.setProperty("--backdrop-img", `url("${img}")`); else root.style.removeProperty("--backdrop-img");
      root.dataset.layout = d.layout;
      for (const [k, v] of Object.entries(DENSITY_VARS[d.density])) root.style.setProperty(k, v);
      // Stoat's "Display & Text": message size and the gap between message groups.
      root.style.setProperty("--msg-font", `${d.text.size}px`);
      root.style.setProperty("--msg-gap", `${d.text.spacing}px`);
      if (d.text.font) root.dataset.font = d.text.font; else root.removeAttribute("data-font");
    });

    createEffect(() => {
      const { material: m, opacity } = device();
      const allowed = m !== "none" && (materials().includes(m) || !inTauri());
      if (allowed) root.dataset.material = m; else root.removeAttribute("data-material");
      root.style.setProperty("--op", String(opacity));
      if (inTauri()) {
        void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_material", { kind: allowed ? m : "none" })).catch(() => {});
      }
    });
  });
}

export { DEFAULT_DEVICE };
