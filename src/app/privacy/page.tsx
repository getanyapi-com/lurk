import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Privacy Policy | ${PRODUCT_NAME}` };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 18, 2026"
      intro={
        <>
          {PRODUCT_NAME} (lurk.so) is operated by AnyAPI. This policy says what we collect when you use
          the hosted service, why, and who else handles it. Questions go to support@getanyapi.com.
        </>
      }
      sections={[
        {
          title: "What we collect",
          body: [
            "Account details: your email address and, if you sign in with Google, the name, email address and profile picture Google shares. We request only the basic profile scopes and never read your Gmail, Drive or contacts.",
            "What you give the product: the product URLs and descriptions you enter, the profile we build from them, your settings, the alert channels you add (email addresses, Slack and Discord webhooks), and what you do with leads.",
            "Usage data: pages viewed, actions taken, device and browser information, IP address, and error reports, so we can run and improve the service.",
            "If you connect an AnyAPI wallet, we store the encrypted access token that lets scans bill your own account. We never see your payment details.",
          ],
        },
        {
          title: "Public Reddit content",
          body: [
            "lurk reads public Reddit posts, comments and public author details to find conversations relevant to your product. This content is public, is stored only as long as it is useful for your leads, and is not combined with private data about those authors.",
          ],
        },
        {
          title: "How we use it",
          body: [
            "To provide the service: finding and scoring leads, sending the alerts you asked for, securing accounts, preventing abuse, and answering support requests. We do not sell personal data and we do not use it for advertising.",
          ],
        },
        {
          title: "Who handles it for us",
          body: [
            "Clerk (sign-in and accounts), Google (if you choose Google sign-in), Microsoft Azure (hosting, database and email delivery), PostHog (product analytics), AnyAPI (public web and Reddit data), and language-model providers that process product descriptions and public posts to score leads. Slack or Discord receive alerts only if you connect them. Each processes data only to provide its service to us.",
          ],
        },
        {
          title: "Retention and your choices",
          body: [
            "We keep account data while your account is open. Email support@getanyapi.com to access, correct, export or delete your data, or to close your account; we act on these requests within 30 days. You can remove an alert channel or disconnect a wallet or Slack at any time in settings.",
          ],
        },
        {
          title: "Cookies",
          body: [
            "We use cookies that keep you signed in and a first-party analytics cookie. We do not use advertising cookies.",
          ],
        },
        {
          title: "Changes",
          body: [
            "If this policy changes in a way that matters, we will update the date above and tell account holders by email.",
          ],
        },
      ]}
    />
  );
}
