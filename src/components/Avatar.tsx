import { cn } from "@/lib/utils";

type AvatarProps = {
  name: string | null;
  src?: string | null;
  /**
   * A side in pixels, or `fluid` to fill whatever box it is put in. The people
   * strip sizes its faces off the card's width, so the whole window fits it.
   */
  size?: number | "fluid";
  className?: string;
};

function initials(name: string | null): string {
  const cleaned = (name ?? "").replace(/[^a-z0-9]/gi, "");
  return cleaned ? cleaned.slice(0, 2).toUpperCase() : "?";
}

/** A round face, or the first two letters of a name when there is no picture. */
export function Avatar({ name, src, size = 28, className }: AvatarProps) {
  const fluid = size === "fluid";
  const box = fluid ? undefined : { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return (
    <span
      className={cn(
        // Block when it fills its box: an inline face leaves a descender's worth
        // of space under it, and the box it was given stopped being square.
        fluid ? "flex" : "inline-flex",
        "shrink-0 items-center justify-center overflow-hidden rounded-full border bg-surface-2 text-fg-muted",
        // Initials are rare and the box is small: 0.62em of the body size lands
        // where the pixel sizes put them, without measuring the box.
        fluid && "size-full text-[0.62em]",
        className,
      )}
      style={box}
    >
      {src ? (
        // Reddit serves avatars from several CDN hosts we do not control.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={fluid ? undefined : size}
          height={fluid ? undefined : size}
          className="size-full object-cover"
        />
      ) : (
        <span style={{ fontWeight: 500 }}>{initials(name)}</span>
      )}
    </span>
  );
}
