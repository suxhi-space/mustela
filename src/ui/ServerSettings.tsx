import { cropImage } from "./Cropper";
import { createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch as Pick, type JSX } from "solid-js";
import { dragSort, moved } from "./dragSort";
import { useBack } from "./back";
import type { ServerInfo } from "../lib/backend/types";
import { Avatar } from "./Avatar";
import { ColorInput, Group, Row, Select, Switch } from "./controls";
import { FlagEditor, OverrideEditor } from "./Permissions";
import { Icon } from "./icons";
import { attempt, confirmDialog, copy, openMenu, promptDialog } from "./menu";
import { createCategory, createChannel } from "./menus";
import { setChannelSettings, setServerSettings, type ServerTab } from "./nav";
import { backend } from "./store";

const b = () => backend()!;
const TABS: { id: ServerTab; label: string; icon: string; can(i: ServerInfo): boolean; group: string }[] = [
  { id: "overview", label: "Overview", icon: "home", can: () => true, group: "Server" },
  { id: "identity", label: "Your profile here", icon: "user", can: () => true, group: "You" },
  { id: "channels", label: "Channels", icon: "hash", can: (i) => i.perms.manageChannels, group: "Server" },
  { id: "roles", label: "Roles", icon: "shield", can: (i) => i.perms.manageRoles, group: "Server" },
  { id: "discover", label: "Discover", icon: "compass", can: (i) => i.perms.manageServer, group: "Server" },
  { id: "emojis", label: "Emojis", icon: "smile", can: () => true, group: "Customisation" },
  { id: "members", label: "Members", icon: "users", can: (i) => i.perms.kick || i.perms.ban || i.perms.manageRoles, group: "People" },
  { id: "invites", label: "Invites", icon: "link", can: () => true, group: "People" },
  { id: "bans", label: "Bans", icon: "ban", can: (i) => i.perms.ban, group: "People" },
];

/** Re-reads after a change: the server object updates over the socket. */
function useTick() {
  const [t, setT] = createSignal(0);
  return [t, () => setT(t() + 1)] as const;
}

function Overview(props: { info: ServerInfo; bump(): void }) {
  const can = () => props.info.perms.manageServer;
  const [name, setName] = createSignal(props.info.name);
  const [desc, setDesc] = createSignal(props.info.description ?? "");
  const dirty = () => name().trim() !== props.info.name || desc() !== (props.info.description ?? "");
  const pick = (kind: "icon" | "banner") => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*";
    // Through the crop tool first, like profile pictures (square icon, 16:9 banner); GIFs can skip it to keep moving.
    i.onchange = () => { const f = i.files?.[0]; if (f) void cropImage(f, kind === "icon" ? "server-icon" : "server-banner").then((c) => c && attempt(() => b().editServer(props.info.id, { [kind]: c }), "Saved").then(props.bump)); };
    i.click();
  };
  return (
    <div class="page">
      <div class="ss-hero" classList={{ editable: can() }} onClick={(e) => can() && pick((e.target as Element).closest(".ss-icon") ? "icon" : "banner")} style={props.info.bannerUrl ? { "background-image": `url("${props.info.bannerUrl.replace(/"/g, "%22")}")` } : {}}>
        <span class="ss-icon">
          <Show when={props.info.iconUrl} fallback={<span>{props.info.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>}><img src={props.info.iconUrl} alt="" /></Show>
        </span>
      </div>
      {/* Change and remove under the banner, one tile each (on a phone, four buttons on the banner spilled over it). */}
      <Show when={can()}>
        <div class="ss-pics">
          <div class="ss-pic">
            <span>Server icon</span>
            <button class="btn small" onClick={() => pick("icon")}>{props.info.iconUrl ? "Change" : "Add"}</button>
            <Show when={props.info.iconUrl}><button class="icon-btn danger" aria-label="Remove icon" title="Remove icon" onClick={() => void attempt(() => b().editServer(props.info.id, { icon: null }), "Icon removed").then(props.bump)}><Icon name="trash" size={18} /></button></Show>
          </div>
          <div class="ss-pic">
            <span>Banner</span>
            <button class="btn small" onClick={() => pick("banner")}>{props.info.bannerUrl ? "Change" : "Add"}</button>
            <Show when={props.info.bannerUrl}><button class="icon-btn danger" aria-label="Remove banner" title="Remove banner" onClick={() => void attempt(() => b().editServer(props.info.id, { banner: null }), "Banner removed").then(props.bump)}><Icon name="trash" size={18} /></button></Show>
          </div>
        </div>
      </Show>
      <Group title="Server">
        <div class="row col">
          <label class="field">Server name<input value={name()} maxLength={32} disabled={!can()} onInput={(e) => setName(e.currentTarget.value)} /></label>
        </div>
        <div class="row col">
          <label class="field">Description<textarea class="text-input area" maxLength={1024} disabled={!can()} value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} placeholder="What this server is about" /></label>
        </div>
      </Group>
      <Show when={can()}>
        <div class="dialog-actions">
          <button class="btn primary" disabled={!dirty() || !name().trim()} onClick={() => void attempt(() => b().editServer(props.info.id, { name: name().trim(), description: desc() }), "Saved").then(props.bump)}>Save changes</button>
        </div>
      </Show>
      <Show when={!can()}><p class="group-hint">You need the Manage Server permission to change these.</p></Show>
      <SystemMessages info={props.info} />
      <Group title="About">
        <Row label="Server ID"><button class="btn small" onClick={() => void copy(props.info.id, "ID copied")}><Icon name="copy" size={14} />Copy</button></Row>
        <Row label="Owner"><span class="muted">{props.info.isOwner ? "You" : b().person(props.info.ownerId).name}</span></Row>
      </Group>
    </div>
  );
}

