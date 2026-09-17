import { BrandImage } from "./BrandImage";
import { MockFrame } from "./MockFrame";
import { MockButton } from "./MockButton";
import { MENTION_TALLY } from "./researchContent";

/** Competitors as they look in the product: who gets named, and how it was meant. */
export function AppMockCompetitors() {
  return (
    <MockFrame
      active="Competitors"
      title="Competitors"
      actions={<MockButton label="Rescan now" tone="solid" />}
    >
      <div className="mock-content mock-competitors">
        <p className="mock-muted">
          Who gets recommended in the threads your leads sit in, over the last 30 days.
        </p>
        {MENTION_TALLY.competitors.map((product) => (
          <div className="mock-competitor-row" key={product.name}>
            <BrandImage name={product.name} domain={product.domain} size={20} />
            <span>{product.name}</span>
            <small>
              {product.mentions} mention{product.mentions === 1 ? "" : "s"}
            </small>
          </div>
        ))}
        <div className="mock-competitor-foot">
          <small>
            {MENTION_TALLY.total} mentions read, {MENTION_TALLY.negative} negative
          </small>
        </div>
        <div className="mock-cost">
          <BrandImage name="AnyAPI" src="/anyapi-mark.svg" size={14} />
        </div>
      </div>
    </MockFrame>
  );
}
