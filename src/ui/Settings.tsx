import { createSignal, Match, Switch } from "solid-js";
import { Icon } from "./icons";
import { AccountsPage } from "./settings/AccountsPage";
import { Appearance } from "./settings/Appearance";
import { NotificationsPage } from "./settings/Notifications";
import { ProfileSettings } from "./settings/ProfileSettings";

type Tab = "profile" | "appearance" | "notifications" | "accounts";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "profile", label: "My profile", icon: "user" },
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "accounts", label: "Accounts", icon: "swap" },
];

export function Settings(props: { onClose(): void }) {
  const [tab, setTab] = createSignal<Tab>("profile");
  return (
    <div class="settings" role="dialog" aria-label="Settings" onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <header class="bar settings-bar panel">
        <h2>Settings</h2>
        <span class="grow" />
        <button class="icon-btn" onClick={props.onClose} aria-label="Close settings"><Icon name="close" size={20} /></button>
      </header>
      <div class="settings-body">
        <nav class="snav panel" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button role="tab" aria-selected={tab() === t.id} classList={{ on: tab() === t.id }} onClick={() => setTab(t.id)}><Icon name={t.icon} size={18} />{t.label}</button>
          ))}
        </nav>
        <div class="spage panel" role="tabpanel">
          <Switch>
            <Match when={tab() === "profile"}><ProfileSettings /></Match>
            <Match when={tab() === "appearance"}><Appearance /></Match>
            <Match when={tab() === "notifications"}><NotificationsPage /></Match>
            <Match when={tab() === "accounts"}><AccountsPage onClose={props.onClose} /></Match>
          </Switch>
        </div>
      </div>
    </div>
  );
}
