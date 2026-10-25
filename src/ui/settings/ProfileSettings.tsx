import { createMemo, createSignal, For, Show } from "solid-js";
import { hex, parseHex } from "../../lib/color";
import type { SlotConfig } from "../../lib/decor/spec";
import { activeAccount } from "../../lib/session/book";
import { DEFAULT_PROFILE, type NameStyle, type ProfileConfig } from "../../lib/profile/model";
import { NAME_EFFECTS, NAME_FONTS, SLOT_LABEL, SLOT_PRESETS, slotFromPreset, getSlotPreset, type SlotKind } from "../../lib/profile/presets";
import { ratingOf } from "../anim";
import { Avatar } from "../Avatar";
import { ColorInput, Group, RatingBadge, Row, Select, Slider } from "../controls";
import { createProfileInfo } from "../hooks";
import { Icon } from "../icons";
import { EffectCanvas, FrameCanvas, PlateCanvas } from "../Paint";
import { ProfileCard } from "../Profile";
import { AccountEditor } from "./AccountEditor";
import { backend, book, meNow, settings, updateSettings } from "../store";

export const KINDS: SlotKind[] = ["decor", "effect", "frame", "plate"];
const NONE: SlotConfig = { preset: 0, hue: 0, speed: 8, intensity: 8 };
const FAKE = { id: "preview", name: "A", online: undefined as boolean | undefined };
const only = (kind: SlotKind, slot: SlotConfig): ProfileConfig => ({ ...DEFAULT_PROFILE, decor: NONE, effect: NONE, frame: NONE, plate: NONE, [kind]: slot });

/** A small still preview of one slot, on a neutral dark tile so colors read the same in any theme. */
export function Thumb(props: { kind: SlotKind; slot: SlotConfig; size?: number; live?: boolean }) {
  const s = () => props.size ?? 52;
  return (
    <span class="thumb" classList={{ wide: props.kind === "plate" }} style={{ width: `${props.kind === "plate" ? s() * 1.6 : s()}px`, height: `${props.kind === "plate" ? s() * 0.55 : s()}px` }}>
      <Show when={props.slot.preset} fallback={<span class="thumb-none">None</span>}>
        {props.kind === "decor" && <Avatar person={FAKE} size={s() * 0.5} profile={only("decor", props.slot)} still={!props.live} presence={false} />}
        {props.kind === "effect" && <EffectCanvas slot={() => props.slot} w={s()} h={s()} animate={!!props.live} />}
        {props.kind === "frame" && <FrameCanvas slot={() => props.slot} w={s()} h={s()} animate={!!props.live} radius={8} />}
        {props.kind === "plate" && <PlateCanvas slot={() => props.slot} w={s() * 1.6} h={s() * 0.55} animate={!!props.live} />}
      </Show>
    </span>
  );
}

/** The tiles and knobs for one slot. Controlled: the caller owns the value. */
export function SlotPicker(props: { kind: SlotKind; slot: SlotConfig; profile: ProfileConfig; onChange(s: SlotConfig): void; size?: number }) {
  const preset = () => getSlotPreset(props.kind, props.slot.preset);
  const part = () => ratingOf(props.profile).parts[props.kind];
  const set = (s: SlotConfig) => props.onChange(s);
  const size = () => props.size ?? 64;
  return (
    <>
      <div class="tiles" role="radiogroup" aria-label={SLOT_LABEL[props.kind]}>
        <button class="tile-pick" role="radio" aria-checked={props.slot.preset === 0} classList={{ on: props.slot.preset === 0 }} onClick={() => set(NONE)}>
          <Thumb kind={props.kind} slot={NONE} size={size()} /><span>None</span>
        </button>
        <For each={SLOT_PRESETS[props.kind]}>{(p) => (
          <button class="tile-pick" role="radio" aria-checked={props.slot.preset === p.id} classList={{ on: props.slot.preset === p.id }} onClick={() => set(slotFromPreset(props.kind, p.id))}>
            <Thumb kind={props.kind} slot={props.slot.preset === p.id ? props.slot : slotFromPreset(props.kind, p.id)} size={size()} live={props.slot.preset === p.id} /><span>{p.name}</span>
          </button>
        )}</For>
      </div>
      <Show when={preset()}>
        <Group title="Adjust" hint={part().reasons.join(" ") || undefined}>
          <Show when={preset()!.knobs.includes("hue")}><Row label="Color"><Slider hue label="Color" min={0} max={359} value={props.slot.hue} onChange={(hue) => set({ ...props.slot, hue })} suffix="°" /></Row></Show>
          <Show when={preset()!.knobs.includes("speed")}><Row label="Speed"><Slider label="Speed" min={0} max={15} value={props.slot.speed} onChange={(speed) => set({ ...props.slot, speed })} /></Row></Show>
          <Show when={preset()!.knobs.includes("intensity")}><Row label="Intensity"><Slider label="Intensity" min={0} max={15} value={props.slot.intensity} onChange={(intensity) => set({ ...props.slot, intensity })} /></Row></Show>
          <Row label="Performance"><RatingBadge rating={part().rating} label={part().label} /></Row>
        </Group>
      </Show>
    </>
  );
}

function Picker(props: { kind: SlotKind; onBack(): void }) {
  const slot = () => settings().profile[props.kind] ?? NONE;
  return (
    <div class="page">
      <button class="back-link" onClick={props.onBack}><Icon name="back" size={18} />{SLOT_LABEL[props.kind]}</button>
      <SlotPicker kind={props.kind} slot={slot()} profile={settings().profile} onChange={(s) => updateSettings((x) => ({ ...x, profile: { ...x.profile, [props.kind]: s } }))} />
    </div>
  );
}

