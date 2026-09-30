import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/brand";
import { AnyapiLink } from "./AnyapiLink";

/** lurk's own mark, the speech bubble with eyes, from public/lurk-mark.svg. */
function LurkMark() {
  // A fixed local SVG; no image proxy needed.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/lurk-mark.svg" alt="" width={20} height={20} className="shrink-0" />;
}

type WordmarkProps = { homeHref?: string };

/**
 * "[mark] <Product> by [mark] AnyAPI" - the only place the product is named in chrome.
 * The product half goes home and the AnyAPI half goes out, as two links side by
 * side, because one link cannot hold another.
 */
export function Wordmark({ homeHref }: WordmarkProps) {
  return (
    <span className="wordmark flex items-center gap-1.5 text-fg" style={{ fontWeight: 500 }}>
      {homeHref ? (
        <Link href={homeHref} aria-label={`${PRODUCT_NAME} home`} className="flex items-center gap-1.5">
          <LurkMark />
          {PRODUCT_NAME}
        </Link>
      ) : (
        <>
          <LurkMark />
          {PRODUCT_NAME}
        </>
      )}
      <span className="text-fg-muted">by</span>
      <AnyapiLink />
    </span>
  );
}
