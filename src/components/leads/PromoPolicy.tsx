"use client";

import { useEffect, useState } from "react";
import { promoPolicyAction } from "@/app/app/leads/actions";

/**
 * One read per community per page, however many places on the screen show its
 * rule: the header badge and the rail both ask, and both get the same answer.
 */
const asked = new Map<string, Promise<string | null>>();

function ask(projectId: string, subreddit: string): Promise<string | null> {
  const key = `${projectId}:${subreddit.toLowerCase()}`;
  let reading = asked.get(key);
  if (!reading) {
    reading = promoPolicyAction(projectId, subreddit).catch(() => null);
    asked.set(key, reading);
  }
  return reading;
}

/**
 * A community's self-promotion rule, read the first time a lead in it is
 * opened. The feed hands over the rule when somebody has already read it;
 * when nobody has, this asks for it and the caller draws whatever it has.
 */
export function usePromoPolicy(
  projectId: string,
  subreddit: string | null,
  known: string | null,
): { policy: string | null; reading: boolean } {
  const [read, setRead] = useState<{ subreddit: string; policy: string | null } | null>(null);
  useEffect(() => {
    if (known || !subreddit) {
      return;
    }
    let current = true;
    void ask(projectId, subreddit).then((policy) => {
      if (current) {
        setRead({ subreddit, policy });
      }
    });
    return () => {
      current = false;
    };
  }, [projectId, subreddit, known]);

  if (known) {
    return { policy: known, reading: false };
  }
  const answered = read && read.subreddit === subreddit;
  return { policy: answered ? read.policy : null, reading: Boolean(subreddit) && !answered };
}
