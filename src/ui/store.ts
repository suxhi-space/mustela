import { setTimePrefs } from "../lib/time";
import { MOBILE_UI } from "./target";
import { batch, createEffect, createRoot, createSignal } from "solid-js";
import type { ChatBackend, StoredSession } from "../lib/backend/types";
import { AnimationBudget } from "../lib/decor/rating";
import { contrast, parseHex } from "../lib/color";
import { DEFAULT_DEVICE, DENSITY_VARS, sanitizeDevice, type DeviceSettings } from "../lib/device";
import { detectPlatform, inTauri } from "../lib/platform";
import {
  activeAccount, addAccount, demoAccountId, loadBook, normalizeBase, removeAccount, saveBook, setActive,
  stoatAccountId, type Account, type Book,
} from "../lib/session/book";
import { revokeSession } from "../lib/session/revoke";
import { startupMark } from "./perfLog";
import { clearSnapshot, loadSnapshot, saveSnapshot, snapshotBackend } from "../lib/backend/snapshot";
import { DEFAULT_SETTINGS, parseRemote, resolve, sanitize, type MustelaSettings } from "../lib/sync/settings";
import { DEFAULT_EXT, parseExt, sanitizeExt, type ExtSettings } from "../lib/sync/ext";
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
const extKey = (accountId: string) => `mustela:settings-ext:${accountId}`;

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
/** Newer synced settings (profile privacy and the like), under their own sync key; see lib/sync/ext.ts */
export const [ext, setExtSig] = createSignal<ExtSettings>(structuredClone(DEFAULT_EXT));
export const [device, setDevice] = createSignal<DeviceSettings>(sanitizeDevice(safeJson(kv.getItem(DEVICE_KEY))));
export const [syncState, setSyncState] = createSignal<"local" | "syncing" | "synced" | "error">("local");
export const [systemSeed, setSystemSeed] = createSignal<string | null>(null);
export const [materials, setMaterials] = createSignal<string[]>([]);
/** Surface color as 0xRRGGBB, so names can be made readable against it. */
export const [surfaceInt, setSurfaceInt] = createSignal(0x1b1b1f);
export const [addingAccount, setAddingAccount] = createSignal(false);
/** Shown from the saved copy while the connection opens (instant start): a small "Connecting…" pill. */
export const [warming, setWarming] = createSignal(false);
/** Your backdrop picture as a data URL (kept on this device only). */
export const [backdropImage, setBackdropImageSig] = createSignal<string | null>(kv.getItem(BACKDROP_KEY));

