import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, "review_research_results");
  const { id } = await params;

  const search = await prisma.leadSearch.findUnique({
    where: { id },
    select: { status: true, candidatesFound: true, errorMessage: true, startedAt: true, completedAt: true },
  });

  if (!search) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(search);
}