/** Where Stoat posts "joined", "left", "kicked" and "banned" messages. */
function SystemMessages(props: { info: ServerInfo }) {
  const d = () => b().serverDetails(props.info.id);
  const [sm, setSm] = createSignal({ ...(d()?.systemMessages ?? {}) });
  const chans = () => b().channelsIn(props.info.id).filter((c) => c.kind === "text");
  const opts = () => [{ v: "", label: "Don't post" }, ...chans().map((c) => ({ v: c.id, label: `#${c.name}` }))];
  const can = () => props.info.perms.manageServer;
  const kinds = [["user_joined", "Someone joins"], ["user_left", "Someone leaves"], ["user_kicked", "Someone is kicked"], ["user_banned", "Someone is banned"]] as const;
  const dirty = () => kinds.some(([k]) => (sm() as any)[k] !== ((d()?.systemMessages ?? {}) as any)[k]);
  return (
    <Group title="System messages" hint="Where Stoat posts a message when people come and go.">
      <For each={kinds}>{([k, label]) => (
        <Row label={label}><Select label={label} value={(sm() as any)[k] ?? ""} options={opts()} onChange={(v) => setSm({ ...sm(), [k]: v || undefined })} /></Row>
      )}</For>
      <Show when={can() && dirty()}>
        <div class="dialog-actions"><button class="btn primary" onClick={() => void attempt(() => b().editServerExtras(props.info.id, { systemMessages: sm() }), "Saved")}>Save system messages</button></div>
      </Show>
    </Group>
  );
}

/** Stoat's Discover: ask for the server to be listed, and see how the request is going. */
function Discover(props: { info: ServerInfo }) {
  const [st, { refetch }] = createResource(() => b().discoverState(props.info.id));
  const text: Record<string, [string, string]> = {
    none: ["Not listed", "Ask Stoat to list this server in Discover, so people can find and join it."],
    pending: ["Request sent", "Stoat is looking at your request. This page updates once it's been decided."],
    approved: ["Listed in Discover", "People can find this server in Discover. Contact Stoat support to remove it."],
    rejected: ["Not accepted", "Stoat didn't accept the request this time. Check Stoat's Discover guidelines, then ask again."],
    unavailable: ["Not available", "Discover is only for servers on stoat.chat, or the request status couldn't be loaded right now."],
  };
  return (
    <div class="page">
      <Group title="Discover">
        <Show when={st()} fallback={<div class="loading-row"><div class="spinner small" /></div>}>{(s) => (
          <Row icon="compass" label={text[s()]![0]} hint={text[s()]![1]}>
            <Show when={s() === "none" || s() === "rejected"}>
              <button class="btn small primary" onClick={() => void attempt(() => b().requestDiscover(props.info.id), "Request sent").then(refetch)}>Request listing</button>
            </Show>
          </Row>
        )}</Show>
      </Group>
    </div>
  );
}