/** Downscales a picture to at most 1920px and stores it. Returns false if it couldn't be saved. */
export async function setBackdropImage(file: File | null): Promise<boolean> {
  if (!file) { try { localStorage.removeItem(BACKDROP_KEY); if (lookAccount) localStorage.removeItem(backdropKey(lookAccount)); } catch { /* ignore */ } setBackdropImageSig(null); return true; }
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", 0.82);
  try { localStorage.setItem(BACKDROP_KEY, url); if (lookAccount) localStorage.setItem(backdropKey(lookAccount), url); } catch { return false; }
  setBackdropImageSig(url);
  return true;
}
/** Uses a picture already saved on this device as the backdrop (a saved theme's). */
export function setBackdropDataUrl(url: string): boolean {
  try { localStorage.setItem(BACKDROP_KEY, url); if (lookAccount) localStorage.setItem(backdropKey(lookAccount), url); } catch { return false; }
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

let extTimer: ReturnType<typeof setTimeout> | undefined;
export function updateExt(fn: (s: ExtSettings) => ExtSettings) {
  const next = sanitizeExt({ ...fn(ext()), updatedAt: Date.now() });
  setExtSig(next);
  const a = activeAccount(book());
  if (a) kv.setItem(extKey(a.id), JSON.stringify(next));
  const b = backend();
  if (!b) return;
  clearTimeout(extTimer);
  extTimer = setTimeout(() => void b.pushExt(ext()).catch(() => {}), 1500);
}

/** Colours and theme in use: your account's, or this device's own when "Sync appearance" is off. */
export type Look = MustelaSettings["look"];
/** Phones and tablets that sync colors only with each other keep them in their own synced slot (lookPhone). */
const phoneSlot = () => MOBILE_UI && device().syncLook && device().lookKind;
export function look(): Look {
  const d = device();
  if (!d.syncLook && d.localLook) return sanitize({ look: d.localLook }).look;
  return phoneSlot() ? settings().lookPhone ?? settings().look : settings().look;
}
/** Changes colours and theme where they live (account, your phones', or this device). */
export function updateLook(patch: Partial<Look>) {
  if (!device().syncLook) return updateDevice({ localLook: { ...look(), ...patch } });
  if (phoneSlot()) updateSettings((s) => ({ ...s, lookPhone: { ...(s.lookPhone ?? s.look), ...patch } }));
  else updateSettings((s) => ({ ...s, look: { ...s.look, ...patch } }));
}
/**
 * Where this device's colors sync: "all" your devices, the same "kind" (phones and tablets, or computers), or
 * "none" (this device only). Switching starts from what you have now.
 */
export type LookSync = "all" | "kind" | "none";
export const lookSync = (): LookSync => (!device().syncLook ? "none" : device().lookKind ? "kind" : "all");
export function setLookSync(to: LookSync) {
  const now = look();
  if (to === "none") return updateDevice({ syncLook: false, lookKind: false, localLook: { ...now } });
  updateDevice({ syncLook: true, lookKind: to === "kind", localLook: null });
  // Phones starting their own synced look begin from the colors they have now.
  if (to === "kind" && MOBILE_UI && !settings().lookPhone) updateSettings((s) => ({ ...s, lookPhone: { ...now } }));
}

export function updateDevice(patch: Partial<DeviceSettings>) {
  const next = sanitizeDevice({ ...device(), ...patch });
  setDevice(next);
  kv.setItem(DEVICE_KEY, JSON.stringify(next));
  if (lookAccount && LOOK_KEYS.some((k) => k in patch)) saveLook(lookAccount);
}

/* ---------- look per account ----------
   What only changes how Mustela looks (backdrop and its picture, panel opacity and blur, material, where colours
   come from, whether the look follows your account) belongs to each account signed in on this device; things about
   the device itself (microphone and speakers, call engine, title bar, tray, notifications) stay shared. Each account
   starts from what the device had when it was first opened here. */
const LOOK_KEYS = ["backdrop", "backdropBlur", "panelOpacity", "panelBlur", "material", "opacity", "colorSource", "syncLook", "lookKind", "localLook"] as const;
const lookKey = (id: string) => `mustela:look:${id}`;
const backdropKey = (id: string) => `mustela:backdrop:${id}`;
/** The account whose look is showing (look changes are saved to it). */
let lookAccount: string | null = null;
function saveLook(id: string) {
  const d = device() as unknown as Record<string, unknown>;
  kv.setItem(lookKey(id), JSON.stringify(Object.fromEntries(LOOK_KEYS.map((k) => [k, d[k]]))));
}
/** Shows this account's look (or keeps the current one as its look, the first time). */
function useAccountLook(id: string) {
  if (lookAccount === id) return;
  lookAccount = id;
  const saved = safeJson(kv.getItem(lookKey(id))) as Partial<DeviceSettings> | null;
  if (!saved) { saveLook(id); const pic = backdropImage(); if (pic) kv.setItem(backdropKey(id), pic); return; }
  const next = sanitizeDevice({ ...device(), ...saved });
  setDevice(next);
  kv.setItem(DEVICE_KEY, JSON.stringify(next));
  setBackdropImageSig(kv.getItem(backdropKey(id)) ?? kv.getItem(BACKDROP_KEY));
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
    useAccountLook(acc.id);
    const local = parseRemote(kv.getItem(settingsKey(acc.id))) ?? structuredClone(DEFAULT_SETTINGS);
    setSettings(local);
    applyLimits(local);
    setBackend(b);
    setError("");
    setAddingAccount(false);
    setPhase("ready");
    setSyncState("syncing");
  });
  // The newer settings: local copy first, then whichever is newer.
  const localExt = parseExt(kv.getItem(extKey(acc.id))) ?? structuredClone(DEFAULT_EXT);
  setExtSig(localExt);
  const pullAll = () => {
    void b.pullExt().then((remote) => {
      if (backend() !== b) return;
      if (remote && remote.updatedAt > ext().updatedAt) { setExtSig(remote); kv.setItem(extKey(acc.id), JSON.stringify(remote)); }
      else if (ext().updatedAt > (remote?.updatedAt ?? 0)) void b.pushExt(ext()).catch(() => {});
    }).catch(() => {});
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
  };
  pullAll();
  // Coming back to the app (a phone left in the background for hours, a window on another desktop): changes made on
  // your other devices meanwhile come in, at most every 30 seconds.
  let lastPull = Date.now();
  const onBack = () => {
    if (backend() !== b) return void document.removeEventListener("visibilitychange", onBack);
    if (document.visibilityState !== "visible" || Date.now() - lastPull < 30_000) return;
    lastPull = Date.now();
    pullAll();
  };
  document.addEventListener("visibilitychange", onBack);
}

