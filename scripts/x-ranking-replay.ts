/** Database/API-free replay plus a blinded owner-review packet. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { z } from "zod";
import { rankXOpportunities, X_PRIORITY_FLOOR, X_PRIORITY_VERSION } from "../src/lib/x/priority";

globalThis.fetch = async () => { throw new Error("Ranking replay cannot make network calls"); };
const { values } = parseArgs({ options: {
  snapshot: { type: "string" }, out: { type: "string" }, seed: { type: "string" },
  "validation-after": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("tsx scripts/x-ranking-replay.ts --snapshot FILE --out NEW_DIRECTORY --seed FIXED_SEED [--validation-after ISO_DATE]\nDefault: practice/development data, not unseen validation. validation-after rejects earlier posts; it does not prove nobody inspected the corpus.");
  process.exit(0);
}
if (!values.snapshot || !values.out || !values.seed) throw new Error("snapshot, out and seed are required");
const bound = values["validation-after"] ? new Date(values["validation-after"]) : null;
if (bound && !Number.isFinite(bound.getTime())) throw new Error("validation-after must be a valid date");
if (fs.existsSync(values.out)) throw new Error("Preserve prior evidence: out must be a new directory");
const source = fs.readFileSync(values.snapshot, "utf8");
const archived = z.object({ products: z.array(z.object({
  name: z.string(), copies: z.object({ candidate: z.string() }), facts: z.unknown(),
  posts: z.array(z.object({ id: z.string(), author_username: z.string(), text: z.string(), created_at: z.string(), unavailable_at: z.string().nullable().optional() })),
  evaluations: z.array(z.object({ project_id: z.string(), tweet_id: z.string(), stage: z.string(), level: z.string().nullable(), signals: z.unknown(),
    engagement: z.number().nullable(), context: z.unknown(), decision: z.string().nullable() })),
  leads: z.array(z.object({ project_id: z.string(), tweet_id: z.string(), status: z.string() })),
  inbox: z.object({ candidate: z.object({ qualified: z.array(z.object({ tweetId: z.string() })), maybe: z.array(z.object({ tweetId: z.string() })) }) }),
})) }).parse(JSON.parse(source));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const seed = values.seed;
const products = archived.products.map((product) => {
  const posts = new Map(product.posts.map((post) => [post.id, post]));
  const leads = new Map(product.leads.filter((lead) => lead.project_id === product.copies.candidate).map((lead) => [lead.tweet_id, lead]));
  const evaluated = product.evaluations.filter((e) => e.project_id === product.copies.candidate && posts.has(e.tweet_id));
  const inputs = evaluated.filter((e) => {
    const post = posts.get(e.tweet_id)!;
    if (post.unavailable_at) return false;
    const lead = leads.get(e.tweet_id);
    if (lead) return lead.status === "new";
    return ["review", "rejected", "free_rejected"].includes(e.stage) ||
      (["pending_context", "pending_reply"].includes(e.stage) && e.signals != null) ||
      (e.stage === "expired" && ["qualify", "review"].includes(e.decision ?? ""));
  }).map((e) => {
    const post = posts.get(e.tweet_id)!;
    const postedAt = new Date(post.created_at);
    if (!Number.isFinite(postedAt.getTime()) || (bound && postedAt < bound)) throw new Error(`Post ${post.id} is outside the declared validation period`);
    const context = e.context as { replyingTo?: unknown } | null;
    return { key: post.id, author: post.author_username, postedAt, engagement: e.engagement, level: e.level, signals: e.signals,
      text: post.text, parents: Array.isArray(context?.replyingTo) ? context.replyingTo.filter((x): x is string => typeof x === "string") : [] };
  });
  const ranked = rankXOpportunities(inputs);
  const cards = new Map(ranked.map((card) => [card.key, card]));
  const eligibleIds = new Set(inputs.map((input) => input.key));
  // Old UI order from the same arm and retrieval pool, not the other search arm.
  const oldOrder = [...product.inbox.candidate.qualified, ...product.inbox.candidate.maybe]
    .map((row) => row.tweetId).filter((id) => eligibleIds.has(id));
  const inputCards = new Map(inputs.map((card) => [card.key, card]));
  const orders = [oldOrder, ranked.map((card) => card.key)];
  const reviewed = new Set<string>();
  const authors = new Set<string>();
  const drafted: Array<{ id: string; credit: "old" | "new" }> = [];
  const cursor = [0, 0];
  let team = parseInt(hash(`${seed}:${product.name}`).slice(0, 2), 16) % 2;
  while (drafted.length < 10) {
    let selected: string | undefined;
    for (let tries = 0; tries < 2 && !selected; tries += 1) {
      while (cursor[team] < orders[team].length) {
        const id = orders[team][cursor[team]++];
        const author = inputCards.get(id)?.author.trim().toLowerCase() ?? id;
        if (reviewed.has(id) || authors.has(author)) continue;
        selected = id; authors.add(author); break;
      }
      if (!selected) team = 1 - team;
    }
    if (!selected) break;
    reviewed.add(selected); drafted.push({ id: selected, credit: team === 0 ? "old" : "new" }); team = 1 - team;
  }
  return { name: product.name, facts: product.facts, posts: inputs.length, oldOrder,
    newOrder: ranked.map(({ key, priority, checks }) => ({ id: key, priority, checks })),
    top10: drafted.map(({ id }) => inputCards.get(id)!), credit: drafted,
    rest: ranked.filter((card) => !reviewed.has(card.key)),
    aboveFloor: ranked.filter((card) => card.priority !== null && card.priority >= X_PRIORITY_FLOOR).length,
    topPriority: cards.get(ranked[0]?.key)?.priority ?? null };
});
fs.mkdirSync(values.out, { recursive: true });
const write = (name: string, content: string) => fs.writeFileSync(path.join(values.out!, name), content, { flag: "wx" });
const metadata = { version: X_PRIORITY_VERSION, floor: X_PRIORITY_FLOOR, snapshotSha256: hash(source), rankerSha256: hash(fs.readFileSync(new URL("../src/lib/x/priority.ts", import.meta.url), "utf8")),
  seed, validationAfter: bound?.toISOString() ?? null, unseenStatus: "Not independently established; owner must confirm", networkCalls: 0 };
write("replay.json", JSON.stringify({ metadata, products: products.map(({ name, posts, oldOrder, newOrder, aboveFloor, topPriority, credit }) => ({ name, posts, oldOrder, newOrder, aboveFloor, topPriority, credit })) }, null, 2));
// Never embed order identity, score, stage, model label or attribution in the blind packet.
const packet = products.map((p) => ({ name: p.name, facts: p.facts, top10: p.top10.map(({ key, author, postedAt, text, parents }) => ({ key, author, postedAt, text, parents })),
  rest: p.rest.map(({ key, author, postedAt, text, parents }) => ({ key, author, postedAt, text, parents })) }));
const payload = JSON.stringify(packet).replace(/</gu, "\\u003c");
const safeMetadata = JSON.stringify(metadata).replace(/</gu, "\\u003c");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 system-ui;max-width:900px;margin:20px auto;padding:0 16px}article{border-top:1px solid #aaa;padding:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}select,button,input{padding:8px;margin:4px}a{color:inherit}summary{cursor:pointer}small{color:#666}</style></head><body>
<h1>Blind opportunity review</h1><p>${bound ? "Chronological boundary enforced; unseen status still needs confirmation." : "Practice packet: previously inspected development data, NOT independent validation."}</p>
<p>Would you save, investigate or reply to this? Personal/free use can be valuable. Assess against the supplied product facts. No action here contacts anyone.</p>
<label>Reviewer <input id="reviewer" placeholder="Name"></label><label>Perspective <select id="perspective"><option>Project owner</option><option>Kevin proxy</option><option>Other proxy</option></select></label><button id="download">Download choices</button><div id="projects"></div>
<script>const packet=${payload};const choices={};let sequence=0;const metadata=${safeMetadata};
function card(p,c,section){const a=document.createElement('article');const title=document.createElement('a');title.href='https://x.com/'+encodeURIComponent(c.author)+'/status/'+c.key;title.target='_blank';title.rel='noopener noreferrer';title.textContent='@'+c.author+' · '+c.postedAt;const text=document.createElement('pre');text.textContent=c.text;const parents=document.createElement('pre');parents.textContent=c.parents.join('\\n\\n');const select=document.createElement('select');['Unreviewed','Save','Investigate','Reply','Skip'].forEach(label=>{const o=document.createElement('option');o.textContent=label;select.append(o)});select.onchange=()=>{choices[p.name+':'+c.key]={project:p.name,tweetId:c.key,choice:select.value,section,sequence:++sequence}};a.append(title,text,parents,select);return a}
packet.forEach(p=>{const section=document.createElement('section');const h=document.createElement('h2');h.textContent=p.name;const facts=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Product facts';const pre=document.createElement('pre');pre.textContent=JSON.stringify(p.facts,null,2);facts.append(summary,pre);section.append(h,facts);p.top10.forEach(c=>section.append(card(p,c,'first10')));const rest=document.createElement('details');const restTitle=document.createElement('summary');restTitle.textContent='Review remaining '+p.rest.length+' posts for missed opportunities';rest.append(restTitle);p.rest.forEach(c=>rest.append(card(p,c,'rest')));section.append(rest);document.getElementById('projects').append(section)});
document.getElementById('download').onclick=()=>{const b=new Blob([JSON.stringify({metadata,reviewer:document.getElementById('reviewer').value,perspective:document.getElementById('perspective').value,choices:Object.values(choices)},null,2)],{type:'application/json'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download='owner-choices.json';a.click();URL.revokeObjectURL(u)};
</script></body></html>`;
write("review.html", html);
console.log(JSON.stringify({ ...metadata, products: products.map(({ name, posts, aboveFloor, topPriority }) => ({ name, posts, aboveFloor, topPriority })) }, null, 2));
