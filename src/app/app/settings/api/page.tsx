import { ApiAccessPanel } from "@/components/api/ApiAccessPanel";
import { ApiKeysPanel } from "@/components/api/ApiKeysPanel";
import { listApiKeys } from "@/lib/api/keys";
import { requireLocalUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { tierForUser } from "@/lib/tier";

export default async function ApiSettingsPage() {
  const user = await requireLocalUser();
  const [keys, tier] = await Promise.all([listApiKeys(user.id), tierForUser(user.id)]);
  const origin = config().APP_URL.replace(/\/$/, "");
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          API and MCP
        </h1>
        <p className="text-body text-fg-muted">
          Read your projects, leads, Reddit SEO, pain themes and spend from a script or an agent.
        </p>
      </div>
      <ApiKeysPanel
        keys={keys}
        requestsPerDay={tier.limits?.apiRequestsPerDay ?? null}
        selfHosted={config().SELF_HOSTED}
      />
      <ApiAccessPanel restBaseUrl={`${origin}/api/v1`} mcpUrl={`${origin}/api/mcp`} />
    </div>
  );
}