/** Your nickname and avatar in this server only (Stoat stores these; everyone sees them). */
function Identity(props: { info: ServerInfo }) {
  const [cur, { refetch }] = createResource(() => b().identity(props.info.id).catch(() => ({ nickname: undefined, avatarUrl: undefined })));
  const [nick, setNick] = createSignal<string | null>(null);
  const value = () => nick() ?? cur()?.nickname ?? "";
  const me = () => b().me;
  const pickAvatar = () => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*";
    i.onchange = () => { const f = i.files?.[0]; if (f) void attempt(() => b().editIdentity(props.info.id, { avatar: f }), "Server avatar saved").then(() => setTimeout(() => void refetch(), 400)); };
    i.click();
  };
  return (
    <div class="page">
      <Group title={`Your profile in ${props.info.name}`} hint="Only this server sees these. Everywhere else you keep your usual name and picture.">
        <Row label="Server avatar" hint={cur()?.avatarUrl ? "Shown instead of your usual picture here" : "Using your usual picture"}>
          <Avatar person={{ ...me(), avatarUrl: cur()?.avatarUrl ?? me().avatarUrl }} size={40} presence={false} still />
          <button class="btn small" onClick={pickAvatar}>Change</button>
          <Show when={cur()?.avatarUrl}><button class="btn small danger" onClick={() => void attempt(() => b().editIdentity(props.info.id, { avatar: null }), "Removed").then(() => setTimeout(() => void refetch(), 400))}>Remove</button></Show>
        </Row>
        <div class="row col">
          <label class="field">Nickname<input value={value()} maxLength={32} placeholder={me().name} onInput={(e) => setNick(e.currentTarget.value)} /></label>
        </div>
      </Group>
      <div class="dialog-actions">
        <button class="btn" disabled={nick() === null} onClick={() => setNick(null)}>Reset</button>
        <button class="btn primary" disabled={nick() === null || nick() === (cur()?.nickname ?? "")} onClick={() => void attempt(() => b().editIdentity(props.info.id, { nickname: nick()!.trim() || null }), "Saved").then(() => { setNick(null); setTimeout(() => void refetch(), 400); })}>Save</button>
      </div>
    </div>
  );
}

/**
 * Channels grouped under their categories, like Stoat's: "Uncategorised" first, then each category with its count
 * and a menu (create a channel in it, rename, delete). Drag a category or a channel by its handle to reorder (finger
 * or mouse); a channel's menu moves it to another category. Tap a channel for its own settings. Everything saves to
 * the server's real category order.
 */
