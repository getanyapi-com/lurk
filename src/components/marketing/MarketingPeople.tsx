import { PRODUCT_NAME } from "@/lib/brand";
import { AppMockLeads } from "./AppMockLeads";
import { AppMockSeo } from "./AppMockSeo";
import { AppMockCompetitors } from "./AppMockCompetitors";
import { EyebrowLink } from "./EyebrowLink";
import { PeopleWall } from "./PeopleWall";
import { PEOPLE_CARDS } from "./peopleContent";

const SHOTS = { leads: AppMockLeads, seo: AppMockSeo, competitors: AppMockCompetitors } as const;

/** The people behind the leads, then three small windows into the product. */
export function MarketingPeople() {
  return (
    <section className="people-section" id="people" data-proof="people">
      <header className="centered-heading">
        <EyebrowLink href="#features">Every lead is a person</EyebrowLink>
        <h2>
          Real people, asking in public,
          <br />
          for what you sell.
        </h2>
      </header>
      <PeopleWall />
      <p className="people-intro">
        Unlike a keyword alert, {PRODUCT_NAME} reads the whole post and the community
        rules before it calls something a lead. You see who asked, why it matched, and
        what the community allows - then you decide whether to join the conversation.
      </p>
      <div className="three-up people-cards">
        {PEOPLE_CARDS.map((card) => {
          const Shot = SHOTS[card.shot];
          return (
            <figure className="pastel-tile" key={card.title}>
              <div className={`pastel-art people-art ${card.tone}`}>
                <div className="people-ask">{card.ask}</div>
                <div className="people-shot" aria-hidden="true">
                  <Shot />
                </div>
              </div>
              <figcaption>
                <strong>{card.title}</strong> {card.caption}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
