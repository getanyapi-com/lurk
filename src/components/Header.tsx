import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "./ThemeToggle";
import { Wordmark } from "./Wordmark";

/**
 * App header: wordmark on the left, theme toggle and account on the right. It
 * stays at the top of the window, because the rail below it is pinned to its
 * lower edge and a header that scrolled away would leave the rail floating.
 */
export function Header() {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between border-b bg-bg px-6"
      style={{ height: "var(--header-height)" }}
    >
      <Wordmark homeHref="/app" />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserButton />
      </div>
    </header>
  );
}
