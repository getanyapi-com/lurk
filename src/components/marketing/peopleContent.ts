/**
 * Real Reddit accounts whose posts were listed by a scan on the house key, read
 * back through reddit.profile on 2026-09-05: 140 calls, $0.1680. Only
 * accounts with a custom avatar are kept, so the wall shows people, not defaults.
 */
export type Person = { username: string; avatarUrl: string };

export const PEOPLE: Person[] = [
  { username: "driftmoose88", avatarUrl: "https://i.redd.it/snoovatar/avatars/844c1f80-3dd6-42e5-9c6b-432481eda424-headshot.png" },
  { username: "jordanmiller81", avatarUrl: "https://i.redd.it/snoovatar/avatars/00b115bf-9fbb-4b98-ae27-b1c14663f0d8-headshot.png" },
  { username: "akl773", avatarUrl: "https://i.redd.it/snoovatar/avatars/755f90a8-7759-4e52-9bf3-f69f7295f175-headshot.png" },
  { username: "turbokestrel45", avatarUrl: "https://i.redd.it/snoovatar/avatars/1ffc54aa-06ad-4396-829f-dd60cbf2d4a8-headshot.png" },
  { username: "giniroyasha", avatarUrl: "https://i.redd.it/snoovatar/avatars/75a7ef26-32e7-4831-bfe6-b15ca9126ca4-headshot.png" },
  { username: "Ok-Tomatillo-6785", avatarUrl: "https://i.redd.it/snoovatar/avatars/608d10a1-34f4-463a-ac77-43f8d2a6b42b-headshot.png" },
  { username: "Prince-ow", avatarUrl: "https://i.redd.it/snoovatar/avatars/83124a6b-8962-43a3-9936-d89c55258737-headshot.png" },
  { username: "Makimasg", avatarUrl: "https://i.redd.it/snoovatar/avatars/503efe69-1b63-4d86-952f-0561965bed35-headshot.png" },
  { username: "Mar-helko", avatarUrl: "https://i.redd.it/snoovatar/avatars/43d67380-211e-431c-b030-593eb3b972e8-headshot.png" },
  { username: "Suspicious-Doughnut-", avatarUrl: "https://i.redd.it/snoovatar/avatars/3cf99679-bb13-4fbb-9544-f5e470011187-headshot.png" },
  { username: "Filonux", avatarUrl: "https://i.redd.it/snoovatar/avatars/0289770a-8116-4d6f-8dd7-e7adc1ff1f78-headshot.png" },
  { username: "laddermanUS", avatarUrl: "https://i.redd.it/snoovatar/avatars/e07db4c2-3d18-42df-a877-567e88963193-headshot.png" },
  { username: "SorcererOfDooDoo", avatarUrl: "https://i.redd.it/snoovatar/avatars/nftv2_bmZ0X2VpcDE1NToxMzdfNmFjYjhmYjgyODgwZDM5YzJiODQ0NmY4Nzc4YTE0ZDM0ZWU2Y2ZiN18xOTY3MzA_rare_ff4f44f6-51fb-46a5-8c2d-dace5ed6588f-headshot.png" },
  { username: "Minute_Quail1995", avatarUrl: "https://i.redd.it/snoovatar/avatars/2916dd6b-733f-45a4-a03f-53218f620f81-headshot.png" },
  { username: "Deeman6679", avatarUrl: "https://i.redd.it/snoovatar/avatars/a6315ea1-e492-4504-b5d6-5db7cde4be26-headshot.png" },
  { username: "Exotic_Grass_2979", avatarUrl: "https://i.redd.it/snoovatar/avatars/6ace9bac-691a-4dfb-b7cc-e37c36e8f4d2-headshot.png" },
  { username: "Background-Hope5549", avatarUrl: "https://i.redd.it/snoovatar/avatars/e9d2fcd5-b9d5-45d0-9919-ce647b709cbd-headshot.png" },
  { username: "Lipplate", avatarUrl: "https://i.redd.it/snoovatar/avatars/1485c936-8da8-4b1c-a47c-51c25702336e-headshot.png" },
  { username: "zenefrost", avatarUrl: "https://i.redd.it/snoovatar/avatars/f9e4f3e4-f48c-478a-8da3-66606fcc39cc-headshot.png" },
  { username: "D_perkilator", avatarUrl: "https://i.redd.it/snoovatar/avatars/3337fd42-b139-4cc6-9a0f-ce3ad889f649-headshot.png" },
  { username: "HexFalcon_KWT", avatarUrl: "https://i.redd.it/snoovatar/avatars/01e5e107-6755-4a45-8f51-268b58677ee0-headshot.png" },
  { username: "Genuine-Helperr", avatarUrl: "https://i.redd.it/snoovatar/avatars/9fddac9f-9436-421e-80e5-b7ea054e6835-headshot.png" },
  { username: "Disastrous_Math_412", avatarUrl: "https://i.redd.it/snoovatar/avatars/33a44bef-6fe2-49d4-af24-e8223411fe97-headshot.png" },
  { username: "TightFalcon6905", avatarUrl: "https://i.redd.it/snoovatar/avatars/31fd33dc-c767-438d-9a78-b8859f9d9b2a-headshot.png" },
];

export type PeopleCard = {
  title: string;
  caption: string;
  ask: string;
  shot: "leads" | "seo" | "competitors";
  tone: "pastel-pink" | "pastel-teal" | "pastel-mint";
};

/** Three windows into the product. Every ask is a saved post title. */
export const PEOPLE_CARDS: PeopleCard[] = [
  {
    title: "Leads",
    caption: "Every post and comment scored, with a written reason and the phrase that matched.",
    ask: "Looking for a simpler Jotform alternative",
    shot: "leads",
    tone: "pastel-pink",
  },
  {
    title: "Reddit SEO",
    caption: "The threads Google already ranks for your keywords, so one reply keeps working.",
    ask: "Which are the best online form builder and surveying tools?",
    shot: "seo",
    tone: "pastel-teal",
  },
  {
    title: "Competitors",
    caption: "Who gets recommended in the threads your leads sit in, and how each mention was meant.",
    ask: "Free typeform alternative?",
    shot: "competitors",
    tone: "pastel-mint",
  },
];
