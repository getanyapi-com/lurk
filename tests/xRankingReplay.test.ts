import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("makes a blind, inert practice packet; refuses old validation posts and refuses overwriting evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lurk-ranking-test-"));
  try {
    const snapshot = path.join(directory, "snapshot.json");
    const output = path.join(directory, "packet");
    const signals = { own_need: { type: "noul", noul: 0.9 }, same_kind: { type: "noul", noul: 0.9 },
      intent: { type: "score", score: 3 }, rival_vendor: { type: "noul", noul: 0.1 }, promoting: { type: "noul", noul: 0.1 }, resolved: { type: "noul", noul: 0.1 } };
    const attack = "</script><script>window.compromised=1</script>";
    fs.writeFileSync(snapshot, JSON.stringify({ products: [{ name: "Forms", copies: { candidate: "p" }, facts: { capabilities: ["free forms"] },
      posts: [{ id: "1", author_username: "creator", text: attack, created_at: "2026-10-08T00:00:00Z" }],
      evaluations: [{ project_id: "p", tweet_id: "1", stage: "review", level: "search", signals, engagement: 3, context: null, decision: "review" }],
      leads: [], inbox: { candidate: { qualified: [], maybe: [{ tweetId: "1" }] } } }] }));
    const run = (out: string, extra: string[] = []) => spawnSync(process.execPath, ["--import", "tsx", "scripts/x-ranking-replay.ts",
      "--snapshot", snapshot, "--out", out, "--seed", attack, ...extra], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://unused:unused@invalid.invalid/unused" } });
    expect(run(output).status).toBe(0);
    const html = fs.readFileSync(path.join(output, "review.html"), "utf8");
    expect(html).toContain("NOT independent validation");
    expect(html.match(/<script>/gu)).toHaveLength(1);
    expect(html).not.toContain(attack);
    expect(html).not.toContain('"credit":');
    expect(html).not.toContain('"priority":');
    const replay = fs.readFileSync(path.join(output, "replay.json"), "utf8");
    expect(JSON.parse(replay).metadata.networkCalls).toBe(0);
    const refused = run(output);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("out must be a new directory");
    expect(fs.readFileSync(path.join(output, "replay.json"), "utf8")).toBe(replay);
    const invalid = run(path.join(directory, "validation"), ["--validation-after", "2026-10-10T06:00:00Z"]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("outside the declared validation period");
    expect(fs.existsSync(path.join(directory, "validation"))).toBe(false);
  } finally {
    // Only this test's newly created directory; never audit evidence.
    fs.rmSync(directory, { recursive: true });
  }
});

it("replays completed reply provenance without leaking route scores into the blind packet", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lurk-ranking-verdict-"));
  try {
    const snapshot = path.join(directory, "snapshot.json");
    const output = path.join(directory, "packet");
    const signals = { own_need: null, intent: null, promoting: null, resolved: null,
      supported_job: { type: "noul", noul: 0.9 }, rival_vendor: { type: "noul", noul: 0.05 },
      founder_would_reply: { type: "noul", noul: 0.98 }, reply: { worth_reply: true } };
    const ids = ["checked", "raw", "failed"];
    fs.writeFileSync(snapshot, JSON.stringify({ products: [{ name: "Forms", copies: { candidate: "p" }, facts: {},
      posts: ids.map((id) => ({ id, author_username: id, text: `Stored ${id} request`, created_at: "2026-10-08T00:00:00Z" })),
      evaluations: ids.map((id) => ({ project_id: "p", tweet_id: id, stage: "reply", level: "search", context: null, decision: "reject", engagement: 3,
        reason_code: id === "raw" ? null : "worth_reply", signals: id === "failed" ? { ...signals, reply: { worth_reply: true, code: "not_reply_worthy" } } : signals })),
      leads: ids.map((id) => ({ project_id: "p", tweet_id: id, status: "new" })), inbox: { candidate: { qualified: [], maybe: [] } } }] }));
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/x-ranking-replay.ts", "--snapshot", snapshot, "--out", output, "--seed", "provenance-regression"],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: "postgres://unused:unused@invalid.invalid/unused" } });
    expect(result.status, result.stderr).toBe(0);
    const replay = JSON.parse(fs.readFileSync(path.join(output, "replay.json"), "utf8"));
    const rows = replay.products[0].newOrder;
    expect(rows[0]).toMatchObject({ id: "checked", needPriority: null });
    expect(rows[0].conversationPriority).toBeCloseTo(0.5 * 0.98 * 0.9 * 0.95);
    expect(rows.slice(1).every((row: { priority: number | null }) => row.priority === null)).toBe(true);
    const html = fs.readFileSync(path.join(output, "review.html"), "utf8");
    for (const field of ["priority", "needPriority", "conversationPriority", "replyVerdictCode", "reason_code", "checks", "notes"]) {
      expect(html).not.toContain(`"${field}":`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});
