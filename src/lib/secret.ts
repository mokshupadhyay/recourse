import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

// Mandate signing key. Uses RECOURSE_SIGNING_SECRET when set; otherwise creates one on
// first run and keeps it in .data/ (git-ignored) so signatures survive restarts.
export function signingSecret(): string {
  if (process.env.RECOURSE_SIGNING_SECRET) return process.env.RECOURSE_SIGNING_SECRET;
  const file = path.join(process.cwd(), ".data", "signing-secret");
  try {
    return readFileSync(file, "utf8");
  } catch {
    const secret = randomBytes(32).toString("hex");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
