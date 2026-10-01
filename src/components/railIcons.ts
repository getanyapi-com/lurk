import { Bell, Box, Lightbulb, Radar, Receipt, Search, Settings, SlidersHorizontal, Swords, Telescope } from "lucide-react";
import { XMark } from "@/components/x/XMark";

/**
 * One icon per destination, so the rail reads at a glance. It has no directive
 * so the marketing page's mock rail, a server component, draws the same icons
 * as the app's own.
 */
export const RAIL_ICONS = {
  radar: Radar,
  search: Search,
  lightbulb: Lightbulb,
  swords: Swords,
  box: Box,
  telescope: Telescope,
  filters: SlidersHorizontal,
  bell: Bell,
  receipt: Receipt,
  settings: Settings,
  // X's brand mark, not an icon.
  x: XMark,
} as const;

export type RailIcon = keyof typeof RAIL_ICONS;
