/**
 * Saved public examples read from the product Postgres on 2026-09-05:
 * leads + reddit_posts + reddit_comments + reddit_authors; SEO from
 * seo_opportunities + reddit_posts. Comment leads use the comment author.
 * Real r/nocode and r/Entrepreneur icons and the r/nocode sidebar policy came
 * from AnyAPI SDK reddit.subreddit_details on the same date ($0.0012 each).
 * Titles, permalinks, avatars, scores, reasons and phrases are real saved data.
 * Cost lines illustrate a measured call price, not total cost for these leads.
 * Round 3: distinct threads from reddit_posts; measure-* projects have no saved
 * leads. Their unscored examples are labeled, never assigned invented scores.
 * Public avatar/icon enrichment: 8 AnyAPI calls, $0.0096; missing community
 * icons remain absent. See round3-db-public.json and round3-anyapi-public.json.
 * No synthetic identities, live counts, request IDs or current-rank claims.
 * The fit and intent levels on each lead were read from lead_evaluations for
 * the same posts on 2026-09-16, on the current 0-4 scales. The folded score is
 * gone from here because it is gone from the product's cards: it is a sort
 * order, and no card shows it.
 */
import type { RailIcon } from "@/components/Rail";

export type MockLead = {
  author: string;
  avatar: string;
  subreddit: string;
  subredditIcon: string;
  age: string;
  /** The saved fit and intent levels, 0-4, as the scan answered them. */
  fit: number;
  intent: number;
  stage: string;
  title: string;
  url: string;
  reason: string;
  body: string;
  matchedPhrase: string;
  promoRule: string;
  kind: string;
};

export const MOCK_LEADS: MockLead[] = [
  {
    author: "driftmoose88",
    avatar:
      "https://i.redd.it/snoovatar/avatars/844c1f80-3dd6-42e5-9c6b-432481eda424-headshot.png",
    subreddit: "nocode",
    subredditIcon:
      "https://styles.redditmedia.com/t5_3gbip/styles/communityIcon_99qld76bwkle1.png?width=64&frame=1&auto=webp&s=8ae23376d057ff01792c2af164cbfad72a78f9df",
    age: "Saved Sep 2",
    fit: 3,
    intent: 3,
    stage: "comparing",
    title: "Looking for a simpler Jotform alternative",
    url: "https://www.reddit.com/r/nocode/comments/1w5mqwf/looking_for_a_simpler_jotform_alternative/",
    reason:
      "They find Jotform overkill for basic surveys and asked for a simpler tool non-technical staff can manage.",
    body: "Looking for a Jotform alternative that's more focused on surveys/feedback",
    matchedPhrase:
      "Looking for a Jotform alternative that's more focused on surveys/feedback",
    promoRule: "No blatant self-promotion; contribute value",
    kind: "Post",
  },
  {
    author: "jordanmiller81",
    avatar:
      "https://i.redd.it/snoovatar/avatars/00b115bf-9fbb-4b98-ae27-b1c14663f0d8-headshot.png",
    subreddit: "nocode",
    subredditIcon:
      "https://styles.redditmedia.com/t5_3gbip/styles/communityIcon_99qld76bwkle1.png?width=64&frame=1&auto=webp&s=8ae23376d057ff01792c2af164cbfad72a78f9df",
    age: "Saved Sep 2",
    fit: 3,
    intent: 2,
    stage: "solution seeking",
    title: "Looking for a simpler Jotform alternative",
    url: "https://www.reddit.com/r/nocode/comments/1w5mqwf/looking_for_a_simpler_jotform_alternative/p7gb2jb/",
    reason:
      "Shares the pain of needing a simpler Jotform replacement and asks for an alternative too.",
    body: "I'm actually looking for an alternative too",
    matchedPhrase: "I'm actually looking for an alternative too",
    promoRule: "No blatant self-promotion; contribute value",
    kind: "Comment",
  },
];

export const MOCK_DETAIL = MOCK_LEADS[0];
export const MOCK_TIMELINE = [
  {
    author: "driftmoose88",
    avatar:
      "https://i.redd.it/snoovatar/avatars/844c1f80-3dd6-42e5-9c6b-432481eda424-headshot.png",
    subreddit: "nocode",
  },
  {
    author: "jordanmiller81",
    avatar:
      "https://i.redd.it/snoovatar/avatars/00b115bf-9fbb-4b98-ae27-b1c14663f0d8-headshot.png",
    subreddit: "nocode",
  },
  {
    author: "akl773",
    avatar:
      "https://i.redd.it/snoovatar/avatars/755f90a8-7759-4e52-9bf3-f69f7295f175-headshot.png",
    subreddit: "nocode",
  },
];
export const MOCK_SEO = [
  {
    keyword: "free form builder",
    title:
      "Looking for a form builder that's actually engaging (but not just another submission box)",
    url: "https://www.reddit.com/r/Entrepreneur/comments/1o5nn0k/looking_for_a_form_builder_thats_actually/",
    position: 4,
    competitorPresent: true,
    subreddit: "Entrepreneur",
    icon: "https://styles.redditmedia.com/t5_2qldo/styles/communityIcon_vbw2fy8csgz01.png?width=64&frame=1&auto=webp&s=f9d09673d8d4331f2bb74fc5ed05eb49110bc790",
    date: "2025-10-13",
  },
  {
    keyword: "free form builder",
    title:
      "Which are the best online form builder and surveying tools?&why you're using it?",
    url: "https://www.reddit.com/r/marketing/comments/1d317mp/which_are_the_best_online_form_builder_and/",
    position: 5,
    competitorPresent: false,
    subreddit: "marketing",
    icon: "https://styles.redditmedia.com/t5_2qhmg/styles/communityIcon_amdb6rj8w5p31.png?width=64&frame=1&auto=webp&s=d48e5f727675807e2ad0e7c88223eb81a7b86c74",
    date: "2024-05-29",
  },
];

