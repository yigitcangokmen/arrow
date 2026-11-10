// Import this first in a script that holds keys: `import "./lib/require-node.ts";`. ES imports run in order, so a too-old Node stops
// here, before the other imports load. Exit 2 is the usage code of the scripts.
import { nodeProblem } from "./node-version.ts";

const problem = nodeProblem(process.versions.node);
if (problem) {
  console.error(problem);
  process.exit(2);
}
