import { NewProjectForm } from "@/components/product/NewProjectForm";
import { requireLocalUser } from "@/lib/auth";

export default async function NewProjectPage() {
  await requireLocalUser();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h2" style={{ fontWeight: 500 }}>
          New project
        </h1>
        <p className="text-body text-fg-muted">
          Give us the product URL and we read the page, name the project, work out who buys it,
          and pick the subreddits worth watching.
        </p>
      </div>
      <NewProjectForm />
    </div>
  );
}