function Channels(props: { info: ServerInfo }) {
  const sid = props.info.id;
  const [spaces, { refetch }] = createResource(() => b().spaces());
  const [tick, bump] = useTick();
  const refresh = () => { void refetch(); bump(); setTimeout(bump, 600); };
  onCleanup(b().onEvent((e) => { if (e.t === "activity") refresh(); }));
  const chans = () => spaces()?.find((s) => s.id === sid)?.channels.filter((c) => c.kind === "text" || c.kind === "voice") ?? [];
  const cats = createMemo(() => { tick(); spaces(); return b().categories(sid); });
  const byId = (id: string) => chans().find((c) => c.id === id);
  const inCats = createMemo(() => new Set(cats().flatMap((c) => c.channels)));
  const loose = () => chans().filter((c) => !inCats().has(c.id));
  const save = (next: typeof cats extends () => infer T ? T : never) => attempt(() => b().saveCategories(sid, next)).then(refresh);
  const moveCat = (from: number, to: number) => void save(moved(cats(), from, to));
  const moveIn = (catId: string, from: number, to: number) => void save(cats().map((c) => (c.id === catId ? { ...c, channels: moved(c.channels.filter(byId), from, to) } : c)));
  const moveTo = (chId: string, catId: string | null) => void save(cats().map((c) => ({ ...c, channels: c.id === catId ? [...c.channels.filter((x) => x !== chId), chId] : c.channels.filter((x) => x !== chId) })));
  const catMenu = (el: Element, cat: { id: string; title: string }, i: number) => openMenu(el, [
    { label: "Create channel", icon: "plus", sub: [
      { label: "Text channel", icon: "hash", onSelect: () => void createChannel(sid, "text", cat.id).then(refresh) },
      { label: "Voice channel", icon: "speaker", onSelect: () => void createChannel(sid, "voice", cat.id).then(refresh) },
    ] },
    { label: "Rename category", icon: "pencil", onSelect: async () => {
      const v = await promptDialog("Rename category", "Category name", "Save", cat.title, { max: 32 });
      if (v?.trim() && v.trim() !== cat.title) await save(cats().map((c) => (c.id === cat.id ? { ...c, title: v.trim() } : c)));
    } },
    ...(i > 0 ? [{ label: "Move up", icon: "up", onSelect: () => moveCat(i, i - 1) }] : []),
    ...(i < cats().length - 1 ? [{ label: "Move down", icon: "down", onSelect: () => moveCat(i, i + 1) }] : []),
    { sep: true },
    { label: "Delete category", icon: "trash", danger: true, onSelect: async () => {
      if (await confirmDialog(`Delete ${cat.title}?`, "Its channels aren't deleted. They move to Uncategorised.", "Delete category", true)) await save(cats().filter((c) => c.id !== cat.id));
    } },
  ]);
  const chanMenu = (el: Element, ch: { id: string; name: string }, catId: string | null, i: number, n: number) => openMenu(el, [
    { label: "Channel settings", icon: "gear", onSelect: () => setChannelSettings({ id: ch.id }) },
    ...(catId && i > 0 ? [{ label: "Move up", icon: "up", onSelect: () => moveIn(catId, i, i - 1) }] : []),
    ...(catId && i < n - 1 ? [{ label: "Move down", icon: "down", onSelect: () => moveIn(catId, i, i + 1) }] : []),
    { label: "Move to category", icon: "folder", sub: [
      { label: "Uncategorised", checked: !catId, onSelect: () => moveTo(ch.id, null) },
      ...cats().map((c) => ({ label: c.title, checked: c.id === catId, onSelect: () => moveTo(ch.id, c.id) })),
    ] },
    { label: "Rename", icon: "pencil", onSelect: async () => {
      const v = await promptDialog("Rename channel", "Channel name", "Save", ch.name, { max: 32 });
      if (v?.trim()) await attempt(() => b().editChannel(ch.id, { name: v.trim() }), "Saved").then(refresh);
    } },
    { sep: true },
    { label: "Delete channel", icon: "trash", danger: true, onSelect: async () => {
      if (await confirmDialog(`Delete #${ch.name}?`, "Every message in it is deleted too. This can't be undone.", "Delete channel", true)) await attempt(() => b().deleteChannel(ch.id), "Channel deleted").then(refresh);
    } },
  ]);
  const ChanRow = (p: { id: string; catId: string | null; i: number; n: number }) => {
    const c = () => byId(p.id);
    return (
      <Show when={c()}>{(ch) => (
        <div class="cc-row" data-sort>
          <Show when={p.catId}><button class="icon-btn cc-grip" aria-label={`Drag ${ch().name}`} title="Drag to reorder" onPointerDown={(e) => dragSort(e, (from, to) => moveIn(p.catId!, from, to))}><Icon name="grip" size={16} /></button></Show>
          <button class="cc-open" onClick={() => setChannelSettings({ id: ch().id })}>
            <Icon name={ch().kind === "voice" ? "speaker" : "hash"} size={17} class="muted" /><span>{ch().name}</span>
          </button>
          <button class="icon-btn" aria-label={`${ch().name} options`} title="Options" onClick={(e) => chanMenu(e.currentTarget, ch(), p.catId, p.i, p.n)}><Icon name="dots" size={18} /></button>
        </div>
      )}</Show>
    );
  };
  return (
    <div class="page cc-page">
      <div class="dialog-actions start">
        <button class="btn small primary" onClick={() => void createChannel(sid, "text").then(refresh)}><Icon name="hash" size={14} />New text channel</button>
        <button class="btn small" onClick={() => void createChannel(sid, "voice").then(refresh)}><Icon name="speaker" size={14} />New voice channel</button>
        <button class="btn small" onClick={() => void createCategory(sid).then(refresh)}><Icon name="folder" size={14} />New category</button>
      </div>
      <Show when={loose().length || !cats().length}>
        <section class="cc-cat">
          <header class="cc-head"><span class="cc-title">Uncategorised</span><span class="count">{loose().length}</span></header>
          <div class="cc-list">
            <For each={loose()} fallback={<p class="muted small cc-empty">No channels yet.</p>}>{(c, i) => <ChanRow id={c.id} catId={null} i={i()} n={loose().length} />}</For>
          </div>
        </section>
      </Show>
      <div class="cc-cats">
        <For each={cats()}>{(cat, i) => {
          const ids = () => cat.channels.filter(byId);
          return (
            <section class="cc-cat" data-sort>
              <header class="cc-head">
                <button class="icon-btn cc-grip" aria-label={`Drag ${cat.title}`} title="Drag to reorder" onPointerDown={(e) => dragSort(e, moveCat)}><Icon name="grip" size={16} /></button>
                <span class="cc-title">{cat.title}</span><span class="count">{ids().length}</span><span class="grow" />
                <button class="icon-btn" aria-label={`${cat.title} options`} title="Options" onClick={(e) => catMenu(e.currentTarget, cat, i())}><Icon name="dots" size={18} /></button>
              </header>
              <div class="cc-list">
                <For each={ids()} fallback={<p class="muted small cc-empty">Empty. Use ⋮ to create a channel here, or move one in.</p>}>{(id, k) => <ChanRow id={id} catId={cat.id} i={k()} n={ids().length} />}</For>
              </div>
            </section>
          );
        }}</For>
      </div>
    </div>
  );
}

