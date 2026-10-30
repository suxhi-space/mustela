/** An invite link or code to join: stt.gg/CODE, stoat.chat/invite/CODE, mustela://invite/CODE. */
export function inviteFromLink(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return /^[A-Za-z0-9]{4,32}$/.test(url) ? url : null; }
  const path = (u.protocol === "mustela:" ? `/${u.host}${u.pathname}` : u.pathname).replace(/\/+$/, "");
  const m = path.match(/^\/invite\/([A-Za-z0-9]{4,32})$/) ?? (/^(stt|rvlt)\.gg$/.test(u.hostname) ? path.match(/^\/([A-Za-z0-9]{4,32})$/) : null);
  return m && m[1] !== "discover" ? m[1]! : null;
}
