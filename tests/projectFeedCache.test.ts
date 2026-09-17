import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEED_HOLD_MS,
  forgetEveryProjectFeed,
  forgetProjectFeed,
  readProjectFeed,
} from "@/lib/projectFeedCache";

/**
 * What the leads page does not read twice. Selecting a lead changes only
 * `?lead=`, so the same filter must be answered from the read the page already
 * made, and anything that could have moved that read must drop it.
 */

afterEach(() => {
  forgetEveryProjectFeed();
  vi.useRealTimers();
});

const PROJECT = "project-1";
const OTHER = "project-2";

/** A read that says how many times it has actually been run. */
function counted<T>(value: T) {
  let runs = 0;
  return {
    read: async () => {
      runs += 1;
      return value;
    },
    get runs() {
      return runs;
    },
  };
}

describe("the feed read a project is holding", () => {
  it("answers the same filter without reading again", async () => {
    const source = counted("one");
    expect(await readProjectFeed(PROJECT, "a", source.read)).toBe("one");
    expect(await readProjectFeed(PROJECT, "a", source.read)).toBe("one");
    expect(source.runs).toBe(1);
  });

  it("hands back the same promise, so two reads in one render share one trip", () => {
    const source = counted("one");
    const first = readProjectFeed(PROJECT, "a", source.read);
    expect(readProjectFeed(PROJECT, "a", source.read)).toBe(first);
    expect(source.runs).toBe(1);
  });

  it("reads again when the filter moves, and keeps only the newest", async () => {
    const source = counted("one");
    await readProjectFeed(PROJECT, "a", source.read);
    await readProjectFeed(PROJECT, "b", source.read);
    expect(source.runs).toBe(2);
    // Back to the first filter is a read, not a hit: one entry per project.
    await readProjectFeed(PROJECT, "a", source.read);
    expect(source.runs).toBe(3);
  });

  it("holds one project's read without answering another's", async () => {
    const source = counted("one");
    await readProjectFeed(PROJECT, "a", source.read);
    await readProjectFeed(OTHER, "a", source.read);
    expect(source.runs).toBe(2);
  });

  it("reads again once it is forgotten", async () => {
    const source = counted("one");
    await readProjectFeed(PROJECT, "a", source.read);
    forgetProjectFeed(PROJECT);
    await readProjectFeed(PROJECT, "a", source.read);
    expect(source.runs).toBe(2);
  });

  it("forgets every project a scan wrote to at once", async () => {
    const source = counted("one");
    await readProjectFeed(PROJECT, "a", source.read);
    await readProjectFeed(OTHER, "a", source.read);
    forgetProjectFeed(new Set([PROJECT, OTHER]));
    await readProjectFeed(PROJECT, "a", source.read);
    await readProjectFeed(OTHER, "a", source.read);
    expect(source.runs).toBe(4);
  });

  /**
   * The date window is bound when the read runs, and no writer can announce
   * that time has passed, so a project nobody writes to must stop answering
   * from a read made under a window that has since moved.
   */
  it("stops answering from a read older than the hold", async () => {
    vi.useFakeTimers();
    const source = counted("one");
    await readProjectFeed(PROJECT, "a", source.read);
    vi.advanceTimersByTime(FEED_HOLD_MS - 1);
    await readProjectFeed(PROJECT, "a", source.read);
    expect(source.runs).toBe(1);
    vi.advanceTimersByTime(1);
    await readProjectFeed(PROJECT, "a", source.read);
    expect(source.runs).toBe(2);
  });

  /** A read that threw is not an answer, so it is never handed to anyone. */
  it("forgets a read that failed", async () => {
    let runs = 0;
    const read = async () => {
      runs += 1;
      if (runs === 1) {
        throw new Error("the database said no");
      }
      return "one";
    };
    await expect(readProjectFeed(PROJECT, "a", read)).rejects.toThrow("the database said no");
    expect(await readProjectFeed(PROJECT, "a", read)).toBe("one");
    expect(runs).toBe(2);
  });
});
