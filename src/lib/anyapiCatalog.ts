/** The most asked-for platforms in the AnyAPI catalog, named wherever lurk sells it. */
export const ANYAPI_PLATFORMS = [
  { name: "Reddit", src: "/brands/reddit.svg", gets: "Posts, comments, subreddits" },
  { name: "TikTok", domain: "tiktok.com", gets: "Videos, comments, transcripts" },
  { name: "Instagram", domain: "instagram.com", gets: "Profiles, posts, reels" },
  { name: "YouTube", domain: "youtube.com", gets: "Videos, comments, transcripts" },
  { name: "X", domain: "x.com", gets: "Posts, replies, profiles" },
  { name: "LinkedIn", domain: "linkedin.com", gets: "Profiles, companies, jobs" },
  { name: "Facebook", domain: "facebook.com", gets: "Pages, posts, ads" },
  { name: "Google Maps", domain: "maps.google.com", gets: "Places, reviews, contacts" },
  { name: "Amazon", domain: "amazon.com", gets: "Products, prices, reviews" },
] as const;

/** Starting price per 1,000 requests, read from the AnyAPI catalog on 2026-09-18. */
export const ANYAPI_PRICES_OBSERVED = "2026-09-18";

export const ANYAPI_PRICES = [
  { endpoint: "reddit.search", name: "Reddit", src: "/brands/reddit.svg", per1k: 0.38 },
  { endpoint: "tiktok.video_comments", name: "TikTok", domain: "tiktok.com", per1k: 0.7 },
  { endpoint: "amazon.product", name: "Amazon", domain: "amazon.com", per1k: 1 },
  { endpoint: "instagram.profile", name: "Instagram", domain: "instagram.com", per1k: 1.2 },
  { endpoint: "maps.reviews", name: "Google Maps", domain: "maps.google.com", per1k: 3.5 },
  { endpoint: "linkedin.profile", name: "LinkedIn", domain: "linkedin.com", per1k: 4 },
] as const;
