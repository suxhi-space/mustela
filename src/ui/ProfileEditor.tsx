import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { hex, parseHex } from "../lib/color";
import { activeAccount } from "../lib/session/book";
import type { ProfileConfig, NameStyle } from "../lib/profile/model";
import { NAME_EFFECTS, NAME_FONTS, SLOT_LABEL, getSlotPreset, type SlotKind } from "../lib/profile/presets";
import { ratingOf } from "./anim";
import { Avatar, NameText } from "./Avatar";
import { ColorInput, RatingBadge, Select } from "./controls";
import { createProfileInfo } from "./hooks";
import { Icon } from "./icons";
import { confirmDialog, toast } from "./menu";
import { ProfileCard } from "./Profile";
import { KINDS, SlotPicker, Thumb } from "./settings/ProfileSettings";
import { backend, book, bumpMe, meNow, settings, updateSettings } from "./store";
import { openProfileEditor, profileEditorOpen, setProfileEditorOpen } from "./nav";

const MAX_IMG = 8 * 1024 * 1024;
export { openProfileEditor };

/**
 * The profile editor, as its own window over the app (like Discord's): editors
 * on the left, your card on the right updating as you type, one Save for all
 * of it. Nothing leaves this window until you save.
 */
export function ProfileEditorHost() {
  return <Show when={profileEditorOpen()}><ProfileEditor onClose={() => setProfileEditorOpen(false)} /></Show>;
}

