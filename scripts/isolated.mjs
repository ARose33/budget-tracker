import { runNode } from "./isolated-environment.mjs";
const mode = process.argv[2];
const commands = {
  build: [
    "--import",
    "./scripts/test-network-guard.mjs",
    "node_modules/next/dist/bin/next",
    "build",
  ],
  dev: [
    "--import",
    "./scripts/test-network-guard.mjs",
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
  ],
  start: [
    "--import",
    "./scripts/test-network-guard.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
  ],
  lint: ["node_modules/eslint/bin/eslint.js"],
  typecheck: [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--incremental",
    "false",
  ],
};
if (!Object.hasOwn(commands, mode))
  throw new Error("Use build, dev, start, lint, or typecheck.");
process.exitCode = await runNode([...commands[mode], ...process.argv.slice(3)]);
