import { Button } from "@/components/ui/button";
import { CreateKeyDialog } from "@/components/api/CreateKeyDialog";
import { revokeApiKeyAction } from "@/app/app/settings/api/actions";
import type { ListedApiKey } from "@/lib/api/keys";

type ApiKeysPanelProps = {
  keys: ListedApiKey[];
  requestsPerDay: number | null;
  selfHosted: boolean;
};

/** Null requests-per-day means no cap: either self-hosted, or a connected wallet. */
function allowance(requestsPerDay: number | null, selfHosted: boolean): string {
  if (selfHosted) {
    return "This instance is self-hosted, so there is no daily request limit.";
  }
  return requestsPerDay === null
    ? "Read-only. Your connected wallet lifts the daily request limit, so each key may make unlimited requests."
    : `Read-only. Each key may make ${requestsPerDay.toLocaleString("en-US")} requests a day.`;
}

function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "Never";
}

/** The keys table: what exists, when each was last used, and how to revoke one. */
export function ApiKeysPanel({ keys, requestsPerDay, selfHosted }: ApiKeysPanelProps) {
  return (
    <section className="flex flex-col gap-4 rounded-card border bg-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3" style={{ fontWeight: 500 }}>
            API keys
          </h2>
          <p className="text-body text-fg-muted">
            {allowance(requestsPerDay, selfHosted)}
          </p>
        </div>
        <CreateKeyDialog />
      </div>
      {keys.length === 0 ? (
        <p className="text-body text-fg-muted">
          No keys yet. Create one to read your leads from a script or an agent.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-small text-fg-muted">
                <th className="py-2 text-left font-normal">Name</th>
                <th className="py-2 text-left font-normal">Key</th>
                <th className="py-2 text-left font-normal">Created</th>
                <th className="py-2 text-left font-normal">Last used</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-t">
                  <td className="py-2 pr-3">{key.name}</td>
                  <td className="py-2 pr-3 font-mono text-mono text-fg-muted">{key.prefix}...</td>
                  <td className="py-2 pr-3 text-fg-muted tabular-nums">{day(key.createdAt)}</td>
                  <td className="py-2 pr-3 text-fg-muted tabular-nums">{day(key.lastUsedAt)}</td>
                  <td className="py-2 text-right">
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="keyId" value={key.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        Revoke
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
