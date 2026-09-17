import { Bell, Box, Lightbulb, Radar, Receipt, Search, Settings, Swords } from "lucide-react";
import type { RailIcon } from "@/components/Rail";
import { BrandImage } from "./BrandImage";
import { MOCK_RAIL } from "./mockContent";

const ICONS: Record<RailIcon, React.ComponentType<{ className?: string }>> = {
  radar: Radar,
  search: Search,
  lightbulb: Lightbulb,
  swords: Swords,
  box: Box,
  bell: Bell,
  receipt: Receipt,
  settings: Settings,
};
type MockFrameProps = {
  active: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

/** A fitted 16:10 product window. Container units keep the whole screen in frame. */
export function MockFrame({ active, title, actions, children }: MockFrameProps) {
  return (
    <div className="mock-frame" aria-label={`${title} product preview`}>
      <div className="mock-screen">
        <aside className="mock-rail">
          <div className="mock-project">
            <BrandImage name="Tally" domain="tally.so" size={24} />
            <span>
              Tally<small>Saved example project</small>
            </span>
          </div>
          {MOCK_RAIL.map((group) => (
            <div className="mock-rail-group" key={group.label}>
              <small>{group.label}</small>
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                return (
                  <span
                    key={item.name}
                    className={
                      item.name === active ? "mock-destination selected" : "mock-destination"
                    }
                  >
                    <Icon />
                    {item.name}
                  </span>
                );
              })}
            </div>
          ))}
          <span className="mock-rail-bottom">
            <BrandImage name="AnyAPI" src="/anyapi-mark.svg" size={18} /> Data by AnyAPI
          </span>
        </aside>
        <div className="mock-main">
          <div className="mock-topbar">
            <span>{title}</span>
            <div>{actions}</div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
