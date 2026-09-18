import { ChevronRight } from "lucide-react";

export function EyebrowLink({
  href,
  children,
  pill = false,
  external = false,
}: {
  href: string;
  children: React.ReactNode;
  pill?: boolean;
  external?: boolean;
}) {
  return (
    <a
      className={`eyebrow-link${pill ? " eyebrow-pill" : ""}`}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
    >
      {children}
      <ChevronRight aria-hidden="true" />
    </a>
  );
}
