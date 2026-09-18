import Link from "next/link";
import { AnyapiLink } from "@/components/AnyapiLink";
import { Wordmark } from "@/components/Wordmark";
import { BrandWord } from "./BrandWord";

const COLUMNS: { title: string; links: [React.ReactNode, string, string][] }[] = [
  {
    title: "Discover",
    links: [
      ["Leads", "#features", "leads"],
      [<BrandWord name="Reddit" label="Reddit SEO" key="seo" />, "#seo", "seo"],
      ["Competitors", "#decide", "competitors"],
    ],
  },
  {
    title: "Understand",
    links: [
      ["Scores and reasons", "#features", "scores"],
      ["Community rules", "#decide", "rules"],
      ["Insights", "#decide", "insights"],
    ],
  },
  {
    title: "Your workflow",
    links: [
      ["Why it scored", "#decide", "reason"],
      ["Alerts", "#decide", "alerts"],
      ["Data costs", "#costs", "costs"],
    ],
  },
  {
    title: "Build with it",
    links: [
      ["REST schema", "/openapi.json", "schema"],
      ["MCP agent guide", "/agent-guide.md", "guide"],
      ["Self-host", "#self-host", "self-host"],
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="marketing-footer" data-proof="footer">
      <nav className="footer-columns" aria-label="Footer">
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <span>{column.title}</span>
            {column.links.map(([label, href, key]) => (
              <a key={key} href={href}>
                {label}
              </a>
            ))}
          </div>
        ))}
        <div>
          <span>Get started</span>
          <a href="https://github.com/getanyapi-com/lurk">GitHub / at launch</a>
          <Link href="/sign-up">Hosted free</Link>
          <AnyapiLink />
          <a href="mailto:support@getanyapi.com">Contact</a>
        </div>
      </nav>
      <div className="footer-bottom">
        <Wordmark homeHref="/" />
        <span>MIT licensed. Built on public conversations.</span>
      </div>
    </footer>
  );
}
