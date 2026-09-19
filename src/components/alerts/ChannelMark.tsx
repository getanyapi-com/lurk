import { Mail, Webhook } from "lucide-react";
import type { AlertChannel } from "@/lib/alerts/types";
import { cn } from "@/lib/utils";

/** A new name when the art changes: a browser holding the old file never asks again. */
const BRAND_ART = { slack: "/brands/slack-color.svg", discord: "/brands/discord.svg" } as const;

type ChannelMarkProps = {
  channel: AlertChannel;
  size?: number;
  className?: string;
  /**
   * One flat colour, the text's, instead of the brand's. Greyscaling Slack's
   * four colours gives four different greys, which reads as a smudge.
   */
  mono?: boolean;
};

/** Slack and Discord in their own brand art; email and a plain webhook have none, so a line icon. */
export function ChannelMark({ channel, size = 16, className, mono = false }: ChannelMarkProps) {
  if ((channel === "slack" || channel === "discord") && mono) {
    const mask = `url(${BRAND_ART[channel]}) center / contain no-repeat`;
    return (
      <span
        aria-hidden="true"
        className={cn("inline-block shrink-0 bg-current text-fg-muted", className)}
        style={{ width: size, height: size, mask, WebkitMask: mask }}
      />
    );
  }
  if (channel === "slack" || channel === "discord") {
    return (
      // Brand art from public/brands; no image proxy needed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={BRAND_ART[channel]}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0", className)}
      />
    );
  }
  const Icon = channel === "email" ? Mail : Webhook;
  return (
    <Icon
      className={cn("shrink-0 text-fg-muted", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
