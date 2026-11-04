import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function repoHead(cwd) {
  try {
    const headSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
    const dirtyWorktree =
      execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim().length > 0;
    return { headSha, dirtyWorktree };
  } catch {
    return { headSha: null, dirtyWorktree: null };
  }
}

export function makeReceipt(row, fields) {
  return {
    id: row.id,
    lane: row.lane,
    verdict: fields.verdict,
    reason: fields.reason ?? null,
    envClass: row.envClass,
    grade: row.grade,
    at: new Date().toISOString(),
    ...repoHead(fields.cwd),
    device: fields.device ?? null,
    counts: fields.counts ?? {},
    timing: fields.timing ?? null,
    plants: fields.plants ?? [],
    budget: { ...row.budget, used: fields.budgetUsed ?? null },
    remoteOps: fields.remoteOps ?? 0,
    detail: fields.detail ?? null,
  };
}

export function writeReceipt(spikeDir, receipt) {
  const dir = join(spikeDir, "evidence", receipt.id.toLowerCase());
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");
  return file;
}
