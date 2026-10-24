import { describe, expect, it } from "vitest";
import { attachmentOf, embedOf, inviteCode, personOf, systemText } from "./stoat";
import { DemoBackend } from "./mock";

describe("stoat helpers", () => {
  it("reads invite codes from links and bare codes", () => {
    expect(inviteCode("https://stt.gg/Testers")).toBe("Testers");
    expect(inviteCode("https://stoat.chat/invite/abc123/")).toBe("abc123");
    expect(inviteCode("  abc123 ")).toBe("abc123");
    expect(inviteCode("not a link!")).toBeNull();
    expect(inviteCode("https://evil.example/../x")).toBeNull();
  });
  it("maps people with member nickname, avatar and role colour", () => {
    const p = personOf({ id: "u", displayName: "Dee", username: "dee", avatarURL: "a", online: true, status: { presence: "Busy", text: "hi" }, badges: 256 }, "u",
      { nickname: "Nick", avatarURL: "m", roleColour: "#f00" });
    expect(p).toMatchObject({ name: "Nick", avatarUrl: "m", presence: "busy", status: "hi", colour: "#f00", badges: ["Early Adopter"] });
    expect(personOf(undefined, "x").name).toBe("Unknown");
  });
  it("maps files by metadata type", () => {
    const a = attachmentOf({ id: "f", filename: "cat.png", metadata: { type: "Image", width: 10, height: 5 }, originalUrl: "o", createFileURL: () => "p", size: 3, isSpoiler: true });
    expect(a).toEqual({ id: "f", name: "cat.png", url: "o", previewUrl: "p", type: "image", width: 10, height: 5, size: 3, spoiler: true });
    expect(attachmentOf({ id: "g", metadata: { type: "File" }, originalUrl: "o" }).type).toBe("file");
  });
  it("maps embeds and drops unknown ones", () => {
    expect(embedOf({ type: "Website", url: "u", title: "T", image: { url: "i", width: 1, height: 2 } })).toMatchObject({ kind: "website", title: "T", image: { url: "i" } });
    expect(embedOf({ type: "Image", url: "u", width: 4, height: 3 })).toMatchObject({ kind: "image", image: { url: "u" } });
    expect(embedOf({ type: "None" })).toBeNull();
  });
  it("describes system messages", () => {
    const name = (id?: string) => (id === "a" ? "Ann" : "Bo");
    expect(systemText({ type: "user_joined", userId: "a" }, name)).toBe("Ann joined");
    expect(systemText({ type: "channel_renamed", byId: "b", name: "x" }, name)).toBe("Bo renamed the channel to x");
    expect(systemText({ type: "mystery" }, name)).toBe("System message");
  });
});

describe("demo backend", () => {
  it("pages history oldest-first and stops at the start", async () => {
    const d = new DemoBackend();
    const last = await d.messages("c1");
    const older = await d.messages("c1", last[0]!.id);
    expect(older.length).toBeGreaterThan(0);
    expect(older[older.length - 1]!.at.getTime()).toBeLessThanOrEqual(last[0]!.at.getTime());
    let page = older, guard = 0;
    while (page.length && guard++ < 20) page = await d.messages("c1", page[0]!.id);
    expect(page).toEqual([]);
  });
  it("sends, reacts, edits and deletes with events", async () => {
    const d = new DemoBackend();
    const seen: string[] = [];
    d.onEvent((e) => seen.push(e.t));
    await d.send("c4", { text: "hello" });
    const m = (await d.messages("c4")).at(-1)!;
    await d.react("c4", m.id, "🔥", true);
    expect((await d.message("c4", m.id))!.reactions).toEqual([{ emoji: "🔥", users: [d.me.id] }]);
    await d.react("c4", m.id, "🔥", false);
    expect((await d.message("c4", m.id))!.reactions).toEqual([]);
    await d.edit("c4", m.id, "bye");
    expect((await d.message("c4", m.id))!.editedAt).toBeInstanceOf(Date);
    await d.remove("c4", m.id);
    expect(await d.message("c4", m.id)).toBeNull();
    expect(seen).toEqual(["message", "update", "update", "update", "delete"]);
    d.dispose();
  });
  it("friend requests move between lists", async () => {
    const d = new DemoBackend();
    expect((await d.friends()).incoming.map((p) => p.id)).toEqual(["u5"]);
    await d.friendAction("u5", "accept");
    const f = await d.friends();
    expect(f.incoming).toEqual([]);
    expect(f.friends.map((p) => p.id)).toContain("u5");
    await expect(d.friendAction("nobody", "add")).rejects.toThrow();
  });
  it("groups members by role, then online, then offline", async () => {
    const titles = (await new DemoBackend().members("s1")).map((g) => g.title);
    expect(titles[titles.length - 1]).toBe("Offline");
    expect(titles.indexOf("Online")).toBe(titles.length - 2);
    expect(titles).toContain("Gardeners");
  });
});