function ProfileEditor(props: { onClose(): void }) {
  const me = () => meNow()!;
  const info = createProfileInfo(() => me().id);
  const isDemo = () => activeAccount(book())?.kind === "demo";

  // Drafts: undefined = unchanged.
  const [name, setName] = createSignal<string>();
  const [bio, setBio] = createSignal<string>();
  const [avatar, setAvatar] = createSignal<File | null>();
  const [banner, setBanner] = createSignal<File | null>();
  const [cfg, setCfg] = createSignal<ProfileConfig>(structuredClone(settings().profile));
  const [slot, setSlot] = createSignal<SlotKind | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  const url = (f: File | null | undefined) => (f ? URL.createObjectURL(f) : undefined);
  const avatarUrl = createMemo(() => url(avatar()));
  const bannerUrl = createMemo(() => url(banner()));
  onCleanup(() => { const a = avatarUrl(), b = bannerUrl(); if (a) URL.revokeObjectURL(a); if (b) URL.revokeObjectURL(b); });

  const person = () => ({ ...me(), name: name() ?? me().name, avatarUrl: avatar() === undefined ? me().avatarUrl : avatarUrl() });
  const bioNow = () => bio() ?? info()?.bio ?? "";
  const bannerNow = () => (banner() === undefined ? info()?.bannerUrl : bannerUrl());
  const cfgDirty = () => JSON.stringify(cfg()) !== JSON.stringify(settings().profile);
  const dirty = () => name() !== undefined || bio() !== undefined || avatar() !== undefined || banner() !== undefined || cfgDirty();
  const rating = createMemo(() => ratingOf(cfg()));
  const nameStyle = (): NameStyle => cfg().name ?? { font: 0, effect: 0, c1: 0xcfe3ff, c2: 0xffffff };
  const setNameStyle = (n: NameStyle) => setCfg({ ...cfg(), name: n.font === 0 && n.effect === 0 ? null : n });
  const colorsNeeded = () => NAME_EFFECTS.find((e) => e.id === nameStyle().effect)?.colors ?? 0;

  function pickImage(set: (f: File) => void) {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/png,image/jpeg,image/gif,image/webp";
    i.onchange = () => {
      const f = i.files?.[0]; if (!f) return;
      if (!f.type.startsWith("image/")) { setErr("Choose an image file."); return; }
      if (f.size > MAX_IMG) { setErr("Images can be up to 8 MB."); return; }
      setErr(""); set(f);
    };
    i.click();
  }

  function reset() { setName(undefined); setBio(undefined); setAvatar(undefined); setBanner(undefined); setCfg(structuredClone(settings().profile)); setErr(""); }

  async function save() {
    setBusy(true); setErr("");
    try {
      const b = backend()!;
      const useBannerCopy = settings().cloud.banner;
      // A new banner goes through publishing when the profile rides in it, so the strip is re-added.
      await b.updateMe({
        displayName: name() !== undefined && name() !== me().name ? name() : undefined,
        bio: bio(),
        avatar: avatar(),
        banner: banner() === null || (banner() && !(useBannerCopy && !isDemo())) ? banner() : undefined,
      });
      if (cfgDirty() || (banner() && useBannerCopy)) {
        updateSettings((s) => ({ ...s, profile: cfg() }));
        if (!isDemo()) await b.publishProfile(cfg(), banner() ?? undefined, { banner: useBannerCopy });
      }
      bumpMe(); reset();
      toast("Profile saved");
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Couldn't save. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function close() {
    if (dirty() && !(await confirmDialog("Discard changes?", "Your profile edits haven't been saved.", "Discard", true))) return;
    props.onClose();
  }

  const esc = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || document.querySelector(".dialog")) return;
    e.stopPropagation(); e.preventDefault();
    if (slot()) setSlot(null); else void close();
  };
  addEventListener("keydown", esc, true); // capture: Settings underneath listens for Escape too
  onCleanup(() => removeEventListener("keydown", esc, true));

  return (
    <div class="scrim pe-scrim" onClick={(e) => e.target === e.currentTarget && void close()}>
      <div class="pe modal" role="dialog" aria-label="Edit profile">
        <aside class="pe-side">
          <header class="pe-head">
            <Show when={slot()} fallback={<h2>Edit profile</h2>}>
              <button class="back-link" onClick={() => setSlot(null)}><Icon name="back" size={18} />{SLOT_LABEL[slot()!]}</button>
            </Show>
          </header>
          <div class="pe-scroll">
            <Show when={slot()} keyed fallback={
              <>
                <section class="pe-sec">
                  <label class="pe-label" for="pe-name">Display name</label>
                  <input id="pe-name" class="text-input wide" value={name() ?? me().name} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} />
                </section>
                <section class="pe-sec two">
                  <div>
                    <span class="pe-label">Avatar</span>
                    <div class="pe-media">
                      <button class="pe-tile" onClick={() => pickImage(setAvatar)} aria-label="Change avatar"><Avatar person={person()} size={52} profile={null} presence={false} /></button>
                      <span class="pe-btns"><button class="btn small" onClick={() => pickImage(setAvatar)}>Change</button>
                        <Show when={person().avatarUrl}><button class="link small danger" onClick={() => setAvatar(null)}>Remove</button></Show></span>
                    </div>
                  </div>
                  <div>
                    <span class="pe-label">Banner</span>
                    <div class="pe-media">
                      <button class="pe-tile banner" onClick={() => pickImage(setBanner)} aria-label="Change banner" style={bannerNow() ? { "background-image": `url("${bannerNow()!.replace(/"/g, "%22")}")` } : {}}>
                        <Show when={!bannerNow()}><Icon name="image" size={20} /></Show>
                      </button>
                      <span class="pe-btns"><button class="btn small" onClick={() => pickImage(setBanner)}>Change</button>
                        <Show when={bannerNow()}><button class="link small danger" onClick={() => setBanner(null)}>Remove</button></Show></span>
                    </div>
                  </div>
                </section>
                <section class="pe-sec">
                  <label class="pe-label" for="pe-bio">About me</label>
                  <textarea id="pe-bio" class="text-input area" rows={4} maxLength={2000} value={bioNow()} placeholder="Tell people a bit about yourself. Markdown works." onInput={(e) => setBio(e.currentTarget.value)} />
                  <small class="pe-count">{bioNow().length} / 2000</small>
                </section>
                <section class="pe-sec">
                  <span class="pe-label">Decorations</span>
                  <div class="pe-slots">
                    <For each={KINDS}>{(k) => (
                      <button class="pe-slot" onClick={() => setSlot(k)}>
                        <Thumb kind={k} slot={cfg()[k]} size={56} />
                        <span><strong>{SLOT_LABEL[k]}</strong><small>{getSlotPreset(k, cfg()[k].preset)?.name ?? "None"}</small></span>
                      </button>
                    )}</For>
                  </div>
                </section>
                <section class="pe-sec">
                  <span class="pe-label">Name style</span>
                  <div class="pe-grid">
                    <Select label="Font" value={String(nameStyle().font)} options={NAME_FONTS.map((f) => ({ v: String(f.id), label: f.label }))} onChange={(v) => setNameStyle({ ...nameStyle(), font: +v })} />
                    <Select label="Effect" value={String(nameStyle().effect)} options={NAME_EFFECTS.map((f) => ({ v: String(f.id), label: f.label }))} onChange={(v) => setNameStyle({ ...nameStyle(), effect: +v })} />
                    <Show when={colorsNeeded() >= 1}><ColorInput label="Name color" value={hex(nameStyle().c1)} onChange={(h) => setNameStyle({ ...nameStyle(), c1: parseHex(h) ?? 0xffffff })} /></Show>
                    <Show when={colorsNeeded() === 2}><ColorInput label="Name end color" value={hex(nameStyle().c2)} onChange={(h) => setNameStyle({ ...nameStyle(), c2: parseHex(h) ?? 0xffffff })} /></Show>
                  </div>
                </section>
                <section class="pe-sec">
                  <span class="pe-label">Profile colors</span>
                  <Show when={cfg().theme} fallback={<button class="btn small" onClick={() => setCfg({ ...cfg(), theme: { primary: 0x2a3a5c, accent: 0x7a9be0 } })}>Add colors</button>}>
                    <div class="pe-grid">
                      <label class="pe-color">Primary <ColorInput label="Primary color" value={hex(cfg().theme!.primary)} onChange={(h) => setCfg({ ...cfg(), theme: { ...cfg().theme!, primary: parseHex(h) ?? 0 } })} /></label>
                      <label class="pe-color">Accent <ColorInput label="Accent color" value={hex(cfg().theme!.accent)} onChange={(h) => setCfg({ ...cfg(), theme: { ...cfg().theme!, accent: parseHex(h) ?? 0 } })} /></label>
                      <button class="link small" onClick={() => setCfg({ ...cfg(), theme: null })}>Remove</button>
                    </div>
                  </Show>
                </section>
              </>
            }>{(k) => <div class="pe-picker"><SlotPicker kind={k} slot={cfg()[k]} profile={cfg()} size={58} onChange={(s) => setCfg({ ...cfg(), [k]: s })} /></div>}</Show>
          </div>
        </aside>

        <section class="pe-preview" aria-label="Preview">
          <button class="icon-btn pe-close" onClick={() => void close()} aria-label="Close"><Icon name="close" size={20} /></button>
          <span class="pe-label">Preview</span>
          <div class="pe-card"><ProfileCard person={person()} profile={cfg()} bio={bioNow()} banner={bannerNow()} marked={false} /></div>
          <span class="pe-label">In chat</span>
          <div class="pe-chat">
            <Avatar person={person()} size={40} profile={cfg()} presence={false} />
            <span><NameText person={person()} profile={cfg()} class="pe-chat-name" /><small> Today at 11:39</small><br />Sphinx of black quartz, judge my vow</span>
          </div>
          <div class="pe-rating"><RatingBadge rating={rating().total.rating} label={rating().total.label} /><small>{rating().total.reasons[0] ?? ""}</small></div>
        </section>

        <Show when={dirty() || err()}>
          <footer class="pe-bar" role="status">
            <span classList={{ err: !!err() }}>{err() || (isDemo() ? "Demo: changes stay on this device." : "Careful, you have unsaved changes!")}</span>
            <span class="grow" />
            <button class="btn small" onClick={reset} disabled={busy()}>Reset</button>
            <button class="btn small primary" onClick={() => void save()} disabled={busy() || !dirty()}>{busy() ? "Saving…" : "Save changes"}</button>
          </footer>
        </Show>
      </div>
    </div>
  );
}
