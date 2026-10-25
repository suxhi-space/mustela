import { createResource, createSignal, For, Show } from "solid-js";
import type { BotRow } from "../../lib/backend/types";
import { Avatar } from "../Avatar";
import { Group, Row, Switch } from "../controls";
import { Icon } from "../icons";
import { attempt, confirmDialog, copy, promptDialog } from "../menu";
import { backend } from "../store";

/** Stoat's "My Bots": create bots, copy tokens, make them public, delete them. */
export function BotsPage() {
  const acc = () => backend()!.account;
  const [bots, { refetch }] = createResource(() => acc().bots());
  const [open, setOpen] = createSignal<string | null>(null);

  async function create() {
    const name = await promptDialog("Create a bot", "Bot username", "Create bot", "", { max: 32, body: "You'll get a token for it straight away. Treat the token like a password." });
    if (name?.trim()) await attempt(async () => { const b = await acc().createBot(name.trim()); await refetch(); setOpen(b.id); }, "Bot created");
  }

  return (
    <div class="page">
      <div class="dialog-actions start"><button class="btn primary" onClick={() => void create()}><Icon name="plus" size={16} />Create a bot</button></div>
      <Show when={!bots.error} fallback={<p class="err">Couldn't load your bots.</p>}>
        <Group title="My bots" count={bots()?.length} hint="Bots sign in with their token. Anyone with the token controls the bot, so reset it if it leaks.">
          <For each={bots()} fallback={<Row label={bots.loading ? "Loading…" : "No bots yet"} />}>{(bot) => (
            <>
              <Row label={<span class="acct"><Avatar person={{ id: bot.id, name: bot.name, avatarUrl: bot.avatarUrl, bot: true }} size={32} profile={null} presence={false} /><span><strong>{bot.name}</strong><small>{bot.public ? "Public: anyone can invite it" : "Private"}</small></span></span>}
                onClick={() => setOpen(open() === bot.id ? null : bot.id)}>
                <Icon name="down" size={16} class={open() === bot.id ? "" : "rot"} />
              </Row>
              <Show when={open() === bot.id}><BotDetail bot={bot} onChange={() => void refetch()} /></Show>
            </>
          )}</For>
        </Group>
      </Show>
    </div>
  );
}

function BotDetail(props: { bot: BotRow; onChange(): void }) {
  const acc = () => backend()!.account;
  const [shown, setShown] = createSignal(false);
  const edit = (p: Parameters<ReturnType<typeof acc>["editBot"]>[1], done?: string) => attempt(() => acc().editBot(props.bot.id, p).then(props.onChange), done);
  return (
    <div class="bot-detail">
      <Row icon="key" label="Token" hint={shown() ? props.bot.token : "•".repeat(28)}>
        <button class="btn small" onClick={() => setShown(!shown())}>{shown() ? "Hide" : "Reveal"}</button>
        <button class="btn small" onClick={() => void copy(props.bot.token, "Token copied")}>Copy</button>
        <button class="btn small danger" onClick={async () => { if (await confirmDialog("Reset the token?", "The bot stops working until you give it the new token.", "Reset token", true)) await edit({ resetToken: true }, "Token reset"); }}>Reset</button>
      </Row>
      <Row icon="globe" label="Public bot" hint="Lets anyone add it to their server">
        <Switch label="Public bot" on={props.bot.public} onChange={(v) => void edit({ public: v })} />
      </Row>
      <Row icon="link" label="Interactions URL" hint={props.bot.interactionsUrl || "Not set"}>
        <button class="btn small" onClick={async () => { const u = await promptDialog("Interactions URL", "URL", "Save", props.bot.interactionsUrl ?? "", { placeholder: "https://…" }); if (u !== null) await edit({ interactionsUrl: u.trim() || null }, "Saved"); }}>Edit</button>
      </Row>
      <Row icon="pencil" label="Rename" onClick={async () => { const n = await promptDialog("Rename bot", "Bot username", "Rename", props.bot.name, { max: 32 }); if (n?.trim()) await edit({ name: n.trim() }, "Renamed"); }} chevron />
      <Row icon="link" label="Copy invite link" onClick={() => void copy(`https://stoat.chat/bot/${props.bot.id}`, "Invite link copied")} chevron />
      <Row icon="trash" label="Delete bot" danger onClick={async () => { if (await confirmDialog(`Delete ${props.bot.name}?`, "It leaves every server it's in. This can't be undone.", "Delete bot", true)) await attempt(() => acc().deleteBot(props.bot.id).then(props.onChange), "Bot deleted"); }} />
    </div>
  );
}
