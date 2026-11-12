import { describe, expect, it, vi } from "vitest";
import { snapshotBackend, type Snapshot } from "./snapshot";
import type { ChatBackend } from "./types";

const snap: Snapshot = {
  v: 1, at: Date.now(),
  me: { id: "me", name: "You" },
  spaces: [
    { id: "home", name: "Home", home: true, channels: [{ id: "dm1", name: "Mika", kind: "dm", peer: { id: "u1", name: "Mika" }, mentions: 2 }] },
    { id: "s1", name: "Glass Garden", channels: [{ id: "c1", name: "general", kind: "text", muted: true }, { id: "v1", name: "Lounge", kind: "voice" }] },
  ],
  sidebar: ["s1"], folders: [],
  friends: { friends: [{ id: "u2", name: "Otto" }], incoming: [], outgoing: [], blocked: [] },
};

function fakeReal() {
  const listeners: ((e: unknown) => void)[] = [];
  const b = {
    me: { id: "me", name: "Live you" },
    spaces: vi.fn(async () => [{ id: "live", name: "Live", channels: [] }]),
    messages: vi.fn(async () => [{ id: "m1" }]),
    channelName: vi.fn(() => "live-name"),
    ack: vi.fn(),
    onEvent: vi.fn((cb: (e: unknown) => void) => { listeners.push(cb); return () => {}; }),
    dispose: vi.fn(),
    emit: (e: unknown) => listeners.forEach((l) => l(e)),
  };
  return b;
}

describe("instant start (snapshot backend)", () => {
  it("answers from the copy before the connection, then forwards to it", async () => {
    let resolve!: (b: ChatBackend) => void;
    const real = new Promise<ChatBackend>((r) => { resolve = r; });
    const sb = snapshotBackend(snap, real);
    expect(sb.me.name).toBe("You");
    expect((await sb.spaces()).map((s) => s.id)).toEqual(["home", "s1"]);
    expect((await sb.friends()).friends[0]!.name).toBe("Otto");
    expect(sb.channelName("c1")).toBe("general");
    expect(sb.serverOfChannel!("c1")).toBe("s1");
    expect(sb.serverOfChannel!("dm1")).toBeUndefined();
    expect(sb.isMuted("channel", "c1")).toBe(true);
    expect(sb.unreadCount("dm1")).toBe(2);
    expect(sb.person("u1").name).toBe("Mika");
    expect(sb.channelsIn("s1").map((c) => c.kind)).toEqual(["text", "voice"]);
    expect(sb.channelRules("c1").canSend).toBe(true);

    // Waiting calls and listeners move over once connected.
    const msgs = sb.messages("c1");
    const seen: unknown[] = [];
    sb.onEvent((e) => seen.push((e as { t: string }).t));
    sb.ack("c1");
    const live = fakeReal();
    resolve(live as unknown as ChatBackend);
    expect(await msgs).toEqual([{ id: "m1" }]);
    await Promise.resolve();
    expect(live.ack).toHaveBeenCalledWith("c1");
    expect(seen).toEqual(["reconnected", "activity"]);
    live.emit({ t: "message" });
    expect(seen.at(-1)).toBe("message");
    expect(sb.me.name).toBe("Live you");
    expect(sb.channelName("c1")).toBe("live-name");
    expect((await sb.spaces())[0]!.id).toBe("live");
  });

  it("disposing before the connection lands closes it", async () => {
    let resolve!: (b: ChatBackend) => void;
    const real = new Promise<ChatBackend>((r) => { resolve = r; });
    const sb = snapshotBackend(snap, real);
    sb.dispose();
    const live = fakeReal();
    resolve(live as unknown as ChatBackend);
    await Promise.resolve(); await Promise.resolve();
    expect(live.dispose).toHaveBeenCalled();
  });
});