function Roles(props: { info: ServerInfo }) {
  const [tick, bump] = useTick();
  const roles = createMemo(() => { tick(); return [...b().roles(props.info.id)].sort((a, c) => a.rank - c.rank); });
  const details = createMemo(() => { tick(); return b().serverDetails(props.info.id); });
  const defaults = () => details()?.defaultPerms;
  const rolePerms = (id: string) => details()?.rolePerms[id] ?? { allow: 0, deny: 0 };
  const [open, setOpen] = createSignal<string | null>(null);
  const toggle = (id: string) => setOpen(open() === id ? null : id);
  const later = () => { bump(); setTimeout(bump, 600); };
  async function reorder(from: number, to: number) {
    const ids = roles().map((r) => r.id);
    if (to < 0 || to >= ids.length || to === from) return;
    await attempt(() => b().setRoleOrder(props.info.id, moved(ids, from, to))).then(later);
  }
  return (
    <div class="page">
      <Group title="Everyone" hint="What everyone in the server can do. Roles add to this.">
        <Row icon="users" label="Default permissions">
          <button class="btn small" aria-expanded={open() === "default"} onClick={() => toggle("default")}>{open() === "default" ? "Close" : "Edit"}</button>
        </Row>
        <Show when={open() === "default"}>
          <div class="role-perms"><FlagEditor value={defaults() ?? 0} disabled={!props.info.perms.manageRoles} onChange={(v) => void attempt(() => b().setServerPermissions(props.info.id, "default", v), "Saved").then(later)} /></div>
        </Show>
      </Group>
      <Group title="Roles" count={roles().length} action={
        <button class="btn small primary" onClick={async () => {
          const n = await promptDialog("Create role", "Role name", "Create role", "", { max: 32, placeholder: "Moderators" });
          if (n?.trim()) await attempt(() => b().createRole(props.info.id, n.trim()), "Role created").then(bump);
        }}><Icon name="plus" size={14} />New role</button>
      } hint="Higher roles are listed first: drag one by its handle to move it (only below your own highest role). A role's permissions add to what everyone can do, ✕ takes one away.">
        <For each={roles()} fallback={<Row label={<span class="muted">No roles yet. Everyone has the default permissions.</span>} />}>{(r, i) => (<div class="sort-item" data-sort>
          <Row label={<span class="ss-role">
            {/* Drag to a new place (Stoat only lets you move roles below your own highest role); arrow keys work too. */}
            <span class="drag-grip" role="button" tabIndex={0} aria-label={`Move ${r.name} (drag, or use the arrow keys)`} title="Drag to move"
              onPointerDown={(e) => dragSort(e, (from, to) => void reorder(from, to))}
              onKeyDown={(e) => { const by = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0; if (by) { e.preventDefault(); void reorder(i(), i() + by); } }}><Icon name="grip" size={16} /></span>
            <Show when={r.iconUrl} fallback={<i style={{ background: r.colour && !/gradient/.test(r.colour) ? r.colour : "var(--fg2)" }} />}><img class="ss-role-icon" src={r.iconUrl} alt="" /></Show>
            {r.name}</span>}>
            <label class="icon-btn" title={r.iconUrl ? "Change role icon" : "Add a role icon"} aria-label={`Icon for ${r.name}`}>
              <Icon name="image" size={16} />
              <input type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => {
                const f = e.currentTarget.files?.[0]; e.currentTarget.value = "";
                if (f) void cropImage(f, "icon", `Crop ${r.name}'s icon`).then((c) => c && attempt(() => b().editRole(props.info.id, r.id, { icon: c }), "Icon saved").then(later));
              }} />
            </label>
            <Show when={r.iconUrl}><button class="icon-btn" aria-label={`Remove ${r.name}'s icon`} title="Remove icon" onClick={() => void attempt(() => b().editRole(props.info.id, r.id, { icon: null }), "Icon removed").then(later)}><Icon name="close" size={14} /></button></Show>
            <span class="small muted">Show separately</span>
            <Switch label={`Show ${r.name} separately in the member list`} on={r.hoist} onChange={(v) => void attempt(() => b().editRole(props.info.id, r.id, { hoist: v })).then(bump)} />
            <ColorInput label={`${r.name} colour`} value={r.colour && /^#[0-9a-f]{6}$/i.test(r.colour) ? r.colour : "#999999"} onChange={(hex) => void attempt(() => b().editRole(props.info.id, r.id, { colour: hex }), "Colour saved").then(later)} />
            <button class="btn small" aria-expanded={open() === r.id} onClick={() => toggle(r.id)}>Permissions</button>
            <button class="icon-btn" aria-label={`Rename ${r.name}`} title="Rename" onClick={async () => {
              const v = await promptDialog("Rename role", "Role name", "Save", r.name, { max: 32 });
              if (v?.trim()) await attempt(() => b().editRole(props.info.id, r.id, { name: v.trim() }), "Saved").then(bump);
            }}><Icon name="pencil" size={16} /></button>
            <button class="icon-btn danger" aria-label={`Delete ${r.name}`} title="Delete" onClick={async () => {
              if (await confirmDialog(`Delete ${r.name}?`, "Everyone with this role loses it.", "Delete role", true)) await attempt(() => b().deleteRole(props.info.id, r.id), "Role deleted").then(bump);
            }}><Icon name="trash" size={16} /></button>
          </Row>
          <Show when={open() === r.id}>
            <div class="role-perms"><OverrideEditor value={rolePerms(r.id)} channel={false} onChange={(o) => void attempt(() => b().setServerPermissions(props.info.id, r.id, o), "Saved").then(later)} /></div>
          </Show>
        </div>)}</For>
      </Group>
    </div>
  );
}

