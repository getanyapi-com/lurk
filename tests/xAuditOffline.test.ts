import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { configHash } from "@/lib/x/audit";

const exec = promisify(execFile);
const root = process.cwd();
const tsxLoader = createRequire(import.meta.url).resolve("tsx");

describe("file-only audit CLI", () => {
  it("works with credential loading and every network connection forbidden; refuses drift", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lurk-audit-offline-"));
    try {
      const corpus = join(dir, ".context", "x-audit", "fixture");
      mkdirSync(corpus, { recursive: true });
      const lanes = { baseline: [], probe: [{ label: "probe", terms: [["calendar"]] }] };
      writeFileSync(join(corpus, "setup.json"), JSON.stringify({ tag: "fixture", hash: "frozen", start: "2026-10-01", products: [{ source: "p", name: "Example", lanes }, { source: "a", name: "AnyAPI", lanes }] }));
      const blind = { key: "p:1", product: { name: "Example", url: null, pain: "scheduling", solution: "calendar", targetUsers: "teams" }, post: { text: "Need a calendar", author: "user", created: "2026-10-01", url: "https://x.com/user/status/1" } };
      writeFileSync(join(corpus, "to-label.jsonl"), JSON.stringify(blind) + "\n");
      writeFileSync(join(corpus, "labels.jsonl"), JSON.stringify({ key: "p:1", gold: "ask" }) + "\n");
      writeFileSync(join(corpus, "weights.json"), '{"p:1":1}');
      const snapshot = { version: 1, setupHash: "frozen", exportedAt: "2026-10-01", provenance: "synthetic test", posts: [{ key: "p:1", tweet: "1", product: "Example", text: blind.post.text, author: "user", created: "2026-10-01", conversation: "1", isReply: false, arms: { probe: { stage: "lead", score: 90, signals: null, lane: null, freeReject: null, reasonCode: null } } }] };
      const freeze = () => writeFileSync(join(corpus, "snapshot.json"), JSON.stringify({ ...snapshot, contentHash: configHash(snapshot) }));
      freeze();
      const guard = join(dir, "no-network.mjs");
      writeFileSync(guard, 'import { Socket } from "node:net"; process.loadEnvFile = () => { throw new Error("credential loading forbidden") }; globalThis.fetch = () => { throw new Error("fetch forbidden") }; Socket.prototype.connect = () => { throw new Error("network forbidden") };');
      const call = (args: string[]) => exec(process.execPath, ["--import", guard, "--import", tsxLoader, join(root, "scripts/x-audit.ts"), ...args], { cwd: dir, env: { ...process.env, TSX_TSCONFIG_PATH: join(root, "tsconfig.json") } });
      expect((await call(["offline", "--tag", "fixture"])).stdout).toContain("1 labels; 0 imported reviews");
      const analysis = JSON.parse(readFileSync(join(corpus, "offline", "analysis.json"), "utf8"));
      expect(analysis.validation.probe).toMatchObject({ shown: 1, ask: 1, reply: 0 });
      expect(analysis.sampling.estimates).toBeNull();
      expect((await call(["report", "--tag", "fixture"])).stdout).toContain("blind review cards");
      await expect(call(["offline", "--tag", "fixture", "--labels", "other.jsonl"])).rejects.toThrow("unknown, duplicate or incomplete option");
      snapshot.posts[0].text = "drifted"; freeze();
      await expect(call(["offline", "--tag", "fixture"])).rejects.toThrow("snapshot text drifted");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
