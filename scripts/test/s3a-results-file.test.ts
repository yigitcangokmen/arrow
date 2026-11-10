// F4: an unfunded S3a run must not overwrite the committed S3a(ii) evidence in s3a-results.json.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { s3aResultsFile } from "../../spikes/s3/s3a-results-file.ts";

const S3 = resolve(dirname(fileURLToPath(import.meta.url)), "../../spikes/s3");

describe("s3aResultsFile", () => {
  it("s3a_unfunded_run_does_not_touch_the_funded_evidence_file", () => {
    expect(s3aResultsFile(false)).toBe(resolve(S3, "s3a-dry-results.json"));
    expect(s3aResultsFile(true)).toBe(resolve(S3, "s3a-results.json"));
    expect(existsSync(resolve(S3, "s3a-results.json"))).toBe(true);
  });
});
