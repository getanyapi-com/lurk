import { Mail, MessageSquare, Quote, ShieldCheck, Tags, Webhook } from "lucide-react";
import { BrandImage } from "./BrandImage";
import { EyebrowLink } from "./EyebrowLink";
import { ALERT_THREAD, MOCK_DETAIL, RULE_THREAD } from "./mockContent";
import { MENTION_TALLY, SAVED_THEMES } from "./researchContent";
import { ThreadIdentity } from "./ThreadIdentity";

/** Four quiet tiles: what lurk puts in front of you before you decide to reply. */
export function MarketingDecisionTiles() {
  return (
    <section className="decision-section" id="decide" data-proof="reply">
      <header className="centered-heading">
        <EyebrowLink href="#costs">Your reply, your decision</EyebrowLink>
        <h2>Context first. Nothing sends.</h2>
        <p>
          The community rule, the reason it scored and what keeps coming up, all in front of
          you before you type a word. lurk never posts or DMs on your behalf.
        </p>
      </header>
      <div className="four-up">
        <figure>
          <div className="quiet-tile">
            <div className="quiet-card quiet-rule">
              <ThreadIdentity thread={RULE_THREAD} />
              <strong>{RULE_THREAD.title}</strong>
              <div className="policy-line">
                <ShieldCheck />
                <span>
                  r/{RULE_THREAD.subreddit}: contribute value
                  <small>No blatant self-promotion without giving value back.</small>
                </span>
              </div>
            </div>
          </div>
          <figcaption>
            <strong>The rule on the lead</strong> Each community&apos;s promotion policy, read
            from its sidebar, sits next to the post.
          </figcaption>
        </figure>
        <figure>
          <div className="quiet-tile">
            <div className="quiet-card quiet-reason">
              <ThreadIdentity thread={MOCK_DETAIL} />
              <strong>{MOCK_DETAIL.title}</strong>
              <div className="policy-line">
                <Quote />
                <span>
                  {MOCK_DETAIL.stage}
                  <small>{MOCK_DETAIL.reason}</small>
                </span>
              </div>
              <p>&ldquo;{MOCK_DETAIL.matchedPhrase}&rdquo;</p>
            </div>
          </div>
          <figcaption>
            <strong>Why it scored</strong> The stage they are at, one sentence of reasoning,
            and the exact words that matched.
          </figcaption>
        </figure>
        <figure>
          <div className="quiet-tile">
            <div className="quiet-card quiet-digest">
              <div className="quiet-channels">
                <span>
                  <BrandImage name="Slack" src="/brands/slack-color.svg" size={18} />
                  Slack
                </span>
                <span>
                  <BrandImage name="Discord" src="/brands/discord.svg" size={18} />
                  Discord
                </span>
                <span>
                  <Mail size={16} />
                  Email
                </span>
                <span>
                  <Webhook size={16} />
                  Webhook
                </span>
              </div>
              <div className="quiet-message">
                <ThreadIdentity thread={ALERT_THREAD} />
                <strong>{ALERT_THREAD.title}</strong>
                <small>New lead, 2 minutes ago</small>
              </div>
            </div>
          </div>
          <figcaption>
            <strong>The digest comes to you</strong> New leads to Slack, Discord, email or a
            webhook, with the score, reason and link.
          </figcaption>
        </figure>
        <figure>
          <div className="quiet-tile">
            <div className="quiet-card quiet-themes">
              <div className="quiet-label">
                <Tags size={14} />
                Pain themes
              </div>
              {SAVED_THEMES.map((theme) => (
                <span className="quiet-theme" key={theme.label}>
                  {theme.label}
                  <small>
                    {theme.leads} lead{theme.leads === 1 ? "" : "s"}
                  </small>
                </span>
              ))}
              <div className="quiet-label">
                <MessageSquare size={14} />
                Competitor mentions
              </div>
              <div className="quiet-tally">
                {MENTION_TALLY.competitors.map((product) => (
                  <span key={product.name}>
                    <BrandImage name={product.name} domain={product.domain} size={16} />
                    {product.mentions}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <figcaption>
            <strong>What keeps coming up</strong> Themes across your saved leads, and who gets
            named when people compare tools.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
