import Link from "next/link";
import { Card, SectionHeading } from "@/components/ui/card";
import type { RateResult } from "@/lib/reports/metrics";

/**
 * Every report breakdown renders as ONE real <table> — label, count, and
 * share are always plain text, with a CSS bar as a supplementary visual
 * layered inside the label cell, not a chart-only widget. This satisfies
 * "not rely on colour alone" and "provide a table alternative" by
 * construction rather than needing a second parallel component.
 */
export function MetricBreakdown({
  title,
  rows,
  emptyLabel,
  countLabel = "Count",
}: {
  title: string;
  rows: { label: string; count: number; href?: string }[];
  emptyLabel: string;
  countLabel?: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card>
      <SectionHeading>{title}</SectionHeading>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{emptyLabel}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title} breakdown</caption>
            <thead>
              <tr className="text-left text-xs font-semibold uppercase text-text-muted">
                <th scope="col" className="pb-2">
                  Label
                </th>
                <th scope="col" className="pb-2 text-right">
                  {countLabel}
                </th>
                <th scope="col" className="pb-2 text-right">
                  Share
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
                return (
                  <tr key={row.label} className="border-t border-border/40">
                    <td className="py-2 pr-2">
                      {row.href ? (
                        <Link href={row.href} className="font-medium text-secondary hover:underline">
                          {row.label}
                        </Link>
                      ) : (
                        <span className="font-medium text-text">{row.label}</span>
                      )}
                      <div className="mt-1 h-1.5 w-full rounded-full bg-border/40">
                        <div className="h-1.5 rounded-full bg-secondary" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="py-2 text-right font-semibold text-text">{row.count}</td>
                    <td className="py-2 text-right text-text-muted">{pct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function StatTile({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const content = (
    <Card>
      <p className="text-sm font-semibold text-text-muted">{label}</p>
      <strong className="mt-2 block text-3xl text-text">{value}</strong>
    </Card>
  );
  return href ? (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}

/** Renders a rate that may be suppressed for having too small a sample —
 * the underlying count is always shown, never hidden behind the percent. */
export function RateStat({ label, result }: { label: string; result: RateResult }) {
  return (
    <Card>
      <p className="text-sm font-semibold text-text-muted">{label}</p>
      {result.suppressed ? (
        <p className="mt-2 text-lg font-bold text-text-muted">
          Not enough data
          <span className="ml-1 text-xs font-normal">
            ({result.numerator}/{result.denominator})
          </span>
        </p>
      ) : (
        <p className="mt-2 text-3xl font-black text-text">
          {(result.rate * 100).toFixed(0)}%
          <span className="ml-1 text-xs font-normal text-text-muted">
            ({result.numerator}/{result.denominator})
          </span>
        </p>
      )}
    </Card>
  );
}

export function NoDataNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm italic text-text-muted">{children}</p>;
}
