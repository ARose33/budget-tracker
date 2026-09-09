import fs from "node:fs";
import path from "node:path";
import { root, runNode } from "./isolated-environment.mjs";
function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(name);
    return /\.(test|spec)\.(ts|mjs)$/.test(name) &&
      !name.includes(path.sep + "e2e" + path.sep)
      ? [name]
      : [];
  });
}
const files = [
  ...collect(path.join(root, "src")),
  ...collect(path.join(root, "tests")),
  "scripts/lib/statement-reconciler.test.mjs",
  "scripts/lib/statement-review.test.mjs",
];
// Private-PDF operator tests are outside this command until replaced by generated
// fixtures. Never execute statement maintenance entry points.
process.exitCode = await runNode([
  "--import",
  "./scripts/test-network-guard.mjs",
  "--test",
  "--test-concurrency=1",
  ...files,
  ...process.argv.slice(2),
]);
