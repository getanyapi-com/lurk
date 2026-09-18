import { NewProjectForm } from "@/components/product/NewProjectForm";
import { requireLocalUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";

export default async function NewProjectPage() {
  const user = await requireLocalUser();
  // The first project is the welcome: a new account is sent straight here.
  const first = (await listProjects(user.id)).length === 0;
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          {first ? "What do you sell?" : "New project"}
        </h1>
        <p className="text-body text-fg-muted">
          Give us the product URL. We read the page, work out who buys it, and start reading the
          past year of Reddit for them straight away.
        </p>
      </div>
      <NewProjectForm />
    </div>
  );
}
