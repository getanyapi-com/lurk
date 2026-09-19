import { Mail, Webhook } from "lucide-react";
import type { AlertChannel } from "@/lib/alerts/types";
import { cn } from "@/lib/utils";

type ChannelMarkProps = { channel: AlertChannel; size?: number; className?: string };

/** Slack and Discord in their own brand art; email and a plain webhook have none, so a line icon. */
export function ChannelMark({ channel, size = 16, className }: ChannelMarkProps) {
  if (channel === "slack" || channel === "discord") {
    return (
      // Brand art from public/brands; no image proxy needed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/brands/${channel}.svg`}
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
