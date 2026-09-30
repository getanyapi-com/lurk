import { CalendarDays, Eye } from "lucide-react";
import { AuthorAvatar } from "@/components/AuthorAvatar";
import { VerdictBadge } from "@/components/VerdictBadge";
import { XReplyChip } from "@/components/x/XReplyChip";
import { MockButton } from "./MockButton";
import { MockFrame } from "./MockFrame";
import { MOCK_X_ASKS, MOCK_X_REPLIES, type MockXPost } from "./xContent";

function MockXRow({ post }: { post: MockXPost }) {
  return (
    <div className="mock-x-row">
      <AuthorAvatar name={post.username} src={post.avatar} size={26} platform="x" />
      <span className="mock-x-copy">
        <strong>{post.text.split("\n")[0]}</strong>
        <small>
          @{post.username} · {post.date}
          {post.kind === "ask" ? null : (
            <>
              {" "}
              · <Eye /> {post.views.toLocaleString("en-US")} views
            </>
          )}
        </small>
      </span>
      {post.kind === "ask" ? (
        <VerdictBadge fit={post.fit} intent={post.intent} />
      ) : (
        <XReplyChip moment={post.kind} />
      )}
    </div>
  );
}

/** The X tab of a saved Cal.com test project: asks first, then posts worth a reply. */
export function AppMockX() {
  const [top] = MOCK_X_ASKS;
  return (
    <MockFrame
      active="X leads"
      project={top.product}
      title="X leads"
      actions={<MockButton label="Scan now" tone="solid" />}
    >
      <div className="mock-content">
        <div className="mock-filters">
          <span>
            <CalendarDays />
            30 days
          </span>
          <small>Saved examples</small>
        </div>
        <span className="mock-meta">
          Leads · {MOCK_X_ASKS.length} asks + {MOCK_X_REPLIES.length} to reply to
        </span>
        <div className="mock-x-list">
          {[...MOCK_X_ASKS, ...MOCK_X_REPLIES].map((post) => (
            <MockXRow key={post.id} post={post} />
          ))}
        </div>
        <p className="mock-reason">{top.reason}</p>
      </div>
    </MockFrame>
  );
}
