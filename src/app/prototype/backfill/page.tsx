"use client";

/**
 * PROTOTYPE: four boards for showing the year's backfill happening live,
 * switchable with ?variant=A|B|C|D and the arrow keys. By default it replays
 * the recorded real run (replay.ts) from page load at real speed; ?speed=2
 * runs it twice as fast. ?project=<id> reads a live backfill from the database
 * instead, and ?sim=1 uses the synthetic simulation in sim.ts.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useLiveBackfill } from "./live";
import { useReplay } from "./replay";
import { useBackfillSim } from "./sim";
import { VariantA, VariantB, VariantC, VariantD } from "./variants";

const VARIANTS = [
  ["A", "The board"], ["B", "The stream"], ["C", "The sorter"], ["D", "The year"],
] as const;

function Board() {
  const params = useSearchParams();
  const router = useRouter();
  const key = params.get("variant") ?? "A";
  const speed = Number(params.get("speed") ?? "1") || 1;
  const project = params.get("project");
  const simulated = params.get("sim") === "1";
  const sim = useBackfillSim(!project && simulated ? speed : 0);
  const replay = useReplay(speed, !project && !simulated);
  const live = useLiveBackfill(project);
  const s = project ? live : simulated ? sim : replay;
  const index = Math.max(0, VARIANTS.findIndex(([k]) => k === key));
  const go = (delta: number) => {
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length][0];
    const q = new URLSearchParams(params.toString());
    q.set("variant", next);
    router.replace(`?${q}`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      {key === "A" && <VariantA s={s} />}
      {key === "B" && <VariantB s={s} />}
      {key === "C" && <VariantC s={s} />}
      {key === "D" && <VariantD s={s} />}
      {process.env.NODE_ENV !== "production" ? (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 font-mono text-[12px] shadow-lg" style={{ background: "oklch(0.3 0.15 300)", color: "white" }}>
          <button onClick={() => go(-1)}>←</button>
          <span>{VARIANTS[index][0]} · {VARIANTS[index][1]}</span>
          <button onClick={() => go(1)}>→</button>
        </div>
      ) : null}
    </>
  );
}

export default function BackfillPrototypePage() {
  return <Suspense><Board /></Suspense>;
}
