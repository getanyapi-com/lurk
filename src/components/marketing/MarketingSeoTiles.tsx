import { Check, Search, X } from "lucide-react";
import { SubredditChip } from "@/components/SubredditChip";
import { BrandImage } from "./BrandImage";
import { BrandWord } from "./BrandWord";
import { EyebrowLink } from "./EyebrowLink";
import { MOCK_SEO } from "./mockContent";
import { SEO_THREADS } from "./researchContent";

type LedgerRow = {
  url: string;
  subreddit: string;
  competitorPresent: boolean;
  competitor?: string;
  domain?: string;
};
const LEDGER: LedgerRow[] = [...SEO_THREADS, ...MOCK_SEO];

/** Reddit SEO as three product tiles, each cropped a different way. */
export function MarketingSeoTiles() {
  return (
    <section id="seo" className="seo-tiles" data-proof="seo">
      <header className="left-heading">
        <EyebrowLink href="#decide">
          <BrandWord name="Reddit" /> SEO
        </EyebrowLink>
        <h2>A reply can outlive the day you write it.</h2>
        <p>
          <BrandWord name="Google" /> already ranks <BrandWord name="Reddit" /> threads for what
          you sell, and <BrandWord name="Google AI Overviews" />, <BrandWord name="ChatGPT" /> and{" "}
          <BrandWord name="Perplexity" /> cite the same threads when they answer.
          <br />
          lurk finds them, saves the position, and shows which ones name a competitor.
        </p>
      </header>
      <div className="three-up">
        <figure className="pastel-tile">
          <div className="pastel-art seo-art-google">
            <div className="google-card">
              <div className="google-query">
                <BrandImage name="Google" src="/brands/google.svg" size={24} />
                <span>{SEO_THREADS[0].keyword}</span>
                <Search size={16} />
              </div>
              {SEO_THREADS.map((row) => (
                <div className="google-hit" key={row.url}>
                  <BrandImage name="Reddit" src="/brands/reddit.svg" size={20} />
                  <span>
                    Reddit / r/{row.subreddit}
                    <strong>{row.title}</strong>
                  </span>
                  <em>#{row.position}</em>
                </div>
              ))}
            </div>
          </div>
          <figcaption>
            <strong>Ranked threads</strong> Your keywords, searched on{" "}
            <BrandWord name="Google" />, filtered to the <BrandWord name="Reddit" /> discussions
            that already rank.
          </figcaption>
        </figure>
        <figure className="pastel-tile">
          <div className="pastel-art seo-art-rows">
            <div className="seo-rows">
              {MOCK_SEO.map((row) => (
                <div className="seo-row" key={row.url}>
                  <em>#{row.position}</em>
                  <span>
                    {row.title}
                    <SubredditChip name={row.subreddit} iconUrl={row.icon} />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <figcaption>
            <strong>Position, age, comments</strong> Saved at the time it was observed, so you
            can see which threads are still alive.
          </figcaption>
        </figure>
        <figure className="pastel-tile">
          <div className="pastel-art seo-art-table">
            <table className="seo-ledger">
              <thead>
                <tr>
                  <th>Thread</th>
                  <th>Competitor</th>
                  <th aria-label="Named" />
                </tr>
              </thead>
              <tbody>
                {LEDGER.map((row) => (
                  <tr key={row.url}>
                    <td>r/{row.subreddit}</td>
                    <td>
                      {row.competitor ? (
                        <>
                          <BrandImage name={row.competitor} domain={row.domain} size={16} />
                          {row.competitor}
                        </>
                      ) : row.competitorPresent ? (
                        "Named in thread"
                      ) : (
                        "None named"
                      )}
                    </td>
                    <td>
                      {row.competitorPresent ? (
                        <Check className="ledger-yes" size={16} />
                      ) : (
                        <X className="ledger-no" size={16} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <figcaption>
            <strong>Competitor named</strong> A thread that already compares tools is where
            a careful answer is welcome.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
