"use client";

import Link from "next/link";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Favicon } from "@/components/Favicon";

export type SwitcherProject = { id: string; name: string; url: string | null };

type ProjectSwitcherProps = {
  projects: SwitcherProject[];
  defaultId: string | null;
};

/** Where a project is made. The rail reads as that unmade project while you are there. */
export const NEW_PROJECT_PATH = "/app/projects/new";

/** Picks the active project, and links to the page that creates a new one. */
export function ProjectSwitcher({ projects, defaultId }: ProjectSwitcherProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  // On the new project page the switcher holds the project being made, so an
  // existing one never reads as the owner of a page that is not about it.
  const creating = usePathname() === NEW_PROJECT_PATH;
  const activeId = creating ? null : (params.get("project") ?? defaultId);
  const active =
    projects.find((project) => project.id === activeId) ?? projects[0];

  function select(id: string) {
    if (creating) {
      startTransition(() => router.push(`/app/leads?project=${id}`));
      return;
    }
    const next = new URLSearchParams(params.toString());
    next.set("project", id);
    startTransition(() => router.push(`?${next.toString()}`));
  }

  return (
    <div className="flex flex-col gap-2">
      {creating && projects.length === 0 ? (
        // A first project has nothing to switch to, so the same pill, with no list behind it.
        <div className="flex h-[42px] items-center gap-2 rounded-control border bg-surface px-2 text-body text-fg">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-fg-muted">
            <Plus className="size-3" aria-hidden="true" />
          </span>
          <span className="pl-0.5">New project</span>
        </div>
      ) : projects.length > 0 ? (
        <div
          className={`flex items-center gap-2 rounded-control border bg-surface px-2 transition-opacity${pending ? " opacity-60" : ""}`}
          aria-busy={pending}
        >
          {creating ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-fg-muted">
              <Plus className="size-3" aria-hidden="true" />
            </span>
          ) : (
            <Favicon url={active?.url ?? null} name={active?.name ?? "?"} />
          )}
          <Select
            shape="pill"
            className="h-10 min-w-0 flex-1 text-body"
            ariaLabel="Active project"
            value={activeId ?? ""}
            placeholder="New project"
            onValueChange={select}
            options={projects.map((project) => ({
              value: project.id,
              label: project.name,
            }))}
          />
        </div>
      ) : null}
      {creating ? null : (
        <Button
          variant="outline"
          size="lg"
          nativeButton={false}
          render={<Link href="/app/projects/new">New project</Link>}
        />
      )}
    </div>
  );
}
