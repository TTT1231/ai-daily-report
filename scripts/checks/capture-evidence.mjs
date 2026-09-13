import {spawnSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {captureEvidenceTargets} from "../lib/evidence-capture.mjs";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
function browserExecutable() {
  if (option("browser-executable")) return option("browser-executable");
  if (process.platform !== "win32") return "agent-browser";
  const found = spawnSync("where.exe", ["agent-browser"], {encoding: "utf8", windowsHide: true});
  for (const path of (found.stdout ?? "").trim().split(/\r?\n/)) {
    if (path.endsWith(".exe") && existsSync(path)) return path;
    const native = resolve(dirname(path), "node_modules/agent-browser/bin", `agent-browser-win32-${process.arch}.exe`);
    if (existsSync(native)) return native;
  }
  throw new Error("Native agent-browser executable unavailable; pass --browser-executable=<absolute executable path>.");
}
try {
  if (!option("plan") || !option("session")) throw new Error("Use --plan=<capture.json> --session=<existing agent-browser session>.");
  const path = resolve(option("plan"));
  const plan = JSON.parse(readFileSync(path, "utf8"));
  const executable = browserExecutable();
  const run = async (args, input) => {
    const result = spawnSync(executable, ["--session", option("session"), ...args], {
      input, encoding: "utf8", timeout: 35000, windowsHide: true,
    });
    if (result.status !== 0) throw new Error(result.error?.message ?? (result.stderr || result.stdout));
    return result.stdout.trim();
  };
  const current = await run(["get", "url"]);
  if (new URL(current).href !== new URL(plan.url).href) throw new Error(`Current page differs from capture plan: ${current}`);
  const result = await captureEvidenceTargets({plan, directory: dirname(path), run,
    retryFact: option("retry-fact"), retryReason: option("reason")});
  console.log(JSON.stringify(result, null, 2));
  if (result.results.some((entry) => entry.status !== "captured")) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
