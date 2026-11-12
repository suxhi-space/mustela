import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { phoneLayout } from "./hooks";
import { setSettingsNav, settingsNav } from "./nav";
import { useBack } from "./back";
import { activeAccount } from "../lib/session/book";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { confirmDialog } from "./menu";
import { AccountsPage } from "./settings/AccountsPage";
import { AdvancedPage, APP_VERSION } from "./settings/Advanced";
import { Appearance } from "./settings/Appearance";
import { BotsPage } from "./settings/Bots";
import { LanguagePage } from "./settings/Language";
import { MustelaSync } from "./settings/MustelaSync";
import { MyAccount } from "./settings/MyAccount";
import { NotificationsPage } from "./settings/Notifications";
import { ProfileSettings } from "./settings/ProfileSettings";
import { SessionsPage } from "./settings/Sessions";
import { VoiceVideo } from "./settings/VoiceVideo";
import { SoundboardSettings } from "./settings/SoundboardSettings";
import { ActivityPage } from "./settings/ActivityPage";
import { DesktopPage } from "./settings/DesktopPage";
import { PerformancePage } from "./settings/PerformancePage";
import { AccessibilityPage } from "./settings/AccessibilityPage";
import { isDesktopApp } from "./desktop";
import { openProfileEditor } from "./ProfileEditor";
import { book, meNow, removeAccountById, settings } from "./store";
import { SETTING_LABELS } from "./settings/searchIndex";
import { searchHit } from "./settings/search";

export type Tab = "account" | "profile" | "sessions" | "bots" | "voice" | "soundboard" | "appearance" | "accessibility" | "notifications" | "language" | "desktop" | "accounts" | "sync" | "activity" | "performance" | "advanced";
/** Same sections and order as Stoat's settings, with Mustela's extras in their own group before Advanced. */
const GROUPS = (): { title: string; tabs: { id: Tab; label: string; icon: string }[] }[] => [
  { title: "User settings", tabs: [{ id: "profile", label: "Profile", icon: "user" }, { id: "sessions", label: "Sessions", icon: "shield" }] },
  { title: "Stoat", tabs: [{ id: "bots", label: "My bots", icon: "bot" }] },
  { title: "Client settings", tabs: [
    { id: "voice", label: "Voice & video", icon: "mic" }, { id: "appearance", label: "Appearance", icon: "palette" }, { id: "accessibility", label: "Accessibility", icon: "eye" },
    { id: "notifications", label: "Notifications", icon: "bell" }, { id: "language", label: "Language", icon: "globe" },
    ...(isDesktopApp() ? [{ id: "desktop" as Tab, label: "Desktop", icon: "screen" }] : []),
  ] },
  { title: "Mustela", tabs: [
    { id: "activity", label: "Activity", icon: "gamepad" }, { id: "performance", label: "Performance", icon: "sparkle" }, { id: "sync", label: "Sync & servers", icon: "cloud" },
    { id: "accounts", label: "Accounts", icon: "swap" }, { id: "advanced", label: "Advanced", icon: "flask" },
  ] },
];
const TITLE: Record<Tab, string> = { account: "My account", profile: "Profile", sessions: "Sessions", bots: "My bots", voice: "Voice & video", soundboard: "Soundboard", appearance: "Appearance", accessibility: "Accessibility", notifications: "Notifications", language: "Language", desktop: "Desktop", accounts: "Accounts", sync: "Sync & servers", activity: "Activity", performance: "Performance", advanced: "Advanced" };

const KEYWORDS: Partial<Record<Tab, string>> = {
  profile: "avatar banner bio about decoration frame nameplate effect name color pronouns",
  sessions: "devices logged in sign out",
  bots: "developer token",
  voice: "microphone mic speaker headphones camera input output noise echo sensitivity screen share",
  soundboard: "sounds clips entry sound emoji rename volume favorite",
  appearance: "theme color dark light mode emoji pack font message size spacing density compact blur material transparency background",
  notifications: "sounds badge desktop mention",
  language: "time date format 24 hour",
  desktop: "tray startup start with computer close minimize appimage install shortcut",
  activity: "game playing rich presence discord rpc detection",
  sync: "cloud server backup",
  accounts: "switch add log out",
  accessibility: "text size readable font motion reduce animation contrast colour color underline links role density zoom",
  performance: "animation lag slow gif emoji blur title bar frame fps battery game",
  advanced: "debug cache reset",
};

