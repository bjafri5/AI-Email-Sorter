import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { deleteEmails } from "@/lib/gmail";

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { emailIds } = body;

  if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
    return new Response(JSON.stringify({ error: "No emails selected" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get emails that belong to this user
  const emails = await prisma.email.findMany({
    where: {
      id: { in: emailIds },
      account: { userId: session.user.id },
    },
    include: {
      account: {
        select: { id: true },
      },
    },
  });

  if (emails.length === 0) {
    return new Response(JSON.stringify({ error: "No emails found" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Group emails by account for batch deletion
    const emailsByAccount = new Map<string, string[]>();
    for (const email of emails) {
      const existing = emailsByAccount.get(email.account.id) || [];
      existing.push(email.gmailId);
      emailsByAccount.set(email.account.id, existing);
    }

    // Batch delete from Gmail (all accounts in parallel)
    await Promise.all(
      Array.from(emailsByAccount.entries()).map(([accountId, gmailIds]) =>
        deleteEmails(accountId, gmailIds)
      )
    );

    // Delete from database
    await prisma.email.deleteMany({
      where: { id: { in: emails.map((e) => e.id) } },
    });

    return new Response(
      JSON.stringify({
        success: true,
        deleted: emails.length,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Failed to delete emails:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to delete emails",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
