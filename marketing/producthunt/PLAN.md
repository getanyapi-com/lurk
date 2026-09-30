# lurk on Product Hunt — launch plan

## The idea everything hangs on

The FOMO is the product's actual premise, not a countdown timer: **someone asked for a tool like
yours a few hours ago, and a competitor may already have replied.** X posts get half their
engagement in about 52 minutes, Reddit threads in about 2.5 hours. Every graphic shows real
lead cards with real ages ("3h", "found 36m later") so the viewer does the math themselves.

No fake scarcity, no "limited spots", no rocket emoji.

## Listing text

- **Name:** lurk
- **Tagline (45/60):** Free Reddit & X leads monitoring, open source
- **Description (242/260):**
  lurk watches Reddit and X for people asking for a product like yours, scores each post with
  a one-line reason, and sends new ones to email, Slack, Discord or a webhook. Also finds the
  Reddit threads Google ranks for you. Free and open source.
- **Topics:** Sales, Marketing, Open Source, Social Media Marketing
- **Links:** lurk.so, github.com/getanyapi-com/lurk

### Maker's first comment (draft — fill the [brackets] with true things only)

> Hey Product Hunt, Kevin here.
>
> [Real story: the one customer/lead you got from replying to a Reddit or X post early.]
>
> The pattern is always the same. Someone posts "is there an alternative to Calendly that
> just does round-robin?" The first two or three people who reply with something useful get
> the click. By the next morning the thread is done.
>
> I kept refreshing searches to catch those, so I built lurk. You paste your URL, it works out
> who buys and where they post, then watches Reddit and X and tells you, in one sentence, why
> each post is worth your time. New ones go to your inbox, Slack or Discord.
>
> A few things I care about:
> - It's free. There's no plan to buy. If you want hourly scans you connect your own AnyAPI
>   wallet and pay the few cents the data costs.
> - It's MIT-licensed. `docker compose up` and there are no limits at all.
> - It never posts or drafts replies for you. It finds the conversation; the words are yours.
>
> X is new as of today and is deliberately strict: expect a handful of leads a week, not a
> firehose. [Only claim this if X_LEADS is on for everyone on launch day.]
>
> I'd love to hear what it finds for your product, including the bad ones.

## Gallery (1270×760, 7 slides)

Same visual language as the README banner: warm off-white, the app's own typeface, black
headline with one word in brand colour (Reddit orange, X black), real UI at 2x. No gradients
on text, no glassmorphism, no stock icons, no emoji.

| # | Headline | Visual |
|---|---|---|
| 1 | Someone asked for your product 3 hours ago. / sub: Free Reddit & X leads monitoring | Three real lead cards fanned (2 Reddit, 1 X), ages visible |
| 2 | Reddit and X, in one place. | Reddit feed and X feed side by side, left/right, same product |
| 3 | Every lead comes with a reason. | Crop of the detail pane: "Why this is a lead" + highlighted quote |
| 4 | New leads go wherever you already are. | Real email digest, Slack message and Discord post, stacked |
| 5 | The Reddit threads Google already ranks for you. | Reddit SEO table: position, thread age, competitor named |
| 6 | Free. There's no plan to buy. | Three columns: Hosted free / Your AnyAPI wallet / Self-host (no limits) |
| 7 | Open source, MIT. | Terminal: `git clone … && docker compose up`, GitHub star count |

**Thumbnail (240×240):** the lurk wordmark on off-white; optional GIF where the timeline dots
fill in one by one.

**Optional 30–40 s video:** a real scan: paste URL → profile builds → first lead lands in
~26 s (the PR #102 number) → Slack ping. Built with hyperframes from screen captures.

## How the graphics get made (so they don't look generated)

1. Each slide is an HTML page in a throwaway route that renders the real marketing mock
   components (`MockLeadCard`, `AppMockSeo`, …) and the X tab from the x-lead-gen-module
   worktree, fed with real prod leads (with consent-safe public posts only).
2. Screenshot at 2540×1520 with Aside repl, export PNG.
3. Nothing is committed; assets live in `.context/producthunt/`.

## Before launch day

- [ ] X_LEADS on for everyone in prod (tagline claims X). Otherwise drop "& X".
- [ ] Pick real leads for the slides; blur or swap handles if the poster wouldn't want it.
- [ ] Launch Wednesday, 12:01 am PT. Tell people the day before, not a "please upvote" blast.
- [ ] Reply to every comment within the hour (same rule as the product).
- [ ] lurk.so hero and OG image match slide 1 on the day.
- No launch-day extras (no free hourly scans for PH signups).
