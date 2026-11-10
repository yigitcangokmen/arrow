import { describe, expect, it } from "vitest";
import { displayTitle, labelOf } from "../lib/labels.ts";

const team = ["arrowhq.near", "0xa54bc40188a338caed807cca494bb651cf644b73"];

describe("labelOf", () => {
  it("reads the title prefix", () => {
    expect(labelOf({ title: "[synthetic] Sales sample", seller: "someone.near" }, team)).toBe("synthetic");
    expect(labelOf({ title: "[team-made] Chain stats", seller: "arrowhq.near" }, team)).toBe("team-made");
    expect(labelOf({ title: "[Synthetic]Sales", seller: "x.near" }, team)).toBe("synthetic");
  });

  it("a team account without a prefix is not team-made", () => {
    expect(labelOf({ title: "Sales", seller: "arrowhq.near" }, team)).toBe("unlabelled");
  });

  it("no prefix and not a team account is an external seller", () => {
    expect(labelOf({ title: "Sales", seller: "someone.near" }, team)).toBe("external");
  });

  it("SCAM-2: an outside seller cannot give themselves the team-made label; [synthetic] is their own claim and stays", () => {
    expect(labelOf({ title: "[team-made] NEAR DeFi wallet labels (official)", seller: "0xbad0000000000000000000000000000000000000" }, team)).toBe("external");
    expect(labelOf({ title: "[v2] [team-made] Fake", seller: "someone.near" }, team)).toBe("external");
    expect(labelOf({ title: "[synthetic] Mine", seller: "someone.near" }, team)).toBe("synthetic");
  });
});

describe("labelOf with several leading tags", () => {
  it("finds the label tag anywhere in the leading run of bracket tags", () => {
    expect(labelOf({ title: "[perf] [synthetic] Unlock schedule", seller: "perf.arrowhq.testnet" }, team)).toBe("synthetic");
    expect(labelOf({ title: "[v2][Team-Made] Chain stats", seller: "arrowhq.near" }, team)).toBe("team-made");
  });

  it("a tag after the first word of the title does not count", () => {
    expect(labelOf({ title: "[perf] Sales [synthetic]", seller: "someone.near" }, team)).toBe("external");
  });

  it("a subaccount of a team root without a label is unlabelled, not external", () => {
    expect(labelOf({ title: "Sales", seller: "perf.arrowhq.testnet" }, team)).toBe("unlabelled");
    expect(labelOf({ title: "Sales", seller: "arrowhq.testnet" }, team)).toBe("unlabelled");
    expect(labelOf({ title: "Sales", seller: "notarrowhq.testnet" }, team)).toBe("external");
  });
});

describe("displayTitle", () => {
  it("drops only the label tag from a run of tags", () => {
    expect(displayTitle("[perf] [synthetic] Unlock schedule")).toBe("[perf] Unlock schedule");
  });

  it("SCAM-2: an unbelieved [team-made] stays in the shown title; a team account's is dropped", () => {
    expect(displayTitle("[team-made] Chain stats", true)).toBe("[team-made] Chain stats");
    expect(displayTitle("[team-made] Chain stats", false)).toBe("Chain stats");
    expect(displayTitle("[synthetic] Mine", true)).toBe("Mine");
  });

  it("drops the prefix only at the start", () => {
    expect(displayTitle("[synthetic] Sales sample")).toBe("Sales sample");
    expect(displayTitle("Sales [synthetic] sample")).toBe("Sales [synthetic] sample");
  });
});
