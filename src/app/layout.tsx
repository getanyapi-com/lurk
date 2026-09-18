import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { PostHogIdentify } from "@/components/PostHogIdentify";
import { ThemeScript } from "@/components/ThemeScript";
import { PRODUCT_NAME_WITH_PROVIDER, PRODUCT_URL } from "@/lib/brand";

const DESCRIPTION = "Find Reddit buyer intent and see what every lead's data cost.";

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      signInFallbackRedirectUrl="/app"
      signUpFallbackRedirectUrl="/app"
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
