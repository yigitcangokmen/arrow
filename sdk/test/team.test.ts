import { describe, expect, it } from "vitest";
import { isTeamAccount } from "../src/team.ts";

describe("isTeamAccount", () => {
  it("matches the listed accounts without regard to case", () => {
    expect(isTeamAccount("0xA54BC40188A338CAED807CCA494BB651CF644B73", ["0xa54bc40188a338caed807cca494bb651cf644b73"])).toBe(true);
    expect(isTeamAccount("someone.near", ["arrowhq.near"])).toBe(false);
  });

  it("matches the Arrow roots and their subaccounts", () => {
    for (const a of ["arrowhq.near", "arrowhq.testnet", "perf.arrowhq.testnet", "arrow-relayer.arrowhq.near"]) expect(isTeamAccount(a), a).toBe(true);
  });

  it("does not match a lookalike", () => {
    for (const a of ["notarrowhq.near", "arrowhq.near.evil.near", "arrowhq-testnet.testnet"]) expect(isTeamAccount(a), a).toBe(false);
  });
});
