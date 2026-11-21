import { createSignal, Show } from "solid-js";
import { Icon } from "./icons";
import { toast } from "./menu";
import { backend } from "./store";

/**
 * "View server as a role" (Stoat's role preview): the server's channels and permissions as someone with only that
 * role sees them. Stoat blocks changes to the server meanwhile, so nothing can be edited by mistake.
 */
const [viewing, setViewing] = createSignal<{ serverId: string; serverName: string; roleName: string } | null>(null);
export { viewing };

export function viewServerAs(serverId: string, serverName: string, roleId: string, roleName: string) {
  const b = backend();
  if (!b?.viewAs) { toast("Viewing as a role isn't available here.", true); return; }
  b.viewAs(serverId, [roleId]);
  setViewing({ serverId, serverName, roleName });
}
export function stopViewingAs() {
  backend()?.viewAs?.(null);
  setViewing(null);
}

/** A small bar at the top while previewing, with the way out. */
export function ViewAsBar() {
  return (
    <Show when={viewing()}>{(v) => (
      <div class="viewas-bar" role="status">
        <Icon name="eye" size={16} />
        <span>Viewing <strong>{v().serverName}</strong> as <strong>{v().roleName}</strong>. Changes are paused.</span>
        <button class="btn small" onClick={stopViewingAs}>Stop</button>
      </div>
    )}</Show>
  );
}
