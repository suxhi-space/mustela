import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { useBack } from "./back";
import { cropImage } from "./Cropper";
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
import { MemberRow } from "./Members";
import { KINDS, SlotPicker, Thumb } from "./settings/ProfileSettings";
import { backend, book, bumpMe, ext, meNow, settings, updateExt, updateSettings } from "./store";
import { openProfileEditor, profileEditorOpen, setProfileEditorOpen } from "./nav";

const MAX_IMG = 8 * 1024 * 1024;
export { openProfileEditor };

/**
 * The profile editor, as its own window over the app (like Discord's): editors
 * on the left, your card on the right updating as you type, one Save for all
 * of it. Nothing leaves this window until you save.
 */
export function ProfileEditorHost() {
  return <Show when={profileEditorOpen()} keyed>{(o) => <ProfileEditor server={o.server} onClose={() => setProfileEditorOpen(null)} />}</Show>;
}

/**
 * `server`: start on your profile in that server. A server has your nickname and picture there (Stoat
 * keeps those, so everyone sees them) and your look there: banner, about me, decorations, name style and
 * colours (kept on your sync servers, seen by Mustela users). Anything not changed for a server comes
 * from your main profile.
 */
function ProfileEditor(props: { server?: string; onClose(): void }) {
  const me = () => meNow()!;
  useBack(() => props.onClose());
  // Your main profile only (not the server you're in): the starting point everything falls back to.
  const info = createProfileInfo(() => me().id, () => true, () => null);
  const isDemo = () => activeAccount(book())?.kind === "demo";

  // Drafts: undefined = unchanged.
  const [name, setName] = createSignal<string>();
  const [bio, setBio] = createSignal<string>();
  const [pronouns, setPronouns] = createSignal<string>();
  const [avatar, setAvatar] = createSignal<File | null>();
  const [banner, setBanner] = createSignal<File | null>();
  const [slot, setSlot] = createSignal<SlotKind | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  /* ---- which profile: "main", or a server id ---- */
  const [scope, setScopeRaw] = createSignal(props.server ?? "main");
  const [servers] = createResource(async () => (await backend()!.spaces()).filter((x) => !x.home).map((x) => ({ id: x.id, name: x.name })));
  const serverName = () => servers()?.find((x) => x.id === scope())?.name ?? "this server";
  const inServer = () => scope() !== "main";
  const [ident, { refetch: refetchIdent }] = createResource(() => (inServer() ? scope() : null), (sid) => backend()!.identity(sid).catch(() => ({} as { nickname?: string; avatarUrl?: string })));
  const [nick, setNick] = createSignal<string>();
  const [sAvatar, setSAvatar] = createSignal<File | null>();
  const sAvatarUrl = createMemo(() => (sAvatar() ? URL.createObjectURL(sAvatar()!) : undefined));
  onCleanup(() => { const u = sAvatarUrl(); if (u) URL.revokeObjectURL(u); });
  const serverDirty = () => nick() !== undefined || sAvatar() !== undefined;
  async function setScope(v: string) {
    if (v === scope()) return;
    if (dirty() && !(await confirmDialog("Discard changes?", "Your profile edits haven't been saved.", "Discard", true))) return;
    setScopeRaw(v); reset();
  }

  /* ---- what each field starts from: this server's look, else the main profile ---- */
  const look = () => (inServer() ? ext().serverLooks[scope()] : undefined);
  const baseCfg = () => look()?.config ?? settings().profile;
  const [lookBanner] = createResource(() => (look()?.banner ? ([scope(), look()!.banner!] as const) : null), ([sid, at]) => backend()!.serverBanner(me().id, sid, at));
  const baseBio = () => look()?.bio ?? info()?.bio ?? "";
  const baseBanner = () => (look()?.banner ? lookBanner() ?? undefined : undefined) ?? info()?.bannerUrl;
  const [cfg, setCfg] = createSignal<ProfileConfig>(structuredClone(baseCfg()));

  const url = (f: File | null | undefined) => (f ? URL.createObjectURL(f) : undefined);
  const avatarUrl = createMemo(() => url(avatar()));
  const bannerUrl = createMemo(() => url(banner()));
  onCleanup(() => { const a = avatarUrl(), b = bannerUrl(); if (a) URL.revokeObjectURL(a); if (b) URL.revokeObjectURL(b); });

  const mainPerson = () => ({ ...me(), name: name() ?? me().name, avatarUrl: avatar() === undefined ? me().avatarUrl : avatarUrl() });
  // In a server: your nickname and server picture over your main profile, as people there see you.
  const person = () => !inServer() ? mainPerson() : {
    ...me(),
    name: (nick() ?? ident()?.nickname ?? "") || me().name,
    avatarUrl: sAvatar() === undefined ? ident()?.avatarUrl ?? me().avatarUrl : sAvatar() === null ? me().avatarUrl : sAvatarUrl(),
  };
  const bioNow = () => bio() ?? baseBio();
  // In a server, removing its banner means "use my main banner".
  const bannerNow = () => (banner() === undefined ? baseBanner() : banner() === null && inServer() ? info()?.bannerUrl : bannerUrl());
  const cfgDirty = () => JSON.stringify(cfg()) !== JSON.stringify(baseCfg());
  const dirty = () => name() !== undefined || pronouns() !== undefined || bio() !== undefined || avatar() !== undefined || banner() !== undefined || cfgDirty() || serverDirty();
  const rating = createMemo(() => ratingOf(cfg()));
  const nameStyle = (): NameStyle => cfg().name ?? { font: 0, effect: 0, c1: 0xcfe3ff, c2: 0xffffff };
  const setNameStyle = (n: NameStyle) => setCfg({ ...cfg(), name: n.font === 0 && n.effect === 0 ? null : n });
  const colorsNeeded = () => NAME_EFFECTS.find((e) => e.id === nameStyle().effect)?.colors ?? 0;

  function pickImage(set: (f: File) => void, kind?: "avatar" | "banner") {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/png,image/jpeg,image/gif,image/webp";
    i.onchange = () => {
      const f = i.files?.[0]; if (!f) return;
      if (!f.type.startsWith("image/")) { setErr("Choose an image file."); return; }
      if (f.size > MAX_IMG) { setErr("Images can be up to 8 MB."); return; }
      setErr("");
      if (!kind) { set(f); return; }
      void cropImage(f, kind).then((c) => { if (c) set(c); });
    };
    i.click();
  }

  function reset() { setName(undefined); setPronouns(undefined); setBio(undefined); setAvatar(undefined); setBanner(undefined); setNick(undefined); setSAvatar(undefined); setCfg(structuredClone(baseCfg())); setErr(""); }

  /** Saves this server's look (decorations, colours, about me, banner) with your sync servers. */
  async function saveLook(next: { config?: ProfileConfig; bio?: string }, newBanner: Blob | null | undefined) {
    const sid = scope(), prev = look();
    const at = await backend()!.saveServerLook(sid, next, newBanner, { main: settings().profile, looks: ext().serverLooks, privacy: ext().privacy });
    const bannerAt = at === undefined ? prev?.banner : at || undefined;
    updateExt((x) => {
      const looks = { ...x.serverLooks };
      const l = { ...(next.config ? { config: next.config } : {}), ...(next.bio !== undefined ? { bio: next.bio } : {}), ...(bannerAt ? { banner: bannerAt } : {}) };
      if (Object.keys(l).length) looks[sid] = l; else delete looks[sid];
      return { ...x, serverLooks: looks };
    });
  }

  async function useMainHere() {
    if (!(await confirmDialog(`Use your main profile in ${serverName()}?`, "This server's banner, about me, decorations and colours go back to your main ones. Your nickname and server picture stay.", "Use main profile"))) return;
    setBusy(true); setErr("");
    try { await saveLook({}, look()?.banner ? null : undefined); reset(); toast(`${serverName()} uses your main profile`); }
    catch (e) { setErr(e instanceof Error && e.message ? e.message : "Couldn't save. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setErr("");
    if (inServer()) {
      try {
        const n = nick();
        if (serverDirty()) await backend()!.editIdentity(scope(), { nickname: n === undefined ? undefined : n.trim() || null, avatar: sAvatar() });
        if (cfgDirty() || bio() !== undefined || banner() !== undefined) {
          const prev = look();
          await saveLook({ config: cfgDirty() ? cfg() : prev?.config, bio: bio() !== undefined ? bio() : prev?.bio }, banner());
        }
        reset(); setTimeout(() => void refetchIdent(), 400);
        toast(`Saved for ${serverName()}`);
      } catch (e) {
        setErr(e instanceof Error && e.message ? e.message : "Couldn't save. Check your connection and try again.");
      } finally { setBusy(false); }
      return;
    }
    try {
      const b = backend()!;
      const useBannerCopy = settings().cloud.banner;
      // A new banner goes through publishing when the profile rides in it, so the strip is re-added.
      await b.updateMe({
        displayName: name() !== undefined && name() !== me().name ? name() : undefined,
        bio: bio(),
        pronouns: pronouns(),
        avatar: avatar(),
        banner: banner() === null || (banner() && !(useBannerCopy && !isDemo())) ? banner() : undefined,
      });
      if (cfgDirty() || (banner() && useBannerCopy)) {
        updateSettings((s) => ({ ...s, profile: cfg() }));
        if (!isDemo()) await b.publishProfile(cfg(), banner() ?? undefined, { banner: useBannerCopy, privacy: ext().privacy, servers: ext().serverLooks });
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

  /** The banner tile; in a server, removing it goes back to your main banner. */
  const bannerPicker = () => (
    <div>
      <span class="pe-label">Banner</span>
      <div class="pe-media">
        <button class="pe-tile banner" onClick={() => pickImage(setBanner, "banner")} aria-label="Change banner" style={bannerNow() ? { "background-image": `url("${bannerNow()!.replace(/"/g, "%22")}")` } : {}}>
          <Show when={!bannerNow()}><Icon name="image" size={20} /></Show>
        </button>
        <span class="pe-btns"><button class="btn small" onClick={() => pickImage(setBanner, "banner")}>Change</button>
          <Show when={inServer() ? banner() !== null && (banner() || look()?.banner) : bannerNow()}><button class="link small danger" onClick={() => setBanner(null)}>{inServer() ? "Use main" : "Remove"}</button></Show></span>
      </div>
    </div>
  );

  return (
    <div class="scrim pe-scrim" onClick={(e) => e.target === e.currentTarget && void close()}>
      <div class="pe modal" role="dialog" aria-label="Edit profile">
        <aside class="pe-side">
          <header class="pe-head">
            <Show when={slot()} fallback={
              <>
                <h2>Edit profile</h2>
                {/* Drawn once the servers are known, so it can show the one you opened it on */}
                <Show when={servers()}>{(list) => (
                  <Select label="Profile for" value={scope()} onChange={(v) => void setScope(v)}
                    options={[{ v: "main", label: "Main profile" }, ...list().map((x) => ({ v: x.id, label: x.name }))]} />
                )}</Show>
              </>
            }>
              <button class="back-link" onClick={() => setSlot(null)}><Icon name="back" size={18} />{SLOT_LABEL[slot()!]}</button>
            </Show>
          </header>
          <div class="pe-scroll">
            <Show when={slot()} keyed fallback={
              <>
                <Show when={!inServer()} fallback={
                  <>
                    <p class="muted small pe-note">How people in {serverName()} see you. Anything you don't change here comes from your main profile.
                      <Show when={look()}> <button class="link small" disabled={busy()} onClick={() => void useMainHere()}>Use my main profile here</button></Show></p>
                    <section class="pe-sec">
                      <label class="pe-label" for="pe-nick">Server nickname</label>
                      <input id="pe-nick" class="text-input wide" value={nick() ?? ident()?.nickname ?? ""} placeholder={me().name} maxLength={32} onInput={(e) => setNick(e.currentTarget.value)} />
                    </section>
                    <section class="pe-sec two">
                      <div>
                        <span class="pe-label">Server avatar</span>
                        <div class="pe-media">
                          <button class="pe-tile" onClick={() => pickImage(setSAvatar, "avatar")} aria-label="Change server avatar"><Avatar person={person()} size={52} profile={null} presence={false} /></button>
                          <span class="pe-btns"><button class="btn small" onClick={() => pickImage(setSAvatar, "avatar")}>Change</button>
                            <Show when={sAvatar() !== null && (sAvatar() || ident()?.avatarUrl)}><button class="link small danger" onClick={() => setSAvatar(null)}>Use main</button></Show></span>
                        </div>
                      </div>
                      {bannerPicker()}
                    </section>
                  </>
                }>
                  <section class="pe-sec">
                    <label class="pe-label" for="pe-name">Display name</label>
                    <input id="pe-name" class="text-input wide" value={name() ?? me().name} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} />
                  </section>
                  <section class="pe-sec">
                    <label class="pe-label" for="pe-pronouns">Pronouns</label>
                    <input id="pe-pronouns" class="text-input wide" value={pronouns() ?? me().pronouns ?? ""} placeholder="she/her, they/them…" maxLength={32} onInput={(e) => setPronouns(e.currentTarget.value)} />
                  </section>
                  <section class="pe-sec two">
                    <div>
                      <span class="pe-label">Avatar</span>
                      <div class="pe-media">
                        <button class="pe-tile" onClick={() => pickImage(setAvatar, "avatar")} aria-label="Change avatar"><Avatar person={person()} size={52} profile={null} presence={false} /></button>
                        <span class="pe-btns"><button class="btn small" onClick={() => pickImage(setAvatar, "avatar")}>Change</button>
                          <Show when={person().avatarUrl}><button class="link small danger" onClick={() => setAvatar(null)}>Remove</button></Show></span>
                      </div>
                    </div>
                    {bannerPicker()}
                  </section>
                </Show>
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
          <span class="pe-label">Nameplate</span>
          <div class="pe-plate">
            <MemberRow person={person()} profile={cfg()} onOpen={() => {}} />
            <Show when={!cfg().plate.preset}><small class="muted">No nameplate. Pick one under Decorations.</small></Show>
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
