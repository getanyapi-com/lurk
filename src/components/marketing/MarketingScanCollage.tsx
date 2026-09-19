"use client";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUp, ExternalLink, EyeOff, MessageCircle, Search, ShieldCheck, ThumbsDown } from "lucide-react";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { VerdictBadge } from "@/components/VerdictBadge";
import { AppMockLeads } from "./AppMockLeads";
import { SCAN_LEAD, SCAN_LEAD_FACTS } from "./mockContent";

const ACTIONS = [
  ["Open on Reddit", ExternalLink],
  ["Hide", EyeOff],
  ["Not a fit", ThumbsDown],
] as const;

/** A search, the product window behind it, and the lead card in front: the Aside memory collage. */
export function MarketingScanCollage() {
  const reduced = useReducedMotion();
  const enter = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.2 },
    transition: { duration: reduced ? 0 : 0.55, delay: reduced ? 0 : delay, ease: "easeOut" as const },
  });
  const [before, after] = SCAN_LEAD.body.split(SCAN_LEAD.matchedPhrase);
  return (
    <section id="features" className="scan-collage" data-proof="scan">
      <header className="left-heading">
        <h2>
          <span>Scans</span> that read the whole thread.
        </h2>
        <p>
          Every keyword and community is searched on a schedule. Titles are filtered first,
          then the shortlisted posts and comments are read in full and scored with a written
          reason and the exact phrase that matched your product.
        </p>
      </header>
      <div className="collage">
        <motion.div className="collage-ask" {...enter(0)}>
          <Search />
          <span>
            ai form builder
            <small>reddit.search, sorted new, then r/nocode and r/GPT</small>
          </span>
        </motion.div>
        <motion.div className="collage-window" {...enter(0.25)} aria-hidden="true">
          <AppMockLeads />
        </motion.div>
        <motion.article className="collage-card" {...enter(0.6)}>
          <div className="collage-main">
            <div className="mock-identity">
              <AuthorAvatar name={SCAN_LEAD.author} src={SCAN_LEAD.avatar} size={28} />
              <span>u/{SCAN_LEAD.author}</span>
              <small>r/{SCAN_LEAD.subreddit}</small>
              <small>{SCAN_LEAD_FACTS.age}</small>
              <VerdictBadge fit={SCAN_LEAD.fit} intent={SCAN_LEAD.intent} className="ml-auto" />
            </div>
            <a className="fragment-subject" href={SCAN_LEAD.url} target="_blank" rel="noreferrer">
              {SCAN_LEAD.title}
            </a>
            <span className="mock-meta">
              in r/{SCAN_LEAD.subreddit} - {SCAN_LEAD.stage}
            </span>
            <p className="mock-reason">{SCAN_LEAD.reason}</p>
            <p className="collage-body">
              {before}
              <mark>{SCAN_LEAD.matchedPhrase}</mark>
              {after}
            </p>
            <dl className="collage-metrics">
              <div>
                <dt>Fit</dt>
                <dd>{SCAN_LEAD.fit}</dd>
              </div>
              <div>
                <dt>Intent</dt>
                <dd>{SCAN_LEAD.intent}</dd>
              </div>
              <div>
                <dt>Engagement</dt>
                <dd>{SCAN_LEAD_FACTS.engagement}</dd>
              </div>
            </dl>
            <div className="collage-foot">
              <span>
                <ArrowUp size={13} />
                {SCAN_LEAD_FACTS.points}
              </span>
              <span>
                <MessageCircle size={13} />
                {SCAN_LEAD_FACTS.comments}
              </span>
              <span>
                <ShieldCheck size={13} />
                {SCAN_LEAD.promoRule}
              </span>
            </div>
          </div>
          <div className="collage-actions" aria-hidden="true">
            {ACTIONS.map(([label, Icon]) => (
              <span key={label}>
                <Icon size={13} />
                {label}
              </span>
            ))}
          </div>
        </motion.article>
      </div>
    </section>
  );
}
