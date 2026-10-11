/** Export a source-blinded experimental contract. No environment/model-client/DB imports. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { ProductFacts } from "../src/lib/product";
import { X_TASK_READING_VERSION, xTaskQuestions, xTaskSource } from "../src/lib/x/taskReading";
import { xQuestions } from "../src/lib/x/questions";

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4) throw new Error("Usage: tsx scripts/x-task-contract.ts SOURCE_PACKET NEW_OUTPUT");
globalThis.fetch = async () => { throw new Error("Network forbidden in contract export"); };
const raw = await readFile(input, "utf8");
const packet = JSON.parse(raw) as { cases: { caseId: string; project: string; facts: ProductFacts; text: string; author: string; parents: unknown; bio: unknown }[] };
if (!Array.isArray(packet.cases) || new Set(packet.cases.map((row) => row.caseId)).size !== packet.cases.length) throw new Error("Invalid source packet");
const cases = packet.cases.map((row) => {
  const source = xTaskSource(row.facts, row.text);
  const questions = xTaskQuestions(source);
  const baseline = xQuestions(Object.keys(source.sentences), { complete: true, brief: row.facts.brief });
  const enlarged = { ...baseline, ...questions };
  return { caseId: row.caseId, project: row.project, source, context: { author: row.author, parents: row.parents, bio: row.bio }, questions,
    payloadBytes: Buffer.byteLength(JSON.stringify({ source, questions })),
    baselineQuestionBytes: Buffer.byteLength(JSON.stringify(baseline)),
    baselineQuestionCount: Object.keys(baseline).length,
    enlargedQuestionBytes: Buffer.byteLength(JSON.stringify(enlarged)),
    enlargedQuestionCount: Object.keys(enlarged).length,
    addedFactMapBytes: Buffer.byteLength(JSON.stringify(source.facts)) };
});
const contract = { version: X_TASK_READING_VERSION, sourceSha256: createHash("sha256").update(raw).digest("hex"),
  status: "Offline extraction contract, not a Jev request or ranker validation", cases };
const serialized = JSON.stringify(contract, null, 2) + "\n";
await writeFile(output, serialized, { flag: "wx" });
console.log(JSON.stringify({ output, cases: cases.length, sha256: createHash("sha256").update(serialized).digest("hex"), questionCount: 7,
  caution: "Payload bytes are not billed tokens or actual API cost" }));
