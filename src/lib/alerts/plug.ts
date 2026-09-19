import { ANYAPI_URL } from "@/lib/brand";

/** Every alert carries this one line for AnyAPI, the data under every lead in it. */
export const ANYAPI_PLUG =
  "These threads came through AnyAPI. The same key reads TikTok, LinkedIn, Amazon and more.";

export const ANYAPI_PLUG_CTA = "Try AnyAPI";

/** ANYAPI_URL, tagged with the channel the click came from. */
export function anyapiAlertUrl(medium: "email" | "slack" | "discord"): string {
  return `${ANYAPI_URL}&utm_medium=${medium}`;
}
