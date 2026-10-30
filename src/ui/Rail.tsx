import { createMemo, createSignal, For, Show } from "solid-js";
import type { ServerFolder, Space } from "../lib/backend/types";
import { Icon } from "./icons";
import { attempt, openMenu, promptDialog, type MenuItem } from "./menu";
import { serverMenu } from "./menus";
import { backend } from "./store";

type Entry = { type: "server"; id: string; s: Space } | { type: "folder"; id: string; f: ServerFolder; servers: Space[] };
type Drop = { id: string; mode: "before" | "into" } | null;

const MIME = "application/x-mustela-server";
const COLOURS: { name: string; v?: string }[] = [
  { name: "Default" }, { name: "Blue", v: "#5865f2" }, { name: "Teal", v: "#1abc9c" }, { name: "Green", v: "#3ba55c" },
  { name: "Yellow", v: "#f0b232" }, { name: "Orange", v: "#f57731" }, { name: "Red", v: "#ed4245" }, { name: "Pink", v: "#eb459e" }, { name: "Purple", v: "#9b59b6" },
];
/** Opens the system colour picker; the folder takes the colour you settle on. */
function pickColour(current: string | undefined, done: (hex: string) => void) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = current && /^#[0-9a-f]{6}$/i.test(current) ? current : "#5865f2";
  input.style.cssText = "position:fixed;left:50%;top:50%;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(input);
  input.addEventListener("change", () => { done(input.value.toLowerCase()); input.remove(); }, { once: true });
  input.addEventListener("blur", () => setTimeout(() => input.remove(), 500), { once: true });
  input.click();
}
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
const newId = () => `folder-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

/**
 * The server list, with Stoat's folders. Drop a server near the top of another
 * to move it there, onto its middle to make a folder, onto a folder to add it.
 * Folders and order sync to your Stoat account like the official client.
 */
/**
 * Folders and order live in the backend, not in the server list, so the list staying the same
 * (the store keeps it in place) must not hide a change: this ticks whenever they may have moved.
 */
const [orderTick, setOrderTick] = createSignal(0);
export const orderChanged = () => setOrderTick((n) => n + 1);

export function Rail(props: { spaces: Space[]; current?: string; onOpen(id: string): void; onAdd(): void; refetch(): void }) {
  const [drop, setDrop] = createSignal<Drop>(null);
  const [dragging, setDragging] = createSignal<string | null>(null);

  // Same resolution as Stoat's Ordering.orderedEntries: folders draw where their id sits, else at their first member.
  const entries = createMemo<Entry[]>(() => {
    orderTick();
    const servers = props.spaces.filter((s) => !s.home);
    const b = backend()!;
    const folders = b.folders(), byId = new Map(folders.map((f) => [f.id, f] as const));
    const folderOf = new Map(folders.flatMap((f) => f.servers.map((s) => [s, f] as const)));
    const known = new Map(servers.map((s) => [s.id, s] as const));
    const out: Entry[] = [], drawn = new Set<string>();
    const take = (id: string) => {
      const f = byId.get(id) ?? folderOf.get(id);
      if (f) {
        if (drawn.has(f.id)) return;
        drawn.add(f.id);
        const list = f.servers.map((sid) => { const s = known.get(sid); known.delete(sid); return s; }).filter((s): s is Space => !!s);
        if (list.length) out.push({ type: "folder", id: f.id, f, servers: list });
        return;
      }
      const s = known.get(id);
      if (s) { known.delete(id); out.push({ type: "server", id, s }); }
    };
    const side = b.sidebar();
    (side.length ? side : servers.map((s) => s.id)).forEach(take);
    [...known.keys()].forEach(take);
    return out;
  });

  async function save(folders: ServerFolder[], top: string[]) {
    // The backend takes the new folders at once; redraw now, not after the round trip.
    const done = attempt(() => backend()!.saveFolders(folders, top));
    orderChanged();
    await done;
    orderChanged();
    props.refetch();
  }
  const state = () => ({ folders: backend()!.folders(), top: entries().map((e) => e.id) });
  /** Take a server out of wherever it is. */
  const lift = (folders: ServerFolder[], top: string[], id: string) => ({
    folders: folders.map((f) => ({ ...f, servers: f.servers.filter((x) => x !== id) })),
    top: top.filter((x) => x !== id),
  });

  async function onDrop(from: string, d: NonNullable<Drop>) {
    if (from === d.id) return;
    let { folders, top } = lift(state().folders, state().top, from);
    const target = folders.find((f) => f.id === d.id), inFolder = folders.find((f) => f.servers.includes(d.id));
    if (d.mode === "into" && target) {
      folders = folders.map((f) => (f.id === target.id ? { ...f, servers: [...f.servers, from] } : f));
    } else if (d.mode === "into" && !inFolder) {
      // Server onto server: a new folder in the target's place, like Discord.
      const f: ServerFolder = { id: newId(), name: "", servers: [d.id, from] };
      folders = [...folders, f];
      top = top.map((x) => (x === d.id ? f.id : x));
    } else if (inFolder) {
      // Dropped beside a server that's inside an open folder: join that folder there.
      folders = folders.map((f) => (f.id === inFolder.id ? { ...f, servers: f.servers.flatMap((x) => (x === d.id ? [from, x] : [x])) } : f));
    } else {
      const at = top.indexOf(d.id);
      top = [...top.slice(0, at), from, ...top.slice(at)];
    }
    // Make sure every top-level id is still there (a folder that lost its last server disappears).
    folders = folders.filter((f) => f.servers.length);
    top = top.filter((x) => !x.startsWith("folder-") || folders.some((f) => f.id === x));
    for (const f of folders) if (!top.includes(f.id)) top.push(f.id);
    await save(folders, top);
  }
  async function moveFolder(from: string, before: string) {
    if (from === before) return;
    const top = state().top.filter((x) => x !== from), at = top.indexOf(before);
    await save(state().folders, at < 0 ? [...top, from] : [...top.slice(0, at), from, ...top.slice(at)]);
  }

  const editFolder = (id: string, patch: Partial<ServerFolder>) => save(state().folders.map((f) => (f.id === id ? { ...f, ...patch } : f)), state().top);
  async function rename(f: ServerFolder) {
    const v = await promptDialog("Folder name", "Name", "Save", f.name, { placeholder: "Gaming", max: 32 });
    if (v !== null) await editFolder(f.id, { name: v.trim() });
  }
  function folderMenu(e: MouseEvent, f: ServerFolder, servers: Space[]) {
    const unread = servers.some((s) => s.channels.some((c) => c.unread));
    openMenu(e, [
      { label: "Mark folder as read", icon: "check-all", disabled: !unread, onSelect: () => servers.forEach((s) => backend()!.markRead({ server: s.id })) },
      { sep: true },
      { label: "Rename folder", icon: "pencil", onSelect: () => rename(f) },
      { label: "Colour", icon: "palette", sub: [
        ...COLOURS.map((c): MenuItem => ({ label: c.name, checked: (f.colour ?? undefined) === c.v, onSelect: () => editFolder(f.id, { colour: c.v }) })),
        { sep: true },
        { label: "Custom colour…", icon: "plus", checked: !!f.colour && !COLOURS.some((c) => c.v === f.colour), onSelect: () => pickColour(f.colour, (colour) => void editFolder(f.id, { colour })) },
      ] },
      { label: f.collapsed ? "Open folder" : "Close folder", icon: "folder", onSelect: () => editFolder(f.id, { collapsed: !f.collapsed }) },
      { sep: true },
      { label: "Remove folder", icon: "close", danger: true, onSelect: () => {
        // Its servers stay where the folder was.
        const top = state().top.flatMap((x) => (x === f.id ? f.servers : [x]));
        void save(state().folders.filter((x) => x.id !== f.id), top);
      } },
    ]);
  }
  function serverRightClick(e: MouseEvent, s: Space) {
    const f = backend()!.folders().find((x) => x.servers.includes(s.id));
    if (!f) return serverMenu(e, s);
    // Stoat's server menu, plus a way out of the folder.
    serverMenu(e, s, [{ label: "Remove from folder", icon: "folder", onSelect: () => {
      const { folders, top } = lift(state().folders, state().top, s.id);
      const at = top.indexOf(f.id);
      void save(folders, [...top.slice(0, at + 1), s.id, ...top.slice(at + 1)]);
    } }]);
  }

  const unread = (s: Space) => s.channels.some((c) => c.unread && !c.muted);
  const mentions = (s: Space) => s.channels.reduce((n, c) => n + (c.mentions ?? 0), 0);
  const zone = (e: DragEvent): "before" | "into" => (e.offsetY < (e.currentTarget as HTMLElement).clientHeight * 0.28 ? "before" : "into");

  const Orb = (op: { s: Space; inFolder?: boolean }) => (
    <button class="orb" classList={{ on: props.current === op.s.id, unread: unread(op.s) && props.current !== op.s.id, "drop-before": drop()?.id === op.s.id && drop()?.mode === "before", "drop-into": drop()?.id === op.s.id && drop()?.mode === "into" && !op.inFolder }}
      title={op.s.name} aria-label={op.s.name} aria-current={props.current === op.s.id ? "true" : undefined} draggable={true}
      onDragStart={(e) => { e.dataTransfer!.setData(MIME, op.s.id); e.dataTransfer!.effectAllowed = "move"; setDragging(op.s.id); }}
      onDragEnd={() => { setDragging(null); setDrop(null); }}
      onDragOver={(e) => { if (!e.dataTransfer?.types.includes(MIME) || dragging() === op.s.id) return; e.preventDefault(); setDrop({ id: op.s.id, mode: op.inFolder || dragging()?.startsWith("folder-") ? "before" : zone(e) }); }}
      onDragLeave={() => drop()?.id === op.s.id && setDrop(null)}
      onDrop={(e) => {
        const from = e.dataTransfer?.getData(MIME), d = drop(); setDrop(null);
        if (!from || !d) return; e.preventDefault();
        void (from.startsWith("folder-") ? moveFolder(from, op.s.id) : onDrop(from, d));
      }}
      onClick={() => props.onOpen(op.s.id)} onContextMenu={(e) => serverRightClick(e, op.s)}>
      <Show when={op.s.iconUrl} fallback={<span>{initials(op.s.name)}</span>}><img src={op.s.iconUrl} alt="" /></Show>
      <Show when={mentions(op.s)}><span class="badge orb-badge">{mentions(op.s)}</span></Show>
      <Show when={op.s.channels.some((c) => c.voice?.length)}>
        <i class="orb-voice" classList={{ live: op.s.channels.some((c) => c.voice?.some((v) => v.screen)) }} title="People are in voice"><Icon name="speaker" size={11} /></i>
      </Show>
    </button>
  );

  return (
    <>
      <For each={entries()}>{(en) => (
        <Show when={en.type === "folder" ? (en as Extract<Entry, { type: "folder" }>) : null} fallback={<Orb s={(en as Extract<Entry, { type: "server" }>).s} />}>{(fe) => {
          const f = () => fe().f, list = () => fe().servers;
          const open = () => !f().collapsed;
          const hasCurrent = () => list().some((s) => s.id === props.current);
          const n = () => list().reduce((t, s) => t + mentions(s), 0);
          return (
            <div class="folder" classList={{ open: open(), "has-current": hasCurrent() }} style={{ "--fc": f().colour ?? "var(--pri)" }}>
              <button class="orb folder-orb" classList={{ unread: !open() && list().some(unread), "drop-before": drop()?.id === f().id && drop()?.mode === "before", "drop-into": drop()?.id === f().id && drop()?.mode === "into" }}
                title={f().name || list().map((s) => s.name).join(", ")} aria-label={`Folder ${f().name || ""}`.trim()} aria-expanded={open()} draggable={true}
                onClick={() => void editFolder(f().id, { collapsed: open() })} onContextMenu={(e) => folderMenu(e, f(), list())}
                onDragStart={(e) => { e.dataTransfer!.setData(MIME, f().id); e.dataTransfer!.effectAllowed = "move"; setDragging(f().id); }}
                onDragEnd={() => { setDragging(null); setDrop(null); }}
                onDragOver={(e) => { if (!e.dataTransfer?.types.includes(MIME) || dragging() === f().id) return; e.preventDefault(); setDrop({ id: f().id, mode: dragging()?.startsWith("folder-") ? "before" : zone(e) }); }}
                onDragLeave={() => drop()?.id === f().id && setDrop(null)}
                onDrop={(e) => {
                  const from = e.dataTransfer?.getData(MIME), d = drop(); setDrop(null);
                  if (!from || !d) return; e.preventDefault();
                  void (from.startsWith("folder-") ? moveFolder(from, f().id) : d.mode === "into" ? onDrop(from, d) : (async () => {
                    // Before a folder: lift the server out and put it there.
                    const { folders, top } = lift(state().folders, state().top, from);
                    const at = top.indexOf(f().id);
                    await save(folders, [...top.slice(0, at), from, ...top.slice(at)]);
                  })());
                }}>
                <Show when={open()} fallback={
                  <span class="folder-grid">
                    <For each={list().slice(0, 4)}>{(s) => <span class="fg-cell"><Show when={s.iconUrl} fallback={initials(s.name).slice(0, 2)}><img src={s.iconUrl} alt="" /></Show></span>}</For>
                  </span>
                }><Icon name="folder" size={22} /></Show>
                <Show when={!open() && n()}><span class="badge orb-badge">{n()}</span></Show>
              </button>
              <Show when={open()}><For each={list()}>{(s) => <Orb s={s} inFolder />}</For></Show>
            </div>
          );
        }}</Show>
      )}</For>
      <button class="orb add" title="Add a server" aria-label="Add a server" onClick={props.onAdd}><Icon name="plus" size={22} /></button>
    </>
  );
}