export const MOCK_DRAFT =
  "Which decision do you want your budget to help with first: what is safe to spend, which category is drifting, or what to change next month? That would help narrow down the kind of tool you need.";


export const MOCK_RAIL: {
  label: string;
  items: { name: string; icon: RailIcon }[];
}[] = [
  {
    label: "Discover",
    items: [
      { name: "Leads", icon: "radar" },
      { name: "Reddit SEO", icon: "search" },
    ],
  },
  {
    label: "Understand",
    items: [
      { name: "Competitors", icon: "swords" },
      { name: "Insights", icon: "lightbulb" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { name: "Product", icon: "box" },
      { name: "Data usage", icon: "receipt" },
      { name: "Settings", icon: "settings" },
    ],
  },
];

export type MockThread = Pick<
  MockLead,
  "author" | "avatar" | "subreddit" | "subredditIcon" | "title" | "url" | "body"
>;
export const RULE_THREAD: MockThread = {
  author: "TurboDragonX76",
  avatar:
    "https://i.redd.it/snoovatar/avatars/0d62a193-23b2-48d2-95be-468dc10ebfc1-headshot.png",
  subreddit: "nocode",
  subredditIcon:
    "https://styles.redditmedia.com/t5_3gbip/styles/communityIcon_99qld76bwkle1.png?width=64&frame=1&auto=webp&s=8ae23376d057ff01792c2af164cbfad72a78f9df",
  title: "Tally alternative with better survey analysis?",
  url: "https://www.reddit.com/r/nocode/comments/1w7fzbr/tally_alternative_with_better_survey_analysis/",
  body: "I neI've been using Tally for client intake and it's honestly been great for basic forms.\n\nMy workflow has changed though. I'm doing more post-project questionnaires now and getting longer written responses from clients. The form itself isn't really the problem anymore. It's going back through all those answers and figuring out which issues or themes keep showing up across projects.\n\nI'm looking for a Tally alternative that's still straightforward to build with but puts more emphasis on actually analyzing survey responses.\n\nHas anyone made a similar switch?",
};
export const DRAFT_THREAD: MockThread = {
  author: "Common-Parfait21",
  avatar:
    "https://i.redd.it/snoovatar/avatars/ed935e67-f6a7-4a94-befc-59a75af7cd37-headshot.png",
  subreddit: "personalfinance",
  subredditIcon: "",
  title: "Any budgeting app for people who enjoy the budgeting process?",
  url: "https://www.reddit.com/r/personalfinance/comments/1w792xg/any_budgeting_app_for_people_who_enjoy_the/",
  body: "Im probably the opposite of someone who needs budgeting 101 because I check my accounts basically every day and genuinely enjoy messing with categories and spreadsheets. My issue is that Im spending a lot of time maintaining the system without always getting a clear answer on whether I should change anything. What budgeting app works well for someone who wants detail but also wants the numbers to actually point toward a next move?",
};
export const ALERT_THREAD: MockThread = {
  author: "SenorSmartyPantz",
  avatar:
    "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png",
  subreddit: "selfhosted",
  subredditIcon:
    "https://styles.redditmedia.com/t5_32hch/styles/communityIcon_zttnt3jjmddh1.png?width=64&frame=1&auto=webp&s=4a0dfbfac29b79ce75d06e5079e027aad47a849b",
  title: "Monitor and log to find high load process?",
  url: "https://www.reddit.com/r/selfhosted/comments/1w8681z/monitor_and_log_to_find_high_load_process/",
  body: "",
};
export const SCAN_LEAD: MockLead = {
  author: "TurboKestrel45",
  avatar:
    "https://i.redd.it/snoovatar/avatars/1ffc54aa-06ad-4396-829f-dd60cbf2d4a8-headshot.png",
  subreddit: "GPT",
  subredditIcon: "",
  title: "AI form builder that can create forms from training material?",
  url: "https://www.reddit.com/r/GPT/comments/1w4pynu/ai_form_builder_that_can_create_forms_from/",
  body: "I handle internal training at work and creating a new feedback form after every session gets repetitive. Looking for an AI form builder that can take a training doc, understand the topic, and generate relevant feedback questions that I can tweak afterward. Any recommendations? ",
  fit: 2,
  intent: 3,
  stage: "solution seeking",
  reason:
    "They waste time rebuilding training feedback forms and asked for an AI builder that generates editable questions from a doc.",
  matchedPhrase:
    "creating a new feedback form after every session gets repetitive",
  promoRule: "Community policy unavailable. Read the current rules.",
  age: "Saved example",
  kind: "Post",
};
/**
 * The same post's saved scoring parts and Reddit counts. The counts were read
 * on 2026-09-06; engagement was read again on 2026-09-16, because the value
 * saved here was on a 0-10 scale the scan stopped using. Fit and intent live on
 * SCAN_LEAD itself, so the badge and this list cannot disagree.
 */
export const SCAN_LEAD_FACTS = {
  engagement: 0,
  points: 6,
  comments: 27,
  age: "Sep 1",
};
