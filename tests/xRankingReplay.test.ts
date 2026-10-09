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
