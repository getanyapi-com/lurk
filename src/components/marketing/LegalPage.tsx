import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export type LegalSection = { title: string; body: React.ReactNode[] };

/** The plain reading page the privacy policy and the terms share. */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-sm leading-6">
      <Wordmark homeHref="/" />
      <h1 className="mt-10 text-2xl font-semibold">{title}</h1>
      <p className="mt-1 opacity-60">Last updated {updated}</p>
      <p className="mt-6">{intro}</p>
      {sections.map((section) => (
        <section key={section.title} className="mt-8">
          <h2 className="text-base font-semibold">{section.title}</h2>
          {section.body.map((paragraph, index) => (
            <p key={index} className="mt-3">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      <p className="mt-12 opacity-60">
        <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> ·{" "}
        <a href="mailto:support@getanyapi.com">support@getanyapi.com</a>
      </p>
    </main>
  );
}
