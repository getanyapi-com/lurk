import { headers } from "next/headers";
import { Header } from "@/components/Header";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { Rail, type RailGroup } from "@/components/Rail";
import { requireLocalUser } from "@/lib/auth";
import { countMentions } from "@/lib/competitors/read";
import { newLeadCount } from "@/lib/leads";
import { activeProject, listProjects } from "@/lib/projects";
import { countOpportunities } from "@/lib/seo/read";
import { URL_HEADER } from "@/proxy";

type RailCounts = { newLeads: number; rankingThreads: number; mentions: number };

const groupsFor = (counts: RailCounts): RailGroup[] => [
  {
    label: "Engage",
    items: [
      { href: "/app/leads", label: "Leads", icon: "radar", count: counts.newLeads },
      { href: "/app/seo", label: "Reddit SEO", icon: "search", count: counts.rankingThreads },
    ],
  },
  {
    label: "Research",
    items: [
      { href: "/app/insights", label: "Insights", icon: "lightbulb" },
      { href: "/app/competitors", label: "Competitors", icon: "swords", count: counts.mentions },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/app/product", label: "Product", icon: "box" },
      { href: "/app/settings/alerts", label: "Alerts", icon: "bell" },
      { href: "/app/usage", label: "Data usage", icon: "receipt" },
      { href: "/app/settings", label: "Settings", icon: "settings" },
    ],
  },
];

const EMPTY_COUNTS: RailCounts = { newLeads: 0, rankingThreads: 0, mentions: 0 };

/**
 * What the rail's pills count for the project on screen: leads waiting, threads
 * Google ranks, and competitor mentions inside the mention window.
 */
async function countsFor(projectId: string): Promise<RailCounts> {
  const [newLeads, rankingThreads, mentions] = await Promise.all([
    newLeadCount(projectId),
    countOpportunities(projectId),
    countMentions(projectId),
  ]);
  return { newLeads, rankingThreads, mentions };
}

/** The project the page below is showing, which the rail has to count for. */
async function requestedProject(): Promise<string | undefined> {
  const url = (await headers()).get(URL_HEADER);
  return (url ? new URL(url).searchParams.get("project") : null) ?? undefined;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireLocalUser();
  const [projects, project] = await Promise.all([
    listProjects(user.id),
    requestedProject().then((requested) => activeProject(user.id, requested)),
  ]);
  const counts = project ? await countsFor(project.id) : EMPTY_COUNTS;
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <div className="flex flex-1">
        <Rail groups={groupsFor(counts)}>
          <ProjectSwitcher
            projects={projects.map((one) => ({ id: one.id, name: one.name, url: one.url }))}
            defaultId={project?.id ?? null}
          />
        </Rail>
        {/*
          min-w-0 or the page grows to its widest content: a flex item's own
          minimum is its max-content width, so one long Reddit body made the
          whole app 5,246px wide in a 1,440px window and the people strip's
          own horizontal scroll never engaged.
        */}
        <main className="min-w-0 flex-1" style={{ padding: "var(--page-gutter)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
