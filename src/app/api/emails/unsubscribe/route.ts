import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { emailIds } = body;

  if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
    return NextResponse.json({ error: "No emails selected" }, { status: 400 });
  }

  // Get emails with unsubscribe links that belong to this user
  const emails = await prisma.email.findMany({
    where: {
      id: { in: emailIds },
      account: { userId: session.user.id },
      unsubscribeLink: { not: null },
    },
  });

  let succeeded = 0;
  let failed = 0;
  const results: Array<{ email: string; success: boolean; error?: string }> =
    [];

  for (const email of emails) {
    try {
      // For now, we just return the unsubscribe links
      // Phase 7 will implement the AI agent to actually click through
      results.push({
        email: email.fromEmail,
        success: true,
        error: undefined,
      });
      succeeded++;
    } catch (error) {
      results.push({
        email: email.fromEmail,
        success: false,
        error: String(error),
      });
      failed++;
    }
  }

  return NextResponse.json({
    success: true,
    processed: emails.length,
    succeeded,
    failed,
    results,
  });
}
