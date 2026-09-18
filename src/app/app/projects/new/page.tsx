import { HowItWorks } from "@/components/product/HowItWorks";
import { NewProjectForm } from "@/components/product/NewProjectForm";
import { requireLocalUser } from "@/lib/auth";

export default async function NewProjectPage() {
  await requireLocalUser();
  return (
    <div className="grid max-w-5xl items-start gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-h2" style={{ fontWeight: 500 }}>
            What&rsquo;s your site?
          </h1>
          <p className="text-body text-fg-muted">
            That is all we need. The leads start arriving in about a minute.
          </p>
        </div>
        <NewProjectForm />
      </div>
      <HowItWorks />
    </div>
  );
}
