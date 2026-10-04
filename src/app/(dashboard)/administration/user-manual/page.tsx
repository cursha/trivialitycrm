import Link from "next/link";
import clsx from "clsx";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { MANUALS, findManual, readManual } from "@/lib/docs/manuals";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "User Manual — Triviality CRM" };

// Styles for the Markdown elements the guides use (there's no typography
// plugin in this project). Raw HTML in the Markdown is never rendered.
const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-black text-accent">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-8 border-b border-border pb-1 text-lg font-bold text-accent">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-5 font-bold text-text">{children}</h3>,
  p: ({ children }) => <p className="mt-3 leading-relaxed text-text">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1.5 pl-6 text-text">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1.5 pl-6 text-text">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  a: ({ href, children }) => (
    <a href={href} className="font-semibold text-secondary hover:underline" target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer noopener">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border bg-black/5 px-3 py-2 font-semibold text-text">{children}</th>,
  td: ({ children }) => <td className="border border-border px-3 py-2 align-top text-text">{children}</td>,
};

export default async function UserManualPage({ searchParams }: { searchParams: Promise<{ guide?: string }> }) {
  const user = await requireUser();
  requirePermission(user, "view_administration");

  const { guide } = await searchParams;
  const manual = findManual(guide);
  const markdown = await readManual(manual.file);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="User Manual" description="How to use the CRM, kept up to date with each release." />

      <nav className="flex flex-wrap gap-2" aria-label="Guides">
        {MANUALS.map((item) => (
          <Link
            key={item.slug}
            href={`/administration/user-manual?guide=${item.slug}`}
            aria-current={item.slug === manual.slug ? "page" : undefined}
            className={clsx(
              "rounded-lg border px-4 py-2 text-sm font-semibold",
              item.slug === manual.slug ? "border-accent bg-accent text-white" : "border-border-strong text-text hover:bg-black/5",
            )}
          >
            {item.title}
            <span className={clsx("ml-2 text-xs font-normal", item.slug === manual.slug ? "text-white/80" : "text-text-muted")}>{item.audience}</span>
          </Link>
        ))}
      </nav>

      <Card>
        {markdown ? (
          <article>
            <Markdown remarkPlugins={[remarkGfm]} components={components}>
              {markdown}
            </Markdown>
          </article>
        ) : (
          <Alert tone="warning">This guide isn&apos;t included in this build of the app ({manual.file} is missing).</Alert>
        )}
      </Card>
    </div>
  );
}
