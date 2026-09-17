import type { ScanCadence, ScanCadenceSettings } from "./types";

const HOUR_MS = 60 * 60 * 1000;

/** Every `hours` hours from now, which is how a paid wallet scans. */
class IntervalCadence implements ScanCadence {
  constructor(private readonly hours: number) {}

  intervalHours(): number {
    return this.hours;
  }

  nextRunAt(now: Date): Date {
    return new Date(now.getTime() + this.hours * HOUR_MS);
  }
}

/** What a zone's wall clock reads at an instant. */
type Wall = { year: number; month: number; day: number };

function wallClock(timezone: string, at: number): Wall & { ms: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    ms: Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    ),
  };
}

/** How far ahead of UTC the zone is at that instant, DST included. */
function offsetAt(timezone: string, at: number): number {
  return wallClock(timezone, at).ms - at;
}

/**
 * The instant at which `timezone` reads that wall time. The offset depends on
 * the instant we are looking for, so it is taken twice: once from the naive
 * guess and once from the instant that guess produced, which is what makes the
 * two days a year the offset changes come out right.
 */
function instantOf(timezone: string, wall: Wall, hour: number): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, hour);
  const guess = naive - offsetAt(timezone, naive);
  return naive - offsetAt(timezone, guess);
}

/** Once a day at a wall-clock hour, which is how the free tier scans. */
class DailyCadence implements ScanCadence {
  constructor(
    private readonly hour: number,
    private readonly timezone: string,
  ) {}

  intervalHours(): number {
    return 24;
  }

  nextRunAt(now: Date): Date {
    const wall = wallClock(this.timezone, now.getTime());
    const today = instantOf(this.timezone, wall, this.hour);
    if (today > now.getTime()) {
      return new Date(today);
    }
    return new Date(instantOf(this.timezone, { ...wall, day: wall.day + 1 }, this.hour));
  }
}

/** The one place a cadence setting becomes something the scheduler can ask. */
export function cadenceFor(settings: ScanCadenceSettings): ScanCadence {
  return settings.kind === "interval"
    ? new IntervalCadence(settings.hours)
    : new DailyCadence(settings.hour, settings.timezone);
}
