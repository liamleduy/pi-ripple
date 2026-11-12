import { execFileSync } from "node:child_process";

export const shellEscape = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Open a right split from the caller's surface, run `pi` in `cwd` with env. Pane is left open. */
export function spawnPane(name: string, cwd: string, env: Record<string, string>): string {
  const args = ["new-split", "right"];
  if (process.env.CMUX_SURFACE_ID) args.push("--surface", process.env.CMUX_SURFACE_ID);
  const out = execFileSync("cmux", args, { encoding: "utf8" });
  const surface = out.match(/surface:\d+/)?.[0];
  if (!surface) throw new Error("unexpected cmux new-split output: " + out);
  try { execFileSync("cmux", ["rename-tab", "--surface", surface, name]); } catch {}
  const envs = Object.entries(env).map(([k, v]) => `${k}=${shellEscape(v)}`).join(" ");
  execFileSync("cmux", ["send", "--surface", surface, `cd ${shellEscape(cwd)} && ${envs} pi\n`]);
  return surface;
}
