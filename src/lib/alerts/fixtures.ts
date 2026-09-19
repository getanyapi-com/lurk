import { config } from "@/lib/config";
import type { Digest, DigestLead } from "./types";

const HOUR_MS = 60 * 60 * 1000;

const SAMPLES: Array<Omit<DigestLead, "createdAt"> & { hoursAgo: number }> = [
  {
    id: "sample-1",
    title: "Paying $99/mo for a scraper that breaks every other week",
    url: "https://www.reddit.com/r/SaaS/comments/sample1/",
    subreddit: "SaaS",
    author: "ella_builds",
    avatarUrl: null,
    score: 91,
    reason: "Names the current tool, the price and the failure. Ready to switch.",
    matchedPhrase: "breaks every other week",
    excerpt:
      "We have been on the same scraping vendor for a year, paying $99/mo, and it breaks every other week when the site changes its markup. I am done babysitting it. What are people switching to?",
    isComment: false,
    numComments: 14,
    hoursAgo: 2,
  },
  {
    id: "sample-2",
    title: "How are you all pulling Reddit data without getting rate limited?",
    url: "https://www.reddit.com/r/webdev/comments/sample2/",
    subreddit: "webdev",
    author: "mkderrick",
    avatarUrl: null,
    score: 74,
    reason: "Solution seeking, no vendor named yet.",
    matchedPhrase: "without getting rate limited",
    excerpt:
      "Building a small monitoring tool and I keep hitting 429s after a few hundred requests. How are you all pulling Reddit data without getting rate limited? Happy to pay for something if it just works.",
    isComment: false,
    numComments: 23,
    hoursAgo: 5,
  },
  {
    id: "sample-3",
    title: "Anyone compared the lead finders that watch subreddits?",
    url: "https://www.reddit.com/r/growmybusiness/comments/sample3/",
    subreddit: "growmybusiness",
    author: "quiet_founder",
    avatarUrl: null,
    score: 58,
    reason: "Comparing options, no budget stated.",
    matchedPhrase: "lead finders that watch subreddits",
    excerpt:
      "There seem to be a dozen lead finders that watch subreddits now. Has anyone actually compared them side by side? Mostly care about how many of the alerts are real buyers.",
    isComment: false,
    numComments: 6,
    hoursAgo: 9,
  },
];

/**
 * The three leads a test send carries. Fixed copy, so a person can tell a test
 * from a real digest at a glance.
 */
export function sampleDigest(projectName: string, now = new Date()): Digest {
  return {
    projectName,
    generatedAt: now,
    since: new Date(now.getTime() - 24 * HOUR_MS),
    cadence: "daily",
    appUrl: config().APP_URL,
    leads: SAMPLES.map(({ hoursAgo, ...lead }) => ({
      ...lead,
      createdAt: new Date(now.getTime() - hoursAgo * HOUR_MS),
    })),
  };
}
