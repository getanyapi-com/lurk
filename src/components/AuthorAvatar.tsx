import { Avatar } from "@/components/Avatar";
import { redditAvatar } from "@/lib/redditAvatar";

type AuthorAvatarProps = {
  name: string | null;
  src?: string | null;
  size?: number;
};

/** An author's face with the Reddit mark on its corner, the way a feed shows it. */
export function AuthorAvatar({ name, src, size = 28 }: AuthorAvatarProps) {
  const badge = Math.round(size / 2);
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
