import { describe, expect, it } from "vitest";
import { findNamed, parseDay, parseSearch, searchText, typingFilter } from "./searchQuery";

const people = [{ id: "u1", name: "Mika", username: "mika" }, { id: "u2", name: "Big Otto", username: "otto" }, { id: "u3", name: "Mikael" }];

describe("search filters typed in the box", () => {
  it("takes the filters out and leaves the words", () => {
    const r = parseSearch("hello from:Mika has:link world", people);
    expect(r.words).toBe("hello world");
    expect(r.filters.from).toBe("u1");
    expect(r.filters.has).toBe("link");
  });
  it("finds people by exact name first, then username, then prefix, quoted names too", () => {
    expect(findNamed(people, "mika")?.id).toBe("u1");
    expect(findNamed(people, "otto")?.id).toBe("u2");
    expect(findNamed(people, "mikae")?.id).toBe("u3");
    expect(parseSearch('mentions:"Big Otto"', people).filters.mentions).toBe("u2");
  });
  it("reads days and date filters", () => {
    const now = new Date(2026, 10, 6);
    expect(parseDay("today", now)).toBe("2026-11-06");
    expect(parseDay("yesterday", now)).toBe("2026-11-05");
    expect(parseDay("2026-10-01")).toBe("2026-10-01");
    const r = parseSearch("before:2026-10-01 during:2026-09-30", people);
    expect(r.filters.when).toBe("on");
    expect(r.filters.day).toBe("2026-09-30");
  });
  it("keeps filters it can't understand as words", () => {
    const r = parseSearch("from:nobody has:hats", people);
    expect(r.words).toBe("from:nobody has:hats");
    expect(r.filters.from).toBe("");
  });
  it("author type", () => {
    expect(parseSearch("authortype:bot", people).filters.kind).toBe("bots");
    expect(parseSearch("authorType:user", people).filters.kind).toBe("people");
  });
  it("spots the filter being typed", () => {
    expect(typingFilter("hello from:Mi")).toEqual({ key: "from", value: "Mi", start: 6 });
    expect(typingFilter("has:")?.key).toBe("has");
    expect(typingFilter("hello")).toBeNull();
  });
});

describe("filters back into text", () => {
  it("round-trips", () => {
    const text = searchText("hi", { from: "u2", mentions: "", has: "file", when: "before", day: "2026-10-01", kind: "bots" }, (id) => people.find((p) => p.id === id)!.name);
    expect(text).toBe('hi from:"Big Otto" has:file before:2026-10-01 authorType:bot');
    const back = parseSearch(text, people);
    expect(back.words).toBe("hi");
    expect(back.filters).toMatchObject({ from: "u2", has: "file", when: "before", day: "2026-10-01", kind: "bots" });
  });
});
