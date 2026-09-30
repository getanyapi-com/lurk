"use client";
import { useState } from "react";
import { PillTabs } from "@/components/PillTabs";
import { AppMockLeads } from "./AppMockLeads";
import { AppMockSeo } from "./AppMockSeo";
import { AppMockCompetitors } from "./AppMockCompetitors";
import { AppMockX } from "./AppMockX";
import { BRAND_MARKS } from "./BrandWord";
const TABS = [
  { id: "leads", label: "Leads", mark: BRAND_MARKS.Reddit },
  { id: "x", label: "X leads", mark: BRAND_MARKS.X },
  { id: "seo", label: "Reddit SEO", mark: BRAND_MARKS.Reddit },
  { id: "competitors", label: "Competitors" },
];

export function MarketingShowcase() {
  const [tab, setTab] = useState("x");
  return (
    <div className="marketing-showcase">
      <PillTabs tabs={TABS} activeId={tab} onSelect={setTab} />
      <div
        role="tabpanel"
        aria-label={TABS.find((item) => item.id === tab)?.label}
        className="product-mat"
      >
        {tab === "leads" ? (
          <AppMockLeads />
        ) : tab === "x" ? (
          <AppMockX />
        ) : tab === "seo" ? (
          <AppMockSeo />
        ) : (
          <AppMockCompetitors />
        )}
      </div>
    </div>
  );
}
