import { createResource, createSignal, For, Show } from "solid-js";
import { fetchSound, type Sound } from "../../lib/sounds";
import { editSound, loadSounds, orderSounds, preview, removeSound, SoundEmoji, soundsVersion, Trimmer } from "../call/Soundboard";
import { dragSort, moved } from "../dragSort";
import { openEmojiPicker } from "../chat/overlays";
import type { VoicePrefs } from "../../lib/backend/types";
import { applyVoicePrefs } from "../call/state";
import { Group, Row, Select, Slider } from "../controls";
import { device, ext, updateDevice, updateExt } from "../store";
import { Icon } from "../icons";
import { openSettings } from "../nav";

/** Soundboard settings (from Voice & video): volume, your entry sound, and every sound's emoji, name and volume. */
export function SoundboardSettings() {
  const v = () => device().voice;
  const set = (p: Partial<VoicePrefs>) => { updateDevice({ voice: { ...v(), ...p } }); applyVoicePrefs(); };
  const [sounds, { mutate: setSounds, refetch }] = createResource(soundsVersion, loadSounds);
  const [adding, setAdding] = createSignal<{ file: File; source?: string } | null>(null);
  const [link, setLink] = createSignal("");
  const [linkErr, setLinkErr] = createSignal("");
  const [fetching, setFetching] = createSignal(false);
  let input!: HTMLInputElement;
  async function getLink() {
    setFetching(true); setLinkErr("");
    try { const u = link().trim(); setAdding({ file: await fetchSound(u), source: u }); setLink(""); }
    catch (e) { setLinkErr(e instanceof Error ? e.message : "Couldn't download that sound."); }
    finally { setFetching(false); }
  }
  const reorder = async (from: number, to: number) => {
    const l = sounds() ?? [];
    if (to < 0 || to >= l.length || to === from) return;
    const next = moved(l, from, to);
    setSounds(next); // straight away, then saved
    await orderSounds(next);
    void refetch();
  };
  const change = async (snd: Sound, p: Partial<Pick<Sound, "name" | "emoji" | "volume">>) => {
    const next = await editSound(snd, p);
    setSounds((l) => l?.map((x) => (x.id === snd.id ? next : x)));
  };
  const drop = async (snd: Sound) => {
    if (!confirm(`Delete "${snd.name}"?`)) return;
    await removeSound(snd);
    setSounds((l) => l?.filter((x) => x.id !== snd.id));
  };
  return (
    <div class="page">
      <button class="link small sub-back" onClick={() => openSettings("voice")}><Icon name="back" size={14} />Voice &amp; video</button>
      <Group title="Soundboard" hint="Sounds added from a link (and your entry sound) follow you to every device; sounds added from a file stay on this one.">
        <Row icon="music" label="Soundboard volume"><Slider label="Soundboard volume" min={0} max={100} value={v().soundboardVolume} suffix="%" onChange={(soundboardVolume) => set({ soundboardVolume })} /></Row>
        <Row label="Entry sound" hint="Plays for everyone when you join a call">
          <Select label="Entry sound" value={ext().entrySound ?? v().entrySound} onChange={(entrySound) => { set({ entrySound }); updateExt((x) => ({ ...x, entrySound })); }}
            options={[{ v: "", label: "None" }, ...(sounds() ?? []).map((s) => ({ v: s.id, label: `${/^:\w+:$/.test(s.emoji) ? "" : s.emoji + " "}${s.name}` }))]} />
        </Row>
      </Group>

      <Group title="Add a sound" hint="From a file on this device, or a link: a page from MyInstants, Soundboard Buttons or Sound Buttons World, or a direct audio link (those show up on your other devices too). Up to 10 seconds.">
        <Show when={adding()} fallback={<>
          <Row icon="file" label="From a file"><button class="btn small" onClick={() => input.click()}>Choose file</button></Row>
          <form class="row sb-link" onSubmit={(e) => { e.preventDefault(); if (link().trim()) void getLink(); }}>
            <input class="text-input" type="url" placeholder="https://www.myinstants.com/…" value={link()} onInput={(e) => { setLink(e.currentTarget.value); setLinkErr(""); }} aria-label="Sound link" />
            <button class="btn small primary" disabled={fetching() || !link().trim()}>{fetching() ? "Getting…" : "Get sound"}</button>
          </form>
          <Show when={linkErr()}><p class="err small">{linkErr()}</p></Show>
        </>}>{(f) => <div class="row col"><Trimmer file={f().file} source={f().source} onDone={() => { setAdding(null); void refetch(); }} /></div>}</Show>
        <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) setAdding({ file: f }); }} />
      </Group>

      <Show when={sounds()?.length} fallback={<p class="muted small">No sounds yet.</p>}>
        <Group title="Your sounds" count={sounds()!.length} hint="Change a sound's emoji (server emoji work too), name or volume, or drag it to a new place on the board. Changes to sounds added from a link show on your other devices too.">
          <div class="row col sb-list">
            <For each={sounds()}>{(snd, i) => (
              <div class="sb-edit" data-sort>
                <span class="drag-grip" role="button" tabIndex={0} aria-label={`Move ${snd.name} (drag, or use the arrow keys)`} title="Drag to move"
                  onPointerDown={(e) => dragSort(e, (from, to) => void reorder(from, to))}
                  onKeyDown={(e) => { const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0; if (by) { e.preventDefault(); void reorder(i(), i() + by); } }}><Icon name="grip" size={16} /></span>
                <button class="emoji-btn" aria-label={`Emoji for ${snd.name}`} title="Change emoji" onClick={(e) => openEmojiPicker(e.currentTarget, (p) => void change(snd, { emoji: p.text }))}><SoundEmoji v={snd.emoji} /></button>
                <input class="text-input" value={snd.name} maxLength={32} aria-label="Sound name"
                  onChange={(e) => { const name = e.currentTarget.value.trim(); if (name && name !== snd.name) void change(snd, { name }); else e.currentTarget.value = snd.name; }} />
                <input class="sb-vol" type="range" min={0} max={100} value={Math.round(snd.volume * 100)} aria-label={`Volume for ${snd.name}`} onChange={(e) => void change(snd, { volume: +e.currentTarget.value / 100 })} />
                <button class="icon-btn" aria-label={`Preview ${snd.name}`} title="Preview" onClick={() => void preview(snd.data, snd.volume)}><Icon name="play" size={16} /></button>
                <button class="icon-btn danger" aria-label={`Delete ${snd.name}`} title="Delete" onClick={() => void drop(snd)}><Icon name="trash" size={16} /></button>
              </div>
            )}</For>
          </div>
        </Group>
      </Show>

    </div>
  );
}
