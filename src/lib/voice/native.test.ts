import { afterEach, describe, expect, it, vi } from "vitest";

const calls: [string, unknown][] = [];
let state: Record<string, unknown> = { active: true, connected: true, mic: false, channelId: "c1", channelName: "Lounge", participants: ["me", "u2"], speaking: ["u2"] };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (name: string, args?: unknown) => {
    calls.push([name, args]);
    if (name.endsWith("|set_mic")) state = { ...state, mic: (args as any).payload.on };
    if (name.endsWith("|end_call")) state = { ...state, active: false };
    return state;
  },
}));

const me = { id: "me", name: "Me" };
const nameOf = (id: string) => ({ id, name: id.toUpperCase() });

const FRESH = { active: true, connected: true, mic: false, channelId: "c1", channelName: "Lounge", participants: ["me", "u2"], speaking: ["u2"] };
afterEach(() => { calls.length = 0; vi.useRealTimers(); state = { ...FRESH }; });

describe("native call handle", () => {
  it("resumes a running call and maps ids to people", async () => {
    const { resumeNative } = await import("./native");
    const r = await resumeNative(me, nameOf);
    expect(r?.channelId).toBe("c1");
    expect(r!.handle.participants().map((p) => p.name)).toEqual(["Me", "U2"]);
    expect(r!.handle.speaking()).toEqual(["u2"]);
    await r!.handle.leave();
  });

  it("returns null when no call is running", async () => {
    state = { ...state, active: false };
    const { resumeNative } = await import("./native");
    expect(await resumeNative(me, nameOf)).toBeNull();
    state = { ...state, active: true };
  });

  it("refuses camera and screen share instead of silently doing nothing", async () => {
    const { resumeNative } = await import("./native");
    const r = await resumeNative(me, nameOf);
    await expect(r!.handle.setCamera(true)).rejects.toThrow(/Web/);
    await expect(r!.handle.setScreen(true)).rejects.toThrow(/Web/);
    await r!.handle.leave();
  });

  it("tells listeners when the call ends from outside (notification Leave)", async () => {
    const { resumeNative } = await import("./native");
    const r = await resumeNative(me, nameOf);
    const ended = vi.fn();
    r!.handle.onEnd(ended);
    state = { ...state, active: false };
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 100 }); // polls once a second
    await new Promise((res) => setTimeout(res, 1200));
    expect(ended).toHaveBeenCalledTimes(1); // and only once
  });
});
