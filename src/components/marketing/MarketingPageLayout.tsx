import { Check } from "lucide-react";
import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";
import { MarketingShowcase } from "./MarketingShowcase";
import { MarketingFeatures } from "./MarketingFeatures";
import { MarketingAnyapi } from "./MarketingAnyapi";
import { MotionPanel } from "./MotionPanel";
import { CtaRow } from "./CtaRow";
import { BrandStack, BrandWord } from "./BrandWord";
import type { Variant } from "./VariantSwitcher";
import "./marketing.css";
import "./below-fold.css";
import "./round-three.css";
import "./round-four.css";
import "./anyapi.css";

/** One feature story, with three reviewable hero compositions. */
export function MarketingPageLayout({ variant }: { variant: Variant }) {
  return (
    <main className={`marketing marketing-${variant}`}>
      <MotionPanel>
        <MarketingNav />
        <section className="hero-layout" aria-labelledby="marketing-title">
          <div className="hero-copy">
            <h1 id="marketing-title">
              Get your site into <BrandWord name="Google" />
              <br className="hero-break" /> and <BrandStack /> AI answers. Free.
            </h1>
            <p className="hero-description">
              <BrandWord name="Reddit" /> threads are what search and AI answers cite. lurk finds
              the ones about what you sell, scores who is asking, and tells you why. You reply.
            </p>
            <CtaRow />
            <div className="hero-promises">
              <span>
                <Check />
                Free, no card
              </span>
              <span>
                <Check />
                Never posts or DMs
              </span>
            </div>
          </div>
          <div className="hero-product">
            <p className="preview-caption">Preview built from real saved threads.</p>
            <MarketingShowcase />
          </div>
        </section>
      </MotionPanel>
      <div className="marketing-body">
        <MarketingFeatures />
        <MarketingAnyapi />
        <section className="closing-cta" data-proof="closing">
          <span className="closing-eyebrow">
            Good conversations start with listening
          </span>
          <h2>
            Find the ask.
            <br />
            Bring something useful.
          </h2>
          <CtaRow />
        </section>
        <MarketingFooter />
      </div>
    </main>
  );
}
