import { Braces, Code2 } from "lucide-react";
import { AnyapiLink } from "@/components/AnyapiLink";
import { REPO_URL } from "./researchContent";

const LINES = [
  "$ git clone https://github.com/getanyapi-com/lurk.git",
  "$ cd lurk && cp .env.example .env",
  "$ docker compose up",
  "Applying database migrations",
  "migrations applied",
  "",
  '$ curl "$APP_URL/api/v1/projects" -H "Authorization: Bearer $KEY"',
];

/** Open source, self-host and the read-only API in the one dark panel. */
export function OpenSourcePanel() {
  return (
    <section className="dark-api-panel" id="self-host" data-proof="source">
      <div className="api-panel-copy">
        <h2>
          lurk is open source.
          <br />
          <span>
            MIT. Run it on your own key,
            <br />
            with your own model.
          </span>
        </h2>
        <a href={REPO_URL} className="api-learn">
          Read the code
        </a>
        <div className="api-panel-notes">
          <p>
            <strong>Self-host in one command</strong>Docker starts the app and Postgres. The
            scoring instructions are a file in src/lib/prompts.ts, not a secret.
          </p>
          <p>
            <strong>Read-only API and MCP</strong>Your tools and agents read projects, leads and
            SEO rows. There is no tool for posting or sending a DM.
          </p>
        </div>
      </div>
      <div className="api-art">
        <div className="code-window">
          <div className="code-header">
            <span>
              <Braces />
              Terminal
            </span>
            <AnyapiLink>Data by AnyAPI</AnyapiLink>
          </div>
          <pre>
            <code>{LINES.join("\n")}</code>
          </pre>
          <div className="code-links">
            <a href="/openapi.json">
              <Braces />
              API schema
            </a>
            <a href="/agent-guide.md">
              <Code2 />
              Agent guide
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
