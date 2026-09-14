"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Favicon } from "@/components/Favicon";

export type SwitcherProject = { id: string; name: string; url: string | null };

type ProjectSwitcherProps = {
  projects: SwitcherProject[];
  defaultId: string | null;
};

/** Picks the active project, and links to the page that creates a new one. */
export function ProjectSwitcher({ projects, defaultId }: ProjectSwitcherProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const activeId = params.get("project") ?? defaultId;
  const active =
    projects.find((project) => project.id === activeId) ?? projects[0];

  function select(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("project", id);
    startTransition(() => router.push(`?${next.toString()}`));
  }

  return (
    <div className="flex flex-col gap-2">
      {projects.length > 0 ? (
        <div
          className={`flex items-center gap-2 rounded-control border bg-surface px-2 transition-opacity${pending ? " opacity-60" : ""}`}
          aria-busy={pending}
        >
          <Favicon url={active?.url ?? null} name={active?.name ?? "?"} />
          <Select
            shape="pill"
            className="h-10 min-w-0 flex-1 text-body"
            ariaLabel="Active project"
            value={activeId ?? ""}
            onValueChange={select}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
        </div>
      ) : null}
      <Button
        variant="outline"
        size="lg"
        nativeButton={false}
        render={<Link href="/app/projects/new">New project</Link>}
      />
    </div>
  );
}
