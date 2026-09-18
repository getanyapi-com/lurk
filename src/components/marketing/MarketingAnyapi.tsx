import { ArrowUpRight } from "lucide-react";
import { AnyapiMark } from "@/components/AnyapiMark";
import { ANYAPI_URL } from "@/lib/brand";
import { ANYAPI_PLATFORMS, ANYAPI_PRICES, ANYAPI_PRICES_OBSERVED } from "@/lib/anyapiCatalog";
import { BrandImage } from "./BrandImage";
import { EyebrowLink } from "./EyebrowLink";

type Platform = { name: string; src?: string; domain?: string };

/** A platform named in running text carries its mark, like BrandWord. */
function PlatformWord({ platform }: { platform: Platform }) {
  return (
    <span className="brand-word">
      <BrandImage name={platform.name} src={platform.src} domain={platform.domain} />
      {platform.name}
    </span>
  );
}

const named = (name: string) => ANYAPI_PLATFORMS.find((platform) => platform.name === name)!;

/** The data under lurk, sold as three product tiles in the same cut as Reddit SEO. */
export function MarketingAnyapi() {
  return (
    <section id="anyapi" className="anyapi-tiles" data-proof="anyapi">
      <header className="left-heading">
        <EyebrowLink href={ANYAPI_URL} external>
          <AnyapiMark size={16} />
          Data by AnyAPI
        </EyebrowLink>
        <h2>
          Need data from Reddit, TikTok or LinkedIn? <span>Use AnyAPI.</span>
        </h2>
        <p>
          Every thread lurk reads comes through <a href={ANYAPI_URL}>AnyAPI</a>. The same key
          reads <PlatformWord platform={named("TikTok")} />,{" "}
          <PlatformWord platform={named("Instagram")} />,{" "}
          <PlatformWord platform={named("YouTube")} />, <PlatformWord platform={named("X")} />,{" "}
          <PlatformWord platform={named("LinkedIn")} />,{" "}
          <PlatformWord platform={named("Google Maps")} /> and{" "}
          <PlatformWord platform={named("Amazon")} />, and about 70 more platforms, as clean JSON.
        </p>
      </header>
      <div className="three-up">
        <figure className="pastel-tile">
          <div className="pastel-art anyapi-art-platforms">
            <div className="seo-rows">
              {ANYAPI_PLATFORMS.slice(0, 4).map((platform) => (
                <div className="seo-row anyapi-platform" key={platform.name}>
                  <BrandImage
                    name={platform.name}
                    src={"src" in platform ? platform.src : undefined}
                    domain={"domain" in platform ? platform.domain : undefined}
                    size={20}
                  />
                  <span>
                    {platform.name}
                    <small>{platform.gets}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <figcaption>
            <strong>One key for every platform</strong> No scraper to run, no proxies to rent and
            no developer account on each site.
          </figcaption>
        </figure>
        <figure className="pastel-tile">
          <div className="pastel-art seo-art-table">
            <table className="seo-ledger">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>From / 1k req</th>
                </tr>
              </thead>
              <tbody>
                {ANYAPI_PRICES.map((row) => (
                  <tr key={row.endpoint}>
                    <td>
                      <BrandImage
                        name={row.name}
                        src={"src" in row ? row.src : undefined}
                        domain={"domain" in row ? row.domain : undefined}
                        size={16}
                      />
                      {row.endpoint}
                    </td>
                    <td>${row.per1k.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <figcaption>
            <strong>Pay per request</strong> In dollars, with no subscription, and a failed call
            costs nothing. Prices from the catalog on {ANYAPI_PRICES_OBSERVED}.
          </figcaption>
        </figure>
        <figure className="pastel-tile">
          <div className="pastel-art anyapi-art-trial">
            <div className="quiet-card anyapi-trial">
              <AnyapiMark size={28} />
              <strong>About 150 requests on the house</strong>
              <p>No card. Search the catalog, run a call, see the JSON.</p>
              <a className="marketing-button" href={ANYAPI_URL} target="_blank" rel="noopener">
                Get your AnyAPI key
                <ArrowUpRight />
              </a>
            </div>
          </div>
          <figcaption>
            <strong>Try it free</strong> The same wallet lurk runs on, for whatever you need to
            read next.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
