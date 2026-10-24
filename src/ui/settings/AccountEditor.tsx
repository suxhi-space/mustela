import { createSignal, Show } from "solid-js";
import { Avatar } from "../Avatar";
import { Group, Row } from "../controls";
import { backend, bumpMe, meNow } from "../store";

const MAX_AVATAR = 4 * 1024 * 1024;

/** Display name, avatar, about me and custom status: the parts of a Stoat profile everyone sees. */
export function AccountEditor(props: { bio?: string }) {
  const me = () => meNow()!;
  const [name, setName] = createSignal(me().name);
  const [status, setStatus] = createSignal(me().status ?? "");
  const [bio, setBio] = createSignal<string | undefined>(undefined);
  const [avatar, setAvatar] = createSignal<File | null | undefined>(undefined);
  const [state, setState] = createSignal<"idle" | "busy" | "done" | "err">("idle");
  const [err, setErr] = createSignal("");
  let file!: HTMLInputElement;

  const bioNow = () => bio() ?? props.bio ?? "";
  const dirty = () => name() !== me().name || status() !== (me().status ?? "") || bio() !== undefined || avatar() !== undefined;
  const preview = () => avatar() === undefined ? me() : { ...me(), avatarUrl: avatar() ? URL.createObjectURL(avatar()!) : undefined };

  function pick(f?: File) {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setErr("Choose an image file."); return; }
    if (f.size > MAX_AVATAR) { setErr("Avatars can be up to 4 MB."); return; }
    setErr(""); setAvatar(f);
  }
  async function save() {
    setState("busy"); setErr("");
    try {
      await backend()!.updateMe({
        displayName: name() !== me().name ? name() : undefined,
        status: status() !== (me().status ?? "") ? status() : undefined,
        bio: bio(),
        avatar: avatar(),
      });
      setBio(undefined); setAvatar(undefined); bumpMe(); setState("done");
    } catch (e) {
      setState("err"); setErr(e instanceof Error && e.message ? e.message : "Couldn't save. Check your connection and try again.");
    }
  }

  return (
    <Group title="Account" hint="Your name, picture, about me and status are visible to everyone on Stoat, in any app.">
      <Row label={<span class="acct"><Avatar person={preview()} size={44} presence={false} profile={null} /><span><strong>Avatar</strong><small>PNG, JPG or GIF, up to 4 MB</small></span></span>}>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
        <button class="btn small" onClick={() => file.click()}>Change</button>
        <Show when={me().avatarUrl || avatar()}><button class="btn small danger" onClick={() => setAvatar(null)}>Remove</button></Show>
      </Row>
      <Row label="Display name"><input class="text-input" value={name()} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} aria-label="Display name" /></Row>
      <Row label="Custom status"><input class="text-input" value={status()} maxLength={128} placeholder="What are you up to?" onInput={(e) => setStatus(e.currentTarget.value)} aria-label="Custom status" /></Row>
      <div class="row col">
        <span class="row-label">About me</span>
        <textarea class="text-input area" rows={3} maxLength={2000} value={bioNow()} placeholder="Tell people a bit about yourself. Markdown works." onInput={(e) => setBio(e.currentTarget.value)} aria-label="About me" />
      </div>
      <Row label={<span classList={{ err: state() === "err", ok: state() === "done" && !dirty() }}>{state() === "err" ? err() : err() || (state() === "done" && !dirty() ? "Saved." : dirty() ? "You have unsaved changes" : "")}</span>}>
        <button class="btn primary small" disabled={!dirty() || state() === "busy"} onClick={() => void save()}>{state() === "busy" ? "Saving…" : "Save"}</button>
      </Row>
    </Group>
  );
}
