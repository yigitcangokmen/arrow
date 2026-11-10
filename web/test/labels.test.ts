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

  it("the prefix wins even for an outside seller (the label is the seller's claim)", () => {
    expect(labelOf({ title: "[team-made] Fake", seller: "someone.near" }, team)).toBe("team-made");
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

  it("drops the prefix only at the start", () => {
    expect(displayTitle("[synthetic] Sales sample")).toBe("Sales sample");
    expect(displayTitle("Sales [synthetic] sample")).toBe("Sales [synthetic] sample");
  });
});