function Emojis(props: { info: ServerInfo }) {
  const [tick, bump] = useTick();
  const list = createMemo(() => { tick(); return b().serverEmojis(props.info.id); });
  const can = () => props.info.perms.manageEmoji;
  const [file, setFile] = createSignal<File | null>(null);
  const [name, setName] = createSignal("");
  const preview = createMemo(() => { const f = file(); return f ? URL.createObjectURL(f) : null; });
  const valid = () => /^[a-z0-9_]{1,32}$/.test(name());
  return (
    <div class="page">
      <Show when={can()}>
        <Group title="Upload emoji" hint="PNG, GIF or WebP, up to 500 KB. Names use lowercase letters, numbers and underscores.">
          <div class="row ss-emoji-up">
            <label class="ss-emoji-drop" title="Choose an image">
              <Show when={preview()} fallback={<Icon name="plus" size={22} />}><img src={preview()!} alt="" /></Show>
              <input type="file" accept="image/png,image/gif,image/webp,image/jpeg" hidden onChange={(e) => {
                const f = e.currentTarget.files?.[0]; e.currentTarget.value = "";
                if (!f) return;
                setFile(f);
                if (!name()) setName(f.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 32));
              }} />
            </label>
            <input class="text-input" placeholder="emoji_name" value={name()} maxLength={32} aria-label="Emoji name" onInput={(e) => setName(e.currentTarget.value.toLowerCase())} />
            <button class="btn small primary" disabled={!file() || !valid()} onClick={() => void attempt(async () => {
              if (file()!.size > 500 * 1024) throw new Error("That image is over 500 KB.");
              await b().uploadEmoji(props.info.id, name(), file()!);
              setFile(null); setName(""); bump();
            }, "Emoji added")}>Upload</button>
          </div>
        </Group>
      </Show>
      <Group title="Emojis" count={list().length}>
        <div class="ss-emoji-grid">
          <For each={list()} fallback={<p class="muted small" style={{ padding: "12px" }}>No custom emojis yet.</p>}>{(e) => (
            <div class="ss-emoji">
              <img src={e.url} alt="" />
              <span>:{e.name}:</span>
              <Show when={can()}>
                <button class="icon-btn" aria-label={`Rename :${e.name}:`} title="Rename" onClick={async () => {
                  const v = await promptDialog(`Rename :${e.name}:`, "Emoji name", "Save", e.name, { max: 32, placeholder: "emoji_name" });
                  const name = v?.trim().toLowerCase();
                  if (!name || name === e.name) return;
                  if (!/^[a-z0-9_]{1,32}$/.test(name)) { await confirmDialog("That name won't work", "Use lowercase letters, numbers and underscores.", "OK"); return; }
                  await attempt(() => b().renameEmoji(e.id, name), "Emoji renamed").then(bump);
                }}><Icon name="pencil" size={14} /></button>
                <button class="icon-btn danger" aria-label={`Delete :${e.name}:`} title="Delete" onClick={async () => {
                  if (await confirmDialog(`Delete :${e.name}:?`, "It disappears from messages that used it.", "Delete emoji", true)) await attempt(() => b().deleteEmoji(e.id), "Emoji deleted").then(bump);
                }}><Icon name="trash" size={14} /></button>
              </Show>
            </div>
          )}</For>
        </div>
      </Group>
    </div>
  );
}

