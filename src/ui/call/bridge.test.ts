import { describe, expect, it } from "vitest";
import { openBridge, type Snapshot } from "./bridge";

const snap: Snapshot = { active: true, channelName: "Lounge", mic: true, cam: false, screen: false, people: [{ id: "a", name: "A" }], speaking: ["a"], error: "" };
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("call bridge", () => {
  it("delivers messages between two windows and never echoes to the sender", async () => {
    const gotA: unknown[] = [], gotB: unknown[] = [];
    const a = openBridge((m) => gotA.push(m));
    const b = openBridge((m) => gotB.push(m));
    a.send({ t: "state", s: snap });
    b.send({ t: "cmd", c: "mic" });
    await wait();
    expect(gotB).toEqual([{ t: "state", s: snap }]);
    expect(gotA).toEqual([{ t: "cmd", c: "mic" }]);
    a.close(); b.close();
  });
});
