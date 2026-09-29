import { Avatar } from "@/components/Avatar";
import { redditAvatar } from "@/lib/redditAvatar";

type AuthorAvatarProps = {
  name: string | null;
  src?: string | null;
  size?: number;
  /** Whose mark sits on the corner. Reddit unless the face is from X. */
  platform?: "reddit" | "x";
};

/**
 * An author's face with its platform's mark on the corner, the way a feed
 * shows it. A Reddit face with no picture is Reddit's own default; an X face
 * with none is its initials, since X's default egg is no one's.
 */
export function AuthorAvatar({ name, src, size = 28, platform = "reddit" }: AuthorAvatarProps) {
  const badge = Math.round(size / 2);
  if (platform === "x") {
    return (
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        <Avatar name={name} src={src ?? null} size={size} />
        {/* X's mark is brand art on its own white disc, like Reddit's. */}
        <span
          className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full bg-white ring-1 ring-black/10"
          style={{ width: badge, height: badge }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brands/x.svg" alt="X" width={Math.round(badge * 0.62)} height={Math.round(badge * 0.62)} />
        </span>
      </span>
    );
  }
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <Avatar name={name} src={redditAvatar(name, src)} size={size} />
      {/* The Reddit mark is brand art, not a themed surface. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brands/reddit.svg"
        alt="Reddit"
        width={badge}
        height={badge}
        className="absolute -right-0.5 -bottom-0.5 rounded-full"
      />
    </span>
  );
}
