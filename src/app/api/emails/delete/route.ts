import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { deleteEmail } from "@/lib/gmail";

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

  // Get emails that belong to this user
  const emails = await prisma.email.findMany({
    where: {
      id: { in: emailIds },
      account: { userId: session.user.id },
    },
    include: { account: true },
  });

  let deleted = 0;
  const errors: string[] = [];

  for (const email of emails) {
    try {
      // Delete from Gmail (move to trash)
      await deleteEmail(email.account.id, email.gmailId);

      // Delete from database
      await prisma.email.delete({ where: { id: email.id } });

      deleted++;
    } catch (error) {
      errors.push(`Failed to delete ${email.subject}: ${error}`);
    }
  }

  return NextResponse.json({
    success: true,
    deleted,
    errors,
  });
}
