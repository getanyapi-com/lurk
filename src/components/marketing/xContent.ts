/**
 * Real public X posts that lurk's X scan listed as leads, read from the local
 * pilot Postgres (x_leads + x_posts) on 2026-09-30. The projects were test
 * copies of Cal.com and Clipy. Handles, avatars, dates and counts are as
 * saved. Display names lose their emoji; long posts keep their opening
 * lines, without links or leading @handles, and are never reworded; a
 * trimmed post ends in "Show more" as it does on X. Reasons are the judge's
 * own, some cut short. No invented posts.
 */
export type MockXPost = {
  id: string;
  username: string;
  name: string;
  avatar: string;
  text: string;
  date: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  verified: boolean;
  /** The handles a reply answers, shown as X shows them above the text. */
  replyingTo?: string[];
  /** The saved text runs on past what is shown, so the card ends in "Show more". */
  more?: boolean;
  /** The saved 0-4 fit and intent. */
  fit: number;
  intent: number;
  /** "ask" for someone shopping, else the moment a reply lead was filed under. */
  kind: "ask" | "building_their_own";
  /** The product the scan was run for. */
  product: { name: string; domain: string };
  reason: string;
};

const CAL = { name: "Cal.com", domain: "cal.com" };
const CLIPY = { name: "Clipy", domain: "clipy.online" };

export const xPostUrl = (post: MockXPost) => `https://x.com/${post.username}/status/${post.id}`;

export const X_ROUND_ROBIN: MockXPost = {
  id: "2102070473446031613",
  username: "Tmeister",
  name: "Enrique Chavez",
  avatar: "https://pbs.twimg.com/profile_images/2086173832256090114/EN4bSsmX_normal.jpg",
  text: "I'm looking for an alternative to Calendly, and the only feature I want is round-robin scheduling.",
  date: "Sep 21",
  views: 848,
  likes: 6,
  replies: 10,
  reposts: 0,
  verified: true,
  more: true,
  fit: 3,
  intent: 3,
  kind: "ask",
  product: CAL,
  reason:
    "Developer needs affordable Calendly alternative for round-robin scheduling, which Cal.com covers with team booking routing and distribution.",
};

export const X_SELF_HOST: MockXPost = {
  id: "2099604273277665312",
  username: "theozero",
  name: "Theo Ephraim",
  avatar: "https://pbs.twimg.com/profile_images/1794043297024921614/X-dez448_normal.jpg",
  text: "Anyone found an open-source calendly/cal-com replacement you self host on @CloudflareDev workers?",
  date: "Sep 14",
  views: 3962,
  likes: 23,
  replies: 9,
  reposts: 0,
  verified: true,
  fit: 3,
  intent: 3,
  kind: "ask",
  product: CAL,
  reason: "Needs self-hostable open-source alternative to Calendly on Cloudflare Workers.",
};

export const X_DOUBLE_BOOKED: MockXPost = {
  id: "2103508982560412031",
  username: "nazanin_ashrafi",
  name: "Naz Ashrafi",
  avatar: "https://pbs.twimg.com/profile_images/2104188701035151360/hDI9grn7_normal.jpg",
  text: "yeah I really like an alternative because calendly is crazy.\n\nit just allowed the same time to be chosen TWICE 😭😭",
  date: "Sep 25",
  views: 59,
  likes: 1,
  replies: 1,
  reposts: 0,
  verified: false,
  replyingTo: ["AmeliaDutta", "wottavm"],
  fit: 3,
  intent: 3,
  kind: "ask",
  product: CAL,
  reason: "Needs a reliable Calendly replacement that blocks the same slot being booked twice.",
};

export const X_CALENDLY_PLUS: MockXPost = {
  id: "2104318737541439638",
  username: "jasonlk",
  name: "Jason Lemkin",
  avatar: "https://pbs.twimg.com/profile_images/1981936022049972224/xvLI9bNx_normal.jpg",
  text: "So we vibe coded our own Calendly++. Why the heck would you do this, when Calendly is cheap, proven, and just works well?",
  date: "Sep 27",
  views: 16124,
  likes: 65,
  replies: 24,
  reposts: 4,
  verified: true,
  more: true,
  fit: 2,
  intent: 1,
  kind: "building_their_own",
  product: CAL,
  reason: "Built a custom scheduler because Calendly lacked routing; a reply can show Cal.com's open-source API as the buy-not-build fix.",
};

export const X_LICENSE_RAN_OUT: MockXPost = {
  id: "2094888320878956980",
  username: "kylebuildsweb",
  name: "Kyle Richardson",
  avatar: "https://pbs.twimg.com/profile_images/1809383713232556032/BSFOGlVe_normal.jpg",
  text: "what screen recording do people use now? I had screen studio but license ran out",
  date: "Sep 1",
  views: 129,
  likes: 4,
  replies: 4,
  reposts: 0,
  verified: true,
  fit: 3,
  intent: 3,
  kind: "ask",
  product: CLIPY,
  reason: "Software engineer needs a replacement after the Screen Studio license lapsed.",
};

export const X_TOO_EXPENSIVE: MockXPost = {
  id: "2095400225913651234",
  username: "ui_varshaa",
  name: "Varshaa",
  avatar: "https://pbs.twimg.com/profile_images/1918606158929305601/Tw0b8FrK_normal.jpg",
  text: "I use Screen Studio but it's too expensive for me. I wanna find an alternative. What do you use currently?",
  date: "Sep 3",
  views: 174,
  likes: 1,
  replies: 1,
  reposts: 0,
  verified: true,
  replyingTo: ["bybellarizp"],
  fit: 3,
  intent: 3,
  kind: "ask",
  product: CLIPY,
  reason: "Freelance designer needs a cheaper Screen Studio alternative.",
};

export const X_OWN_RECORDER: MockXPost = {
  id: "2104634863022207080",
  username: "adambuildsapps",
  name: "Adam",
  avatar: "https://pbs.twimg.com/profile_images/2063817094504861696/LaKMB71j_normal.jpg",
  text: "Vibe coded my own screen recording software because I don’t wanna pay $30/m for screen studio",
  date: "Sep 28",
  views: 2,
  likes: 0,
  replies: 0,
  reposts: 0,
  verified: false,
  fit: 3,
  intent: 2,
  kind: "building_their_own",
  product: CLIPY,
  reason: "Built their own recorder to avoid the cost; a reply can offer a cheaper one.",
};

/** The Cal.com test project's X tab, as the mock window shows it. */
export const MOCK_X_ASKS = [X_ROUND_ROBIN, X_SELF_HOST, X_DOUBLE_BOOKED];
export const MOCK_X_REPLIES = [X_CALENDLY_PLUS];
