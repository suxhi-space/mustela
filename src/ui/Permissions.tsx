import { For, Show } from "solid-js";
import { hasBit, PERMISSIONS, setTri, triOf, withBit, type Tri } from "../lib/backend/permissions";
import type { Override } from "../lib/backend/types";
import { Switch } from "./controls";
import { Icon } from "./icons";

/**
 * Stoat's permission list. Channel and role overrides are three-way (allow, deny,
 * or leave it to the role/server), like Stoat's own settings; what everyone may do
 * server-wide is a plain on/off.
 */
export function OverrideEditor(props: { value: Override; channel: boolean; disabled?: boolean; onChange(o: Override): void }) {
  const groups = () => PERMISSIONS.map((g) => ({ ...g, list: g.list.filter((p) => !props.channel || p.channel) })).filter((g) => g.list.length);
  return (
    <div class="perms">
      <For each={groups()}>{(g) => (
        <section class="perm-group">
          <h4>{g.group}</h4>
          <For each={g.list}>{(p) => {
            const t = () => triOf(props.value, p.bit);
            const set = (v: Tri) => props.onChange(setTri(props.value, p.bit, v));
            return (
              <div class="perm-row">
                <span class="perm-text"><strong>{p.label}</strong><small>{p.description}</small></span>
                <div class="tri" role="radiogroup" aria-label={p.label}>
                  <button role="radio" class="t-deny" aria-checked={t() === "deny"} classList={{ on: t() === "deny" }} disabled={props.disabled} title="Deny" aria-label="Deny" onClick={() => set("deny")}><Icon name="close" size={14} /></button>
                  <button role="radio" class="t-mid" aria-checked={t() === "inherit"} classList={{ on: t() === "inherit" }} disabled={props.disabled} title="Leave it to the role or server" aria-label="Inherit" onClick={() => set("inherit")}>/</button>
                  <button role="radio" class="t-allow" aria-checked={t() === "allow"} classList={{ on: t() === "allow" }} disabled={props.disabled} title="Allow" aria-label="Allow" onClick={() => set("allow")}><Icon name="check" size={14} /></button>
                </div>
              </div>
            );
          }}</For>
        </section>
      )}</For>
    </div>
  );
}

export function FlagEditor(props: { value: number; disabled?: boolean; onChange(v: number): void }) {
  return (
    <div class="perms">
      <For each={PERMISSIONS}>{(g) => (
        <section class="perm-group">
          <h4>{g.group}</h4>
          <For each={g.list}>{(p) => (
            <div class="perm-row">
              <span class="perm-text"><strong>{p.label}</strong><small>{p.description}</small></span>
              <Switch label={p.label} on={hasBit(props.value, p.bit)} disabled={props.disabled} onChange={(on) => props.onChange(withBit(props.value, p.bit, on))} />
            </div>
          )}</For>
        </section>
      )}</For>
      <Show when={props.disabled}><p class="group-hint">You need the Manage Permissions permission to change these.</p></Show>
    </div>
  );
}