async function connect(acc: Account): Promise<ChatBackend> {
  if (acc.kind === "demo") { const { DemoBackend } = await import("../lib/backend/mock"); return new DemoBackend(acc.persona ?? 0); }
  const { StoatBackend } = await import("../lib/backend/stoat"); // SDK loads only for real accounts
  startupMark("connection code");
  return StoatBackend.open(acc.baseURL, acc.session!);
}

export async function openAccount(acc: Account) {
  setError("");
  // Instant start: shown straight away from the copy kept last time, while it connects in the background
  // (see lib/backend/snapshot.ts). The first time, or after signing in again, it connects first as before.
  const snap = acc.kind === "stoat" && acc.session ? loadSnapshot(acc.id) : null;
  if (snap) {
    const real = connect(acc);
    adopt(acc, snapshotBackend(snap, real, acc.session ?? null));
    setWarming(true);
    startupMark("shown from saved copy");
    try {
      const b = await real;
      setWarming(false);
      if (activeAccount(book())?.id !== acc.id) return; // switched away meanwhile
      startupMark("live");
      void saveSnapshot(acc.id, b);
      warmChats(b);
      dropDemos(acc);
    } catch (e) {
      // Couldn't connect (signed out elsewhere, server down…): the same error screen as before.
      setWarming(false);
      if (activeAccount(book())?.id !== acc.id) return;
      setError(e instanceof Error && e.message ? e.message : "Couldn't connect. Try again.");
      batch(() => { setBackend(null); setPhase("error"); });
    }
    return;
  }
  setPhase("connecting");
  try {
    const b = await connect(acc);
    adopt(acc, b);
    if (acc.kind === "stoat") { void saveSnapshot(acc.id, b); warmChats(b); }
    dropDemos(acc);
  } catch (e) {
    setError(e instanceof Error && e.message ? e.message : "Couldn't connect. Try again.");
    commitBook(setActive(book(), acc.id));
    setPhase("error");
  }
}

/**
 * Once connected, the chats you're most likely to open next (unread DMs and mentions first, then other unread
 * channels; at most 8) are loaded quietly in the background into the saved recent chats, so opening them is
 * instant. One at a time, a few seconds after connecting, so it never competes with what you're doing.
 */
