import { OpportunityCard, type RankingThread } from "@/components/seo/OpportunityCard";

type KeywordSectionProps = {
  keyword: string;
  threads: RankingThread[];
  /** Passed through: the intent-ordered view says what it ordered on. */
  showJudgement?: boolean;
};

/** One keyword and every Reddit thread ranking for it. */
export function KeywordSection({ keyword, threads, showJudgement }: KeywordSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-h3" style={{ fontWeight: 500 }}>
          {keyword}
        </h3>
      </div>
      <div className="flex flex-col gap-2">
        {threads.map((thread) => (
          <OpportunityCard key={thread.id} thread={thread} showJudgement={showJudgement} />
        ))}
      </div>
    </section>
  );
}
