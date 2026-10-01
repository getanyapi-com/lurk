import { ChevronRight } from "lucide-react";

export function EyebrowLink({
  href,
  children,
  external = false,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  return (
    <a
      className="eyebrow-link"
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
    >
      {children}
      <ChevronRight aria-hidden="true" />
    </a>
  );
}
