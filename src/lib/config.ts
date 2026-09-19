import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** An unset variable and one set to nothing mean the same thing in a .env file. */
const blankIsAbsent = (value: unknown) => (value === "" ? undefined : value);

const optional = <T extends z.ZodType>(inner: T) => z.preprocess(blankIsAbsent, inner.optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.preprocess(blankIsAbsent, z.url().default("http://localhost:3000")),
  APP_ENCRYPTION_KEY: z.string().min(1),
  SELF_HOSTED: z.preprocess(blankIsAbsent, bool),
  RUN_SCHEDULER: z.preprocess(blankIsAbsent, bool),

  ANYAPI_BASE_URL: z.preprocess(blankIsAbsent, z.url().default("https://api.getanyapi.com")),
  ANYAPI_OAUTH_CLIENT_ID: optional(z.string()),
  ANYAPI_HOUSE_API_KEY: optional(z.string()),

  OPENROUTER_API_KEY: optional(z.string()),
  OPENROUTER_MODEL: z.preprocess(
    blankIsAbsent,
    z.string().default("meta/muse-spark-1.3-contributor"),
  ),

  /**
   * TypeSafe's Jev judges every candidate the scan reads: through Vercel's AI
   * Gateway when its key is set, through OpenRouter when it is not or when the
   * Gateway fails. See src/lib/jev.ts.
   */
  AI_GATEWAY_API_KEY: optional(z.string()),
  JEV_GATEWAY_MODEL: z.preprocess(blankIsAbsent, z.string().default("typesafe-ai/jev")),
  JEV_MODEL: z.preprocess(blankIsAbsent, z.string().default("~typesafe/jev-latest")),

  /**
   * The digest email goes out through Azure Communication Services when its
   * connection string is set, otherwise through the SMTP server named here.
   */
  AZURE_EMAIL_CONNECTION_STRING: optional(z.string()),
  SMTP_URL: optional(z.string()),
  ALERTS_FROM_EMAIL: optional(z.email()),

  /** A Slack app with the incoming-webhook scope turns the paste-a-URL step into Add to Slack. */
  SLACK_CLIENT_ID: optional(z.string()),
  SLACK_CLIENT_SECRET: optional(z.string()),

  /**
   * How many jobs the scheduler runs at once. Three is a starting hypothesis,
   * not a tuned number: it keeps one slow scan from holding up the retention
   * and digest jobs, and stays well inside the ten-connection pool in
   * src/db/index.ts. Move it once real queue delay has been measured.
   */
  /**
   * Whether boot queues the jobs every project is missing. Production wants
   * that: it is how a project whose job died gets scanned again. A dev database
   * is shared and full of fixtures, and there it queued a discovery for each of
   * 213 test projects the first time anybody turned the scheduler on.
   */
  SCHEDULER_SEED: z.preprocess(
    blankIsAbsent,
    z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ),
  /**
   * "small" makes a new project cost a cent or two: a few Google queries, four
   * Reddit searches a page deep, 300 posts, and no SEO or competitor pass. It
   * is the real pipeline at a size for trying the signup flow over and over,
   * and it is ignored in production whatever it is set to.
   */
  SWEEP_SCALE: z.preprocess(blankIsAbsent, z.enum(["full", "small"]).default("full")),
  /** How many new-project setups and first sweeps run at once, on top of the routine workers. */
  SCHEDULER_WATCHED_WORKERS: z.coerce.number().int().positive().default(8),
  SCHEDULER_WORKERS: z.coerce.number().int().positive().default(3),

  /**
   * The shared pace for paid Reddit calls; see src/lib/reddit/pace.ts. In
   * flight is where a burst starts; per second is the token bucket every
   * call draws from. Both are the summed vendor budgets behind reddit.*
   * less headroom for a second job, measured 2026-09-17.
   */
  REDDIT_CALLS_IN_FLIGHT: z.coerce.number().int().positive().default(40),
  REDDIT_CALLS_PER_SECOND: z.coerce.number().positive().default(12),

  HOUSE_DATA_CAP_USD_PER_DAY: z.coerce.number().nonnegative().default(25),
  HOUSE_LLM_CAP_USD_PER_DAY: z.coerce.number().nonnegative().default(100),
});

export type Config = z.infer<typeof schema>;

/** Parsed process env. Throws when a required value is absent or malformed. */
export function config(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = Object.keys(z.flattenError(parsed.error).fieldErrors).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}
