// Where an S3a run writes its result. The funded run (S3a(ii)) owns s3a-results.json, which GATES, HANDOFFS and STATUS cite;
// the unfunded dry run (S3a(i)) writes its own file so that a README "try it" run cannot replace that evidence.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const s3aResultsFile = (funded: boolean): string => resolve(HERE, funded ? "s3a-results.json" : "s3a-dry-results.json");
