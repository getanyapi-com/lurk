/**
 * Competitors are stored as names, and a name is only sometimes a domain. We
 * ask Google for a favicon only when the name really looks like a host, so a
 * product called "Typeform" shows its initials instead of a wrong icon.
 */
const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(?:[/?#].*)?$/;

export function competitorHost(name: string): string | null {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }
  return DOMAIN.exec(trimmed)?.[1] ?? null;
}

/**
 * The suffixes that are two labels long, so the label a brand actually owns in
 * "typeform.co.uk" is "typeform" and not "co". A short list, because it only
 * has to cover the suffixes a product is plausibly sold under.
 */
const TWO_LABEL_SUFFIX = new Set([
  "co.uk",
  "co.nz",
  "co.za",
  "co.jp",
  "co.in",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.tr",
  "org.uk",
  "net.au",
]);

/** The label a brand owns: typeform.com and app.typeform.com both give typeform. */
export function domainRoot(host: string): string {
  const labels = host.split(".");
  const suffix = labels.slice(-2).join(".");
  const take = TWO_LABEL_SUFFIX.has(suffix) ? 3 : 2;
  return labels.length >= take ? labels[labels.length - take] : labels[0];
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The site a competitor belongs to. A name that is already a domain is its own
 * answer; otherwise we look for a domain the same evidence named whose owned
 * label is that name with the punctuation taken out, which is how "Hotel
 * Tonight" finds hoteltonight.com without anyone asking a model. A name that
 * matches nothing gets no domain, and wears its initials.
 */
export function matchCompetitorDomain(name: string, domains: Iterable<string>): string | null {
  const own = competitorHost(name);
  if (own) {
    return own;
  }
  const wanted = slug(name);
  if (!wanted) {
    return null;
  }
  for (const candidate of domains) {
    const host = competitorHost(candidate);
    if (host && domainRoot(host) === wanted) {
      return host;
    }
  }
  return null;
}
