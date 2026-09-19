import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";
import { PRODUCT_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: `Terms of Service | ${PRODUCT_NAME}` };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="September 18, 2026"
      intro={
        <>
          These terms cover the hosted {PRODUCT_NAME} service at lurk.so, operated by AnyAPI. By creating
          an account you agree to them. The open-source code is covered separately by its MIT license.
        </>
      }
      sections={[
        {
          title: "Your account",
          body: [
            "You must give a real email address you control and keep your sign-in secure. One person or company may not open multiple accounts to get around free-tier limits. You are responsible for what happens under your account.",
          ],
        },
        {
          title: "Acceptable use",
          body: [
            "Do not use lurk to spam, harass or deceive people, to break Reddit's rules or any community's rules, to send alerts to addresses or webhooks you do not control, to probe or overload the service, or to resell access to it. How you reply to a lead is your responsibility; follow each community's rules on self-promotion.",
          ],
        },
        {
          title: "Free tier and connected wallets",
          body: [
            "The free tier is provided within limits we set and may change. If you connect an AnyAPI wallet, the data requests your scans make are billed to that wallet under AnyAPI's terms at getanyapi.com/terms.",
          ],
        },
        {
          title: "Suspension",
          body: [
            "We may limit, suspend or close accounts that abuse the service, put it at risk, or break these terms. You can stop using the service and ask us to delete your account at any time.",
          ],
        },
        {
          title: "No warranty",
          body: [
            "The service is provided as is. Leads, scores and summaries are generated automatically from public content and may be incomplete or wrong. To the extent the law allows, AnyAPI is not liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the twelve months before the claim.",
          ],
        },
        {
          title: "Changes and contact",
          body: [
            "We may update these terms; continuing to use the service after a change means you accept it. Contact support@getanyapi.com.",
          ],
        },
      ]}
    />
  );
}
