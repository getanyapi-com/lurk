import { AnyapiLink } from "@/components/AnyapiLink";
import { StatCard } from "@/components/StatCard";
import { lastRunJob } from "@/jobs/enqueue";
import { requireLocalUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import { sourceYield, usageSince, usageToday } from "@/lib/usage";

/** What each way of finding a candidate is called on screen. */
const SOURCE_LABEL: Record<string, string> = {
  search: "Reddit search",
  scoped: "Community search",
  listing: "Community listing",
  serp: "Google",
};

type UsagePageProps = { searchParams: Promise<{ project?: string }> };

export default async function UsagePage({ searchParams }: UsagePageProps) {
  const user = await requireLocalUser();
  const projects = await listProjects(user.id);
  const requested = (await searchParams).project;
  const active = projects.find((project) => project.id === requested) ?? projects[0];
  const usage = await usageToday(active ? [active.id] : []);
  const job = active ? await lastRunJob("scan", active.id) : null;
  const scan = active && job?.startedAt ? await usageSince(active.id, job.startedAt) : null;
  const sources = active ? await sourceYield(active.id) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          Data usage
        </h1>
        <p className="text-body text-fg-muted">
          What this project spent on <AnyapiLink /> today, and how much of it was answered from data we had
          already fetched.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Calls today" value={String(usage.calls)} caption="AnyAPI requests" />
        <StatCard
          label="USD today"
          value={`$${usage.costUsd.toFixed(4)}`}
          caption="Billed to this project"
        />
        <StatCard label="Fetched" value={String(usage.fetched)} caption="Paid AnyAPI calls" />
        <StatCard label="Reused" value={String(usage.reused)} caption="Answered from stored data" />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          Last scan
        </h2>
        {scan ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Calls" value={String(scan.calls)} caption="AnyAPI requests" />
            <StatCard
              label="USD"
              value={`$${scan.costUsd.toFixed(4)}`}
              caption="Billed to this project"
            />
            <StatCard
              label="Reused"
              value={String(scan.reused)}
              caption="Answered from stored data"
            />
            <StatCard
              label="Language model USD"
              value={`$${scan.llmCostUsd.toFixed(4)}`}
              caption="Scoring and reading"
            />
          </div>
        ) : (
          <p className="text-body text-fg-muted">
            No scan has run for this project yet, so there is nothing to show here.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-h3" style={{ fontWeight: 500 }}>
          What each source produced
        </h2>
        <p className="text-body text-fg-muted">
          Every query and community in the plan, with the candidates it found, the leads those
          became, and what its own calls cost.
        </p>
        <div className="overflow-x-auto rounded-card border bg-surface">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b text-left text-small text-fg-muted">
                <th className="p-4" style={{ fontWeight: 400 }}>
                  Found via
                </th>
                <th className="p-4" style={{ fontWeight: 400 }}>
                  Source
                </th>
                <th className="p-4" style={{ fontWeight: 400 }}>
                  Candidates
                </th>
                <th className="p-4" style={{ fontWeight: 400 }}>
                  Leads
                </th>
                <th className="p-4" style={{ fontWeight: 400 }}>
                  USD
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.length === 0 ? (
                <tr>
                  <td className="p-4 text-fg-muted" colSpan={5}>
                    No scan has found a candidate for this project yet.
                  </td>
                </tr>
              ) : (
                sources.map((row) => (
                  <tr key={`${row.kind} ${row.key}`} className="border-b last:border-0">
                    <td className="p-4 font-mono text-mono">{SOURCE_LABEL[row.kind] ?? row.kind}</td>
                    <td className="p-4">{row.key}</td>
                    <td className="p-4 tabular-nums">{row.candidates}</td>
                    <td className="p-4 tabular-nums">{row.leads}</td>
                    <td className="p-4 font-mono text-mono">${row.costUsd.toFixed(4)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="overflow-x-auto rounded-card border bg-surface">
        <table className="w-full text-body">
          <thead>
            <tr className="border-b text-left text-small text-fg-muted">
              <th className="p-4" style={{ fontWeight: 400 }}>
                API
              </th>
              <th className="p-4" style={{ fontWeight: 400 }}>
                Calls
              </th>
              <th className="p-4" style={{ fontWeight: 400 }}>
                Reused
              </th>
              <th className="p-4" style={{ fontWeight: 400 }}>
                USD
              </th>
            </tr>
          </thead>
          <tbody>
            {usage.perSku.length === 0 ? (
              <tr>
                <td className="p-4 text-fg-muted" colSpan={4}>
                  No AnyAPI calls yet today.
                </td>
              </tr>
            ) : (
              usage.perSku.map((row) => (
                <tr key={row.sku} className="border-b last:border-0">
                  <td className="p-4 font-mono text-mono">{row.sku}</td>
                  <td className="p-4 tabular-nums">{row.calls}</td>
                  <td className="p-4 tabular-nums">{row.reused}</td>
                  <td className="p-4 font-mono text-mono">${row.costUsd.toFixed(4)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
