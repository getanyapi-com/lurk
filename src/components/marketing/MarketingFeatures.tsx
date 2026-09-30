import { MarketingPeople } from "./MarketingPeople";
import { MarketingFree } from "./MarketingFree";
import { MarketingScanCollage } from "./MarketingScanCollage";
import { MarketingSeoTiles } from "./MarketingSeoTiles";
import { MarketingXTiles } from "./MarketingXTiles";
import { OpenSourcePanel } from "./OpenSourcePanel";
import { MarketingDecisionTiles } from "./MarketingDecisionTiles";

export function MarketingFeatures() {
  return (
    <>
      <MarketingPeople />
      <MarketingXTiles />
      <MarketingFree />
      <MarketingScanCollage />
      <MarketingSeoTiles />
      <OpenSourcePanel />
      <MarketingDecisionTiles />
    </>
  );
}
