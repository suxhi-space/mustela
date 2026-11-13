import { inTauri, detectPlatform } from "../platform";

/**
 * Where sign-in tokens are kept: the system keychain on computers (Windows Credential Manager, macOS Keychain, the
 * Linux Secret Service), Keystore-encrypted storage on Android. The saved account list holds only VAULT_MARK in place
 * of each token. Where there's no keychain to use (the browser, some Linux setups), tokens stay where they were, so
 * nobody gets locked out.
 */
export const VAULT_MARK = "@vault";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeFn: Promise<Invoke | null> | null = null;
const getInvoke = () => (invokeFn ??= inTauri() ? import("@tauri-apps/api/core").then((m) => m.invoke as Invoke).catch(() => null) : Promise.resolve(null));
const android = () => detectPlatform() === "android";

let availability: Promise<boolean> | null = null;
/** Whether tokens can go in the keychain here (checked once per run). */
export function vaultAvailable(): Promise<boolean> {
  return (availability ??= (async () => {
    const invoke = await getInvoke();
    if (!invoke) return false;
    try {
      if (android()) return (await invoke<{ ok?: boolean }>("plugin:mustela-native|vault_available", { payload: {} })).ok === true;
      return await invoke<boolean>("vault_available");
    } catch { return false; }
  })());
}

export async function readToken(account: string): Promise<string | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    if (android()) return (await invoke<{ secret?: string }>("plugin:mustela-native|vault_get", { payload: { account } })).secret ?? null;
    return (await invoke<string | null>("vault_get", { account })) ?? null;
  } catch { return null; }
}

export async function writeToken(account: string, secret: string): Promise<boolean> {
  const invoke = await getInvoke();
  if (!invoke || !(await vaultAvailable())) return false;
  try {
    if (android()) return (await invoke<{ ok?: boolean }>("plugin:mustela-native|vault_set", { payload: { account, secret } })).ok === true;
    await invoke("vault_set", { account, secret });
    return (await readToken(account)) === secret; // only trusted once it reads back
  } catch { return false; }
}

export async function forgetToken(account: string): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    if (android()) await invoke("plugin:mustela-native|vault_delete", { payload: { account } });
    else await invoke("vault_delete", { account });
  } catch { /* nothing to remove */ }
}