/** Settings, laid out like Stoat's: account on top, then Stoat, client and Mustela sections. */
export function Settings(props: { onClose(): void; initial?: string }) {
  const [tab, setTab] = createSignal<Tab>((props.initial as Tab) in TITLE && props.initial !== "profile" ? (props.initial as Tab) : "account");
  if (props.initial === "profile") openProfileEditor();
  // Phones: the list first, then a page. Opened at a particular page (Voice & video from a call, Soundboard from
  // the soundboard), that page comes straight up; back goes to the list.
  const [narrowNav, setNarrowNav] = createSignal(!props.initial || props.initial === "account" || !((props.initial as Tab) in TITLE));
  // Back: from a page to the list of pages (phones), then out of settings.
  useBack(() => (narrowNav() || !phoneLayout() ? props.onClose() : setNarrowNav(true)));
  const demo = () => activeAccount(book())?.kind === "demo";
  const go = (t: Tab) => { setTab(t); setNarrowNav(false); };
  createEffect(on(settingsNav, (t) => { if (t && t in TITLE) { go(t as Tab); setSettingsNav(null); } }));
  const me = () => meNow()!;
  // Find a page by name or by what's on it, like Discord's settings search.
  const [q, setQ] = createSignal("");
  // Every word you type has to start a word somewhere: in the page's name, its keywords or one of its settings.
  const labelsFor = (id: Tab) => [...new Set([...(SETTING_LABELS[id] ?? []), ...(id === "voice" ? SETTING_LABELS.soundboard ?? [] : [])])];
  const found = (t: { id: Tab; label: string }) => labelsFor(t.id).filter((l) => searchHit(q(), l)).slice(0, 4);
  const matches = (t: { id: Tab; label: string }) => !q().trim() || searchHit(q(), `${t.label} ${KEYWORDS[t.id] ?? ""}`) || found(t).length > 0;
  /** Opens a setting's page and points at it: scrolled into view with a short flash. */
  const reveal = (id: Tab, label: string) => {
    go(id);
    let tries = 0;
    const look = () => {
      const page = document.querySelector(".settings .spage");
      const el = page && [...page.querySelectorAll<HTMLElement>(".row-label, .group-title")].find((e) => (e.firstChild?.textContent ?? e.textContent ?? "").trim() === label);
      if (!el) { if (tries++ < 10) setTimeout(look, 60); return; }
      const row = el.closest<HTMLElement>(".row, .group") ?? el;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.remove("found-flash"); void row.offsetWidth; row.classList.add("found-flash");
      setTimeout(() => row.classList.remove("found-flash"), 1600);
    };
    requestAnimationFrame(look);
  };
  async function logOut() {
    const a = activeAccount(book());
    if (a && await confirmDialog(`Log out of ${a.name}?`, "You'll need your password to sign back in. Other accounts stay signed in.", "Log out", true)) { props.onClose(); await removeAccountById(a.id); }
  }

  return (
    <div class="settings" role="dialog" aria-label="Settings" data-narrow={narrowNav() ? "nav" : "page"} onKeyDown={(e) => e.key === "Escape" && props.onClose()} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="settings-card">
      <div class="settings-body">
        <nav class="snav panel" role="tablist" aria-label="Settings sections" ref={(el) => queueMicrotask(() => el.querySelector<HTMLElement>("button.on")?.scrollIntoView({ block: "center" }))}>
          {/* Phones and narrow screens: the list is a screen of its own, with its own way out */}
          <div class="snav-top">
            <button class="icon-btn" onClick={props.onClose} aria-label="Close settings"><Icon name="back" size={22} /></button>
            <h2>Settings</h2>
          </div>
          <button class="snav-me" role="tab" aria-selected={tab() === "account"} classList={{ on: tab() === "account" }} onClick={() => go("account")}>
            <Avatar person={me()} size={36} profile={settings().profile} presence={false} />
            <span><small>{me().name}</small><strong>My account</strong></span>
          </button>
          <Show when={q().trim()}>
            <For each={found({ id: "account", label: "My account" })}>{(l) => <button class="snav-hit" onClick={() => reveal("account", l)}>{l}</button>}</For>
          </Show>
          <label class="search-box snav-search"><Icon name="search" size={15} /><input placeholder="Search" aria-label="Search settings" value={q()} onInput={(e) => setQ(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { const t = GROUPS().flatMap((g) => g.tabs).find(matches); if (t) { const f = found(t)[0]; t.id === "profile" ? openProfileEditor() : f ? reveal(t.id, f) : go(t.id); } } if (e.key === "Escape" && q()) { e.stopPropagation(); setQ(""); } }} /></label>
          <For each={GROUPS().map((g) => ({ ...g, tabs: g.tabs.filter(matches) })).filter((g) => g.tabs.length)}>{(g) => (
            <>
              <h3 class="snav-head">{g.title}</h3>
              <For each={g.tabs}>{(t) => (<>
                <button role="tab" aria-selected={tab() === t.id || (t.id === "voice" && tab() === "soundboard")} classList={{ on: tab() === t.id || (t.id === "voice" && tab() === "soundboard") }} onClick={() => (t.id === "profile" ? openProfileEditor() : go(t.id))}><Icon name={t.icon} size={18} />{t.label}</button>
                {/* While searching: the settings on this page that match, each going straight to its setting */}
                <Show when={q().trim()}>
                  <For each={found(t)}>{(l) => (
                    <button class="snav-hit" onClick={() => reveal(t.id === "voice" && !(SETTING_LABELS.voice ?? []).includes(l) ? "soundboard" : t.id, l)}>{l}</button>
                  )}</For>
                </Show>
              </>)}</For>
            </>
          )}</For>
          <div class="snav-sep" />
          <button class="danger" onClick={() => void logOut()}><Icon name="logout" size={18} />Log out</button>
          <p class="snav-foot">Mustela {APP_VERSION}</p>
        </nav>
        <div class="spage panel" role="tabpanel" aria-label={TITLE[tab()]}>
          <header class="spage-head">
            <button class="icon-btn snav-back" onClick={() => setNarrowNav(true)} aria-label="All settings"><Icon name="back" size={22} /></button>
            <h2>{TITLE[tab()]}</h2>
            <span class="grow" />
            <button class="esc" onClick={props.onClose} aria-label="Close settings"><span class="esc-x"><Icon name="close" size={18} /></span><small class="desk-only">Esc</small></button>
          </header>
          {/* Desktop: only this part scrolls, so the header above stays put with nothing behind it (styles.css) */}
          <div class="spage-scroll">
          <Show when={demo() && (tab() === "account" || tab() === "sessions" || tab() === "bots")}>
            <p class="demo-note">This is the demo account. Changes here are pretend and reset when you leave.</p>
          </Show>
          <Switch>
            <Match when={tab() === "account"}><MyAccount onEditProfile={() => openProfileEditor()} /></Match>
            <Match when={tab() === "profile"}><ProfileSettings /></Match>
            <Match when={tab() === "sessions"}><SessionsPage /></Match>
            <Match when={tab() === "bots"}><BotsPage /></Match>
            <Match when={tab() === "voice"}><VoiceVideo /></Match>
            <Match when={tab() === "soundboard"}><SoundboardSettings /></Match>
            <Match when={tab() === "appearance"}><Appearance /></Match>
            <Match when={tab() === "notifications"}><NotificationsPage /></Match>
            <Match when={tab() === "language"}><LanguagePage /></Match>
            <Match when={tab() === "desktop"}><DesktopPage /></Match>
            <Match when={tab() === "sync"}><MustelaSync /></Match>
            <Match when={tab() === "activity"}><ActivityPage /></Match>
            <Match when={tab() === "accounts"}><AccountsPage onClose={props.onClose} /></Match>
            <Match when={tab() === "performance"}><PerformancePage /></Match>
            <Match when={tab() === "accessibility"}><AccessibilityPage /></Match>
            <Match when={tab() === "advanced"}><AdvancedPage /></Match>
          </Switch>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
