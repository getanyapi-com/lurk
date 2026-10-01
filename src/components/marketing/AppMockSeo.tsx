import { SubredditChip } from "@/components/SubredditChip";
import { BrandImage } from "./BrandImage";
import { BRAND_MARKS } from "./BrandWord";
import { MockFrame } from "./MockFrame";
import { MockButton } from "./MockButton";
import { MOCK_SEO } from "./mockContent";

export function AppMockSeo() {
  return (
    <MockFrame
      active="Reddit SEO"
      title="Reddit SEO"
      actions={<MockButton label="Refresh now" tone="solid" />}
    >
      <div className="mock-content mock-seo">
        <div className="mock-section-title">
          <BrandImage name="Google" src={BRAND_MARKS.Google} size={24} />
          <span>
            free form builder<small>Saved Google results</small>
          </span>
        </div>
        <p className="mock-muted">
          Find the conversations people reach from search.
        </p>
        {MOCK_SEO.map((thread) => (
          <div className="mock-seo-row" key={thread.url}>
            <div className="mock-rank">
              <BrandImage name="Google" src={BRAND_MARKS.Google} size={18} />#
              {thread.position}
            </div>
            <div>
              <a href={thread.url} target="_blank" rel="noreferrer">
                {thread.title}
              </a>
              <div className="mock-identity">
                <SubredditChip name={thread.subreddit} iconUrl={thread.icon} />
                <small>Posted {thread.date}</small>
              </div>
              {thread.competitorPresent ? (
                <span className="competitor-flag">
                  <BrandImage name="Typeform" domain="typeform.com" size={14} />
                  Competitor named
                </span>
              ) : null}
            </div>
          </div>
        ))}
        <div className="mock-cost">
          <BrandImage name="AnyAPI" src="/anyapi-mark.svg" size={14} />
        </div>
      </div>
    </MockFrame>
  );
}