function warmChats(b: ChatBackend) {
  const account = b.me.id; // the saved recent chats are kept per user (Chat.tsx)
  const activeAt = activeAccount(book())?.id;
  setTimeout(async () => {
    try {
      const { saveChat } = await import("../lib/chatCache");
      const spaces = await b.spaces();
      const score = (c: { kind: string; mentions?: number; unread?: boolean; muted?: boolean }) =>
        (c.muted ? -1 : 0) + (c.mentions ? 4 : 0) + (c.kind === "dm" || c.kind === "group" ? 2 : 0) + (c.unread ? 1 : 0);
      const picks = spaces.flatMap((s) => s.channels).filter((c) => c.kind !== "voice" && (c.unread || c.mentions) && !c.muted)
        .sort((x, y) => score(y) - score(x)).slice(0, 8);
      for (const c of picks) {
        if (activeAccount(book())?.id !== activeAt) return; // switched account meanwhile
        const msgs = await b.messages(c.id).catch(() => null);
        if (msgs?.length) saveChat(account, c.id, msgs);
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch { /* best effort: chats just load when opened */ }
  }, 3000);
}

/** Back on a real account: the demo was just for looking around, so it goes. */
function dropDemos(acc: Account) {
  if (acc.kind === "demo") return;
  const demos = book().accounts.filter((a) => a.kind === "demo" && a.id !== acc.id);
  if (demos.length) { let next = book(); for (const d of demos) { kv.setItem(settingsKey(d.id), ""); next = removeAccount(next, d.id); } commitBook(setActive(next, acc.id)); }
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
  const id = stoatAccountId(session.user_id, base);
  adopt({ id, kind: "stoat", name: b.me.name, baseURL: base, session }, b);
  void saveSnapshot(id, b);
}

export async function enterDemo() {
  const { DemoBackend } = await import("../lib/backend/mock"); // only for the demo
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
  clearSnapshot(id); // signed out: nothing of this account is shown on the next start
  try { localStorage.removeItem(lookKey(id)); localStorage.removeItem(backdropKey(id)); } catch { /* fine */ }
  if (lookAccount === id) lookAccount = null;
  const next = removeAccount(book(), id);
  commitBook(next);
  if (book().active !== id && backend() && activeAccount(book())?.id === next.active) return; // removed a background account
  const nextActive = activeAccount(next);
  const cur = backend();
  if (nextActive) { await openAccount(nextActive); }
  else { cur?.dispose(); batch(() => { setBackend(null); setSettings(structuredClone(DEFAULT_SETTINGS)); setPhase("login"); }); }
}

export async function boot() {
  startupMark("boot");
  const acc = activeAccount(book());
  // Connecting comes first: nothing below needs to finish before it starts (it used to wait for them).
  const opening = acc ? openAccount(acc) : (setPhase("login"), Promise.resolve());
  if (inTauri()) {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<string[]>("material_support")).then(setMaterials).catch(() => { /* older shell: no materials */ });
  }
  void refreshSystemSeed();
  addEventListener("focus", () => void refreshSystemSeed()); // the OS accent may have changed while we were away
  await opening;
}

export async function refreshSystemSeed() { setSystemSeed(await getSystemSeed()); }

/** The accent picked out of your background picture (like Windows and Android do from the wallpaper). */
export const [pictureSeed, setPictureSeed] = createSignal<string | null>(null);
let pictureFor: string | null = null;
async function refreshPictureSeed(src: string | null) {
  if (src === pictureFor) return;
  pictureFor = src;
  if (!src) return setPictureSeed(null);
  try {
    const { sourceColorFromImage, hexFromArgb } = await import("@material/material-color-utilities");
    const img = new Image();
    img.src = src;
    await img.decode();
    // A small copy is plenty to find the main colour, and much quicker.
    const scale = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const small = new Image();
    small.src = c.toDataURL();
    await small.decode();
    if (pictureFor === src) setPictureSeed(hexFromArgb(await sourceColorFromImage(small)));
  } catch { if (pictureFor === src) setPictureSeed(null); }
}

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
      const l = look(), d = device();
      const sys = d.colorSource === "system" ? systemSeed() : d.colorSource === "picture" ? pictureSeed() : null;
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
        // Text on the gradient (buttons, the chosen tab): whichever of dark or white reads best on both of its ends.
        const ends = [parseHex(roles.primary!) ?? 0, parseHex(end) ?? 0];
        const readable = (fg: number) => Math.min(...ends.map((e) => contrast(fg, e)));
        root.style.setProperty("--on-pri-grad", readable(0xffffff) >= readable(0x17181c) ? "#ffffff" : "#17181c");
        // Gradient themes: the same two colours wash over the windows too, as strongly as you like. The background
        // uses the colours themselves (rich, like Discord's themes); the button tones are pale in dark mode and turned
        // the background muddy (brown, olive, grey) once mixed into it.
        const w = l.gradient.windows;
        if (w > 0) {
          const c1 = seed, c2 = l.gradient.seed2;
          const a = Math.round(w * (dark ? 0.4 : 0.38)), world = Math.round(w * (dark ? 0.62 : 0.75));
          root.style.setProperty("--win-tint", `linear-gradient(${l.gradient.angle}deg, color-mix(in srgb, ${c1} ${a}%, transparent), color-mix(in srgb, ${c2} ${a}%, transparent))`);
          root.style.setProperty("--world-grad", `linear-gradient(${l.gradient.angle}deg, color-mix(in srgb, ${c1} ${world}%, var(--world)), color-mix(in srgb, ${c2} ${world}%, var(--world)))`);
          root.dataset.wingrad = "";
        } else { root.style.removeProperty("--win-tint"); root.style.removeProperty("--world-grad"); delete root.dataset.wingrad; }
      } else { root.style.removeProperty("--on-pri-grad"); root.style.removeProperty("--pri-grad"); root.style.removeProperty("--pri-2"); root.style.removeProperty("--win-tint"); root.style.removeProperty("--world-grad"); delete root.dataset.gradient; delete root.dataset.wingrad; }
      root.dataset.mode = dark ? "dark" : "light";
      setSurfaceInt(parseHex(roles.surfaceContainerLow!) ?? 0x1b1b1f);
    });

    createEffect(() => {
      const d = device();
      root.dataset.style = d.style;
      const img = backdropImage();
      if (d.colorSource === "picture") void refreshPictureSeed(img);
      root.dataset.backdrop = d.backdrop === "image" && !img ? "stars" : d.backdrop;
      if (d.backdrop === "image" && img) root.style.setProperty("--backdrop-img", `url("${img}")`); else root.style.removeProperty("--backdrop-img");
      root.toggleAttribute("data-backdrop-blur", d.backdrop === "image" && d.backdropBlur);
      root.style.setProperty("--panel-op", String(d.panelOpacity));
      root.toggleAttribute("data-panel-blur", d.panelBlur);
      root.dataset.layout = d.layout;
      for (const [k, v] of Object.entries(DENSITY_VARS[d.density])) root.style.setProperty(k, v);
      // Stoat's "Display & Text": message size and the gap between message groups.
      // Touch screens read a little bigger (Settings > Accessibility can turn that off).
      const bump = d.a11y.touchText && matchMedia("(pointer: coarse)").matches ? 2 : 0;
      root.style.setProperty("--msg-font", `${d.text.size + bump}px`);
      // The rest of the app's text (channels, members, settings, menus, headers) follows at about half the strength.
      root.style.setProperty("--ui-text", String(Math.round((1 + (d.text.size - 15) * 0.025) * 1000) / 1000));
      root.style.setProperty("--msg-gap", `${d.text.spacing}px`);
      root.toggleAttribute("data-underline-links", d.a11y.underlineLinks);
      root.toggleAttribute("data-no-role-colors", !d.a11y.roleColors);
      root.toggleAttribute("data-readable", d.a11y.readable);
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

// The saved copy stays current: refreshed whenever the app goes to the background (unread marks, new servers…).
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden") return;
  const a = activeAccount(book()), b = backend();
  if (a?.kind === "stoat" && b && !(b as unknown as { __snapshot?: boolean }).__snapshot) void saveSnapshot(a.id, b);
});
