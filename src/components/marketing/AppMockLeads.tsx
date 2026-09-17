import { CalendarDays, Filter } from "lucide-react";
import { MockButton } from "./MockButton";
import { MockFrame } from "./MockFrame";
import { MockLeadCard } from "./MockLeadCard";
import { MockTimeline } from "./MockTimeline";
import { MOCK_LEADS } from "./mockContent";

export function AppMockLeads() {
  return (
    <MockFrame
      active="Leads"
      title="Leads"
      actions={<MockButton label="Scan now" tone="solid" />}
    >
      <div className="mock-content">
        <div className="mock-filters">
          <span>
            <CalendarDays />
            30 days
          </span>
          <span>
            <Filter />
            All communities
          </span>
          <small>Saved examples</small>
        </div>
        <MockTimeline />
        <MockLeadCard lead={MOCK_LEADS[0]} />
        <div className="mock-comment">
          <span className="mock-meta">Also in this conversation</span>
          <MockLeadCard lead={MOCK_LEADS[1]} />
        </div>
      </div>
    </MockFrame>
  );
}
