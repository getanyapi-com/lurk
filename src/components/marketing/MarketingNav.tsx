import Link from "next/link";
import { AnyapiLink } from "@/components/AnyapiLink";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/components/ThemeToggle";

export function MarketingNav() {
  return (
    <header className="marketing-nav">
      <Wordmark homeHref="/" />
      <nav aria-label="Main navigation">
        <a href="#features">Features</a>
        <a href="#costs">Data costs</a>
        <a href="#self-host">Self-host</a>
        <AnyapiLink mark={false} />
      </nav>
      <div className="nav-actions">
        <ThemeToggle />
        <Link className="marketing-button" href="/sign-up">
          Start free
        </Link>
      </div>
    </header>
  );
}
