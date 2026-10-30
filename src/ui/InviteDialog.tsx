import { createSignal, onCleanup, Show } from "solid-js";
import { useBack } from "./back";
import { InviteCard } from "./chat/Message";
import { inviteFromLink } from "../lib/invite";

/**
 * A Stoat invite opened from outside Mustela (a link tapped in another app on your phone, or
 * mustela://invite/CODE): the join card, over whatever you were looking at.
 */
const [code, setCode] = createSignal<string | null>(null);

export const openInvite = (c: string) => setCode(c);

export function InviteDialogHost() {
  // Links handed over by the Android app (see NativePlugin.kt): one waiting from launch, then any later ones.
  const w = window as unknown as { __mustelaLink?: string; __mustelaLinkDone?: string };
  const take = (url: unknown) => {
    if (typeof url !== "string" || url === w.__mustelaLinkDone) return;
    w.__mustelaLinkDone = url; // the app sends a link a few times in case the page wasn't ready; once is enough
    const c = inviteFromLink(url);
    if (c) setCode(c);
  };
  if (w.__mustelaLink) { take(w.__mustelaLink); w.__mustelaLink = undefined; }
  const on = (e: Event) => { take((e as CustomEvent<string>).detail); w.__mustelaLink = undefined; };
  addEventListener("mustela:open-link", on);
  onCleanup(() => removeEventListener("mustela:open-link", on));
  return (
    <Show when={code()} keyed>{(c) => {
      useBack(() => setCode(null));
      return (
        <div class="scrim" onClick={(e) => e.target === e.currentTarget && setCode(null)}>
          <div class="modal panel discover-modal" role="dialog" aria-label="Join a server"><InviteCard code={c} /></div>
        </div>
      );
    }}</Show>
  );
}
