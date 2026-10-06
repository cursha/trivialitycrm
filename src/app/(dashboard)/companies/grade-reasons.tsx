import { explainGrade, type CategoryReason } from "@/lib/eos/grade-reasons";
import type { EosCategoryScores } from "@/lib/eos/constants";
import { GRADE_LABEL } from "@/lib/ui/status-tones";

/** "an A+", "an A", "a B". */
function withArticle(grade: string): string {
  return `${grade.startsWith("A") ? "an" : "a"} ${grade}`;
}

function ReasonList({ title, reasons }: { title: string; reasons: CategoryReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <div>
      <p className="font-semibold text-text">{title}</p>
      <ul className="mt-0.5 space-y-1">
        {reasons.map((reason) => (
          <li key={reason.key}>
            <span className="text-text">
              {reason.label} {reason.score}/{reason.max}
            </span>
            {reason.evidence && <span className="text-text-muted"> — {reason.evidence}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Why this grade": the score's grade range and the next grade up, the AI's
 * own explanation, the categories that carried the score and held it back
 * (with evidence), and any rule that overrode the AI (Curt's call). Shared
 * by the opportunity-analysis results and the company's EOS card.
 */
export function GradeReasons({
  eosTotal,
  categoryScores,
  noTvs,
  explanation,
  evidence,
}: {
  eosTotal: number;
  categoryScores: EosCategoryScores;
  noTvs: boolean;
  explanation: string | null;
  evidence?: { category: string; evidenceSummary: string }[];
}) {
  const reasons = explainGrade({ eosTotal, categoryScores, noTvs, evidence });
  const grade = GRADE_LABEL[reasons.grade];

  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <p className="text-sm font-semibold text-text">Why {grade}</p>
      <p className="text-text">
        EOS {eosTotal} of 100 is {withArticle(grade)} ({grade} is {reasons.band.min}–{reasons.band.max}).
        {reasons.nextGrade
          ? ` ${reasons.nextGrade.pointsNeeded} more point${reasons.nextGrade.pointsNeeded === 1 ? "" : "s"} would make it ${withArticle(GRADE_LABEL[reasons.nextGrade.grade])}.`
          : ""}
      </p>
      {explanation && <p className="text-text-muted">{explanation}</p>}
      <ReasonList title="Helped most" reasons={reasons.strengths} />
      <ReasonList title="Held it back" reasons={reasons.holdbacks} />
      {reasons.overrides.map((override) => (
        <p key={override} className="font-semibold text-danger">
          {override}
        </p>
      ))}
    </div>
  );
}