function Members(props: { info: ServerInfo }) {
  const [groups, { refetch }] = createResource(() => b().members(props.info.id).catch(() => []));
  const [q, setQ] = createSignal("");
  const people = () => {
    const seen = new Map<string, ReturnType<typeof b>["me"]>();
    for (const g of groups() ?? []) for (const p of g.people) seen.set(p.id, p);
    const s = q().trim().toLowerCase();
    return [...seen.values()].filter((p) => !s || p.name.toLowerCase().includes(s) || p.username?.toLowerCase().includes(s));
  };
  const roles = () => b().roles(props.info.id);
  const [open, setOpen] = createSignal<string | null>(null);
  return (
    <div class="page">
      <input class="text-input wide" placeholder="Search members" value={q()} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Search members" />
      <Group title="Members" count={people().length}>
        <For each={people()}>{(p) => {
          const [mine, { refetch: reRoles }] = createResource(() => (open() === p.id ? p.id : null), (id) => b().memberRoles(props.info.id, id).catch(() => [] as string[]));
          const isOwner = p.id === props.info.ownerId, isMe = p.id === b().me.id;
          return (
            <>
              <Row label={<span class="ss-member"><Avatar person={p} size={28} still />{p.name}<Show when={p.username}><small class="muted">{p.username}{p.discriminator ? `#${p.discriminator}` : ""}</small></Show><Show when={isOwner}><span class="tag">Owner</span></Show></span>}>
                <Show when={props.info.perms.manageRoles}><button class="btn small" aria-expanded={open() === p.id} onClick={() => setOpen(open() === p.id ? null : p.id)}>Roles</button></Show>
                <Show when={props.info.perms.kick && !isOwner && !isMe}>
                  <button class="btn small danger" onClick={async () => { if (await confirmDialog(`Kick ${p.name}?`, "They can rejoin with an invite.", "Kick", true)) await attempt(() => b().kick(props.info.id, p.id), "Kicked").then(refetch); }}>Kick</button>
                </Show>
                <Show when={props.info.perms.ban && !isOwner && !isMe}>
                  <button class="btn small danger" onClick={async () => {
                    const r = await promptDialog(`Ban ${p.name}?`, "Reason (optional)", "Ban", "", { danger: true, max: 1024 });
                    if (r !== null) await attempt(() => b().ban(props.info.id, p.id, r.trim() || undefined), "Banned").then(refetch);
                  }}>Ban</button>
                </Show>
              </Row>
              <Show when={open() === p.id}>
                <div class="row ss-role-pick">
                  <For each={roles()} fallback={<span class="muted small">This server has no roles yet.</span>}>{(r) => {
                    const has = () => (mine() ?? []).includes(r.id);
                    return (
                      <button class="chip" classList={{ on: has() }} aria-pressed={has()} onClick={() => void attempt(() => b().setMemberRoles(props.info.id, p.id, has() ? mine()!.filter((x) => x !== r.id) : [...(mine() ?? []), r.id])).then(reRoles)}>
                        <i style={{ background: r.colour && !/gradient/.test(r.colour) ? r.colour : "var(--fg2)" }} />{r.name}
                      </button>
                    );
                  }}</For>
                </div>
              </Show>
            </>
          );
        }}</For>
      </Group>
    </div>
  );
}

function Invites(props: { info: ServerInfo }) {
  const [list, { refetch }] = createResource(() => b().invites(props.info.id).catch(() => null));
  const base = () => b().linkFor(props.info.id).replace(/\/(server|channel)\/.*$/, "");
  return (
    <div class="page">
      <Show when={list() !== null} fallback={<p class="group-hint">Only people who can manage the server can see its invites.</p>}>
        <Group title="Invites" count={list()?.length ?? 0}>
          <For each={list() ?? []} fallback={<Row label={<span class="muted">No invites yet. Right-click the server and choose Create invite.</span>} />}>{(i) => (
            <Row label={<code class="ss-code">{i.code}</code>} hint={[i.creator ? `By ${i.creator.name}` : "", i.channelName ? `#${i.channelName}` : ""].filter(Boolean).join(", ")}>
              <button class="btn small" onClick={() => void copy(`${base()}/invite/${i.code}`, "Invite link copied")}><Icon name="copy" size={14} />Copy link</button>
              <Show when={props.info.perms.manageServer}>
                <button class="icon-btn danger" aria-label={`Revoke ${i.code}`} title="Revoke" onClick={() => void attempt(() => b().deleteInvite(i.code), "Invite revoked").then(refetch)}><Icon name="trash" size={16} /></button>
              </Show>
            </Row>
          )}</For>
        </Group>
      </Show>
    </div>
  );
}

