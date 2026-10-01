import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import { ThemeScript } from "@/components/ThemeScript";
import { PRODUCT_NAME_WITH_PROVIDER, PRODUCT_URL } from "@/lib/brand";

const DESCRIPTION = "Monitor Reddit and X to find customers, get cited by AI, and rank on Google.";

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT_URL),
  title: PRODUCT_NAME_WITH_PROVIDER,
  description: DESCRIPTION,
  openGraph: {
    title: PRODUCT_NAME_WITH_PROVIDER,
    description: DESCRIPTION,
    url: PRODUCT_URL,
    siteName: PRODUCT_NAME_WITH_PROVIDER,
    type: "website",
  },
  // The large card, which takes its title, description and image from Open
  // Graph's: opengraph-image.png is the one share image.
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Signing in lands on the leads page itself: /app only redirects there, and
    // would draw the whole app layout, every read behind the rail included, first.
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      signInFallbackRedirectUrl="/app/leads"
      signUpFallbackRedirectUrl="/app/leads"
    >
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeScript />
        </head>
        <body>
          <PostHogIdentify />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