export function ProfileSettings() {
  const me = () => meNow()!;
  const p = () => settings().profile;
  const rating = createMemo(() => ratingOf(p()));
  const info = createProfileInfo(() => me().id);
  const [picker, setPicker] = createSignal<SlotKind | null>(null);
  const [pub, setPub] = createSignal<"idle" | "busy" | "done" | "err">("idle");
  const pubKey = () => `mustela:published:${activeAccount(book())?.id}`;
  const [published, setPublished] = createSignal<string | null>((() => { try { return localStorage.getItem(pubKey()); } catch { return null; } })());
  const dirty = () => JSON.stringify(p()) !== published();
  const isDemo = () => activeAccount(book())?.kind === "demo";

  const setProfile = (fn: (p: ProfileConfig) => ProfileConfig) => updateSettings((s) => ({ ...s, profile: fn(s.profile) }));
  async function publish() {
    setPub("busy");
    try {
      await backend()!.publishProfile(p(), undefined, { banner: settings().cloud.banner });
      const j = JSON.stringify(p());
      try { localStorage.setItem(pubKey(), j); } catch { /* fine */ }
      setPublished(j); setPub("done");
    } catch { setPub("err"); }
  }

  const theme = () => p().theme;
  const name = (): NameStyle => p().name ?? { font: 0, effect: 0, c1: 0xcfe3ff, c2: 0xffffff };
  const setName = (n: NameStyle) => setProfile((x) => ({ ...x, name: n.font === 0 && n.effect === 0 ? null : n }));
  const colorsNeeded = () => NAME_EFFECTS.find((e) => e.id === name().effect)?.colors ?? 0;

  return (
    <Show when={picker()} keyed fallback={
      <div class="page">
        <div class="preview-wrap">
          <ProfileCard person={me()} profile={p()} bio={info()?.bio} banner={info()?.bannerUrl} marked={published() !== null} showRating />
        </div>

        <AccountEditor bio={info()?.bio} />

        <Group title="Customize" hint="Decorations, effects, frames and nameplates are seen by other Mustela users after you publish.">
          <For each={KINDS}>{(k) => (
            <Row onClick={() => setPicker(k)} chevron label={<>{SLOT_LABEL[k]}{k === "frame" && <em class="new">New</em>}</>}
              hint={getSlotPreset(k, p()[k].preset)?.name ?? "None"}>
              <Thumb kind={k} slot={p()[k]} />
            </Row>
          )}</For>
        </Group>

        <Group title="Profile theme" hint="Colors for your card on other people's screens. Text color is picked for you so it stays readable.">
          <Show when={theme()} fallback={<Row label="Colors" hint="Not set"><button class="btn small" onClick={() => setProfile((x) => ({ ...x, theme: { primary: 0x2a3a5c, accent: 0x7a9be0 } }))}>Set colors</button></Row>}>
            <Row label="Primary"><ColorInput label="Primary color" value={hex(theme()!.primary)} onChange={(h) => setProfile((x) => ({ ...x, theme: { primary: parseHex(h) ?? 0, accent: x.theme?.accent ?? 0 } }))} /></Row>
            <Row label="Accent"><ColorInput label="Accent color" value={hex(theme()!.accent)} onChange={(h) => setProfile((x) => ({ ...x, theme: { primary: x.theme?.primary ?? 0, accent: parseHex(h) ?? 0 } }))} /></Row>
            <Row label="Remove theme"><button class="btn small" onClick={() => setProfile((x) => ({ ...x, theme: null }))}>Remove</button></Row>
          </Show>
        </Group>

        <Group title="Display name style">
          <Row label="Font"><Select label="Font" value={String(name().font)} options={NAME_FONTS.map((f) => ({ v: String(f.id), label: f.label }))} onChange={(v) => setName({ ...name(), font: +v })} /></Row>
          <Row label="Effect"><Select label="Effect" value={String(name().effect)} options={NAME_EFFECTS.map((f) => ({ v: String(f.id), label: f.label }))} onChange={(v) => setName({ ...name(), effect: +v })} /></Row>
          <Show when={colorsNeeded() >= 1}><Row label={colorsNeeded() === 2 ? "Start color" : "Color"}><ColorInput label="Name color" value={hex(name().c1)} onChange={(h) => setName({ ...name(), c1: parseHex(h) ?? 0xffffff })} /></Row></Show>
          <Show when={colorsNeeded() === 2}><Row label="End color"><ColorInput label="Name end color" value={hex(name().c2)} onChange={(h) => setName({ ...name(), c2: parseHex(h) ?? 0xffffff })} /></Row></Show>
        </Group>

        <Group title="Share" hint={isDemo()
          ? "Demo accounts have nowhere to publish. Sign in to share your profile."
          : "Publishing replaces your profile banner with a copy that carries a small hidden strip along the bottom. Mustela users see your profile; other apps show the strip as a thin gray bar."}>
          <Row label="Performance" hint={rating().total.reasons[0]}><RatingBadge rating={rating().total.rating} label={rating().total.label} /></Row>
          <Row label={dirty() ? "You have unpublished changes" : "Profile is published"}>
            <button class="btn primary small" disabled={isDemo() || pub() === "busy" || (!dirty() && pub() !== "err")} onClick={publish}>
              {pub() === "busy" ? "Publishing…" : "Publish profile"}
            </button>
          </Row>
          <Show when={pub() === "err"}><Row label={<span class="err">Couldn't publish. Check your connection and try again.</span>} /></Show>
          <Show when={pub() === "done" && !dirty()}><Row label={<span class="ok">Published.</span>} /></Show>
        </Group>
      </div>
    }>
      {(k) => <Picker kind={k} onBack={() => setPicker(null)} />}
    </Show>
  );
}