function Bans(props: { info: ServerInfo }) {
  const [list, { refetch }] = createResource(() => b().bans(props.info.id).catch(() => []));
  return (
    <div class="page">
      <Group title="Bans" count={list()?.length ?? 0}>
        <For each={list() ?? []} fallback={<Row label={<span class="muted">No one is banned.</span>} />}>{(x) => (
          <Row label={<span class="ss-member"><Avatar person={x.person} size={28} still presence={false} />{x.person.name}</span>} hint={x.reason ? `Reason: ${x.reason}` : undefined}>
            <button class="btn small" onClick={() => void attempt(() => b().unban(props.info.id, x.person.id), "Unbanned").then(refetch)}>Unban</button>
          </Row>
        )}</For>
      </Group>
    </div>
  );
}

export function ServerSettings(props: { id: string; tab?: ServerTab }) {
  const [tick, bump] = useTick();
  const info = createMemo(() => { tick(); return b().serverInfo(props.id); });
  const [tab, setTabRaw] = createSignal<ServerTab>(props.tab ?? "overview");
  const close = () => setServerSettings(null);
  // Phones (like your own Settings): the menu fills the screen, a section opens full screen with a back arrow.
  const [narrow, setNarrow] = createSignal(!props.tab);
  const setTab = (t: ServerTab) => { setTabRaw(t); setNarrow(false); };
  const small = () => matchMedia("(max-width: 900px)").matches;
  useBack(() => (narrow() || !small() ? close() : setNarrow(true)));
  const tabs = () => TABS.filter((t) => info() && t.can(info()!));
  const groups = () => [...new Set(tabs().map((t) => t.group))];
  const page = (id: ServerTab, el: () => JSX.Element) => <Match when={tab() === id}>{el()}</Match>;
  return (
    <div class="settings stepped" role="dialog" aria-label="Server settings" data-narrow={narrow() ? "nav" : "page"} onKeyDown={(e) => e.key === "Escape" && close()} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="settings-card">
      <header class="bar settings-bar panel">
        <h2>{info()?.name ?? "Server"} settings</h2>
        <span class="grow" />
        <button class="icon-btn" onClick={close} aria-label="Close server settings"><Icon name="close" size={20} /></button>
      </header>
      <Show when={info()} fallback={<p class="empty center">This server isn't available.</p>}>{(i) => (
        <div class="settings-body">
          <nav class="snav panel" role="tablist" aria-label="Server settings sections">
            <div class="snav-top">
              <button class="icon-btn" onClick={close} aria-label="Close server settings"><Icon name="back" size={22} /></button>
              <h2>{i().name}</h2>
            </div>
            <For each={groups()}>{(g) => (
              <>
                <h3 class="snav-head">{g}</h3>
                <For each={tabs().filter((t) => t.group === g)}>{(t) => (
                  <button role="tab" aria-selected={tab() === t.id} classList={{ on: tab() === t.id }} onClick={() => setTab(t.id)}><Icon name={t.icon} size={18} />{t.label}</button>
                )}</For>
              </>
            )}</For>
            <span class="grow" />
            <Show when={i().isOwner}>
              <button class="danger" onClick={async () => {
                const typed = await promptDialog(`Delete ${i().name}?`, `Type the server name to confirm`, "Delete server", "", { danger: true, body: "Every channel and message is deleted for everyone. This can't be undone.", max: 64 });
                if (typed === null) return;
                if (typed.trim() !== i().name) { await confirmDialog("The name didn't match", "Nothing was deleted.", "OK"); return; }
                await attempt(() => b().deleteServer(i().id), "Server deleted").then(close);
              }}><Icon name="trash" size={18} />Delete server</button>
            </Show>
            <Show when={!i().isOwner}>
              <button class="danger" onClick={async () => {
                if (await confirmDialog(`Leave ${i().name}?`, "You'll need a new invite to come back.", "Leave server", true)) await attempt(() => b().leaveServer(i().id), "Left the server").then(close);
              }}><Icon name="door" size={18} />Leave server</button>
            </Show>
          </nav>
          <div class="spage panel" role="tabpanel">
            <header class="spage-head stepped-head">
              <button class="icon-btn snav-back" onClick={() => setNarrow(true)} aria-label="All server settings"><Icon name="back" size={22} /></button>
              <h2>{TABS.find((t) => t.id === tab())?.label}</h2>
            </header>
            <Pick>
              {page("overview", () => <Overview info={i()} bump={bump} />)}
              {page("identity", () => <Identity info={i()} />)}
              {page("channels", () => <Channels info={i()} />)}
              {page("roles", () => <Roles info={i()} />)}
              {page("discover", () => <Discover info={i()} />)}
              {page("emojis", () => <Emojis info={i()} />)}
              {page("members", () => <Members info={i()} />)}
              {page("invites", () => <Invites info={i()} />)}
              {page("bans", () => <Bans info={i()} />)}
            </Pick>
          </div>
        </div>
      )}</Show>
      </div>
    </div>
  );
}
