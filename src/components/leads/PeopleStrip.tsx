import { AuthorAvatar } from "@/components/AuthorAvatar";
import { groupByDay, scoreRing } from "@/components/leads/stream";
import type { LeadFace } from "@/lib/feed";

type PeopleStripProps = { faces: LeadFace[] };

const AVATAR = 32;

/**
 * Every person this project has a lead on, grouped by the day they posted and
 * newest first. Only leads: a face here is someone worth answering.
 *
 * It is read on its own, and not from the rows in the list, because the list
 * holds one page and this is a calendar: a day missing from it would read as a
 * day nobody asked, rather than a day you have not scrolled to.
 */
export function PeopleStrip({ faces }: PeopleStripProps) {
  const days = groupByDay(faces);
  if (days.length === 0) {
    return null;
  }
  return (
    <div className="flex gap-6 overflow-x-auto rounded-card border bg-surface px-4 py-3">
      {days.map((day) => (
        <div key={day.day} className="flex shrink-0 flex-col items-start gap-2">
          <div className="flex items-center gap-2 pt-1 pr-1">
            {day.faces.map((face) => (
              <span
                key={face.id}
                className={`inline-flex rounded-full ring-2 ring-offset-2 ring-offset-surface ${scoreRing(face.score)}`}
                title={`u/${face.author ?? "unknown"} in r/${face.subreddit}`}
              >
                <AuthorAvatar name={face.author} src={face.avatarUrl} size={AVATAR} />
              </span>
            ))}
          </div>
          <span className="text-mono text-fg-muted">{day.label}</span>
        </div>
      ))}
    </div>
  );
}
