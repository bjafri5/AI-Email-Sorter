import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const { id } = await params;

  // Verify the account belongs to this user
  const account = await prisma.account.findFirst({
    where: {
      id,
      userId: session.user.id,
    },
  });

  if (!account) {
    return new Response(JSON.stringify({ error: "Account not found" }), {
      status: 404,
    });
  }

  // Count user's accounts to prevent removing the last one
  const accountCount = await prisma.account.count({
    where: { userId: session.user.id },
  });

  if (accountCount <= 1) {
    return new Response(
      JSON.stringify({ error: "Cannot remove your only connected account" }),
      { status: 400 }
    );
  }

  // Delete the account (emails will be cascade deleted due to schema)
  await prisma.account.delete({
    where: { id },
  });

  return new Response(JSON.stringify({ success: true }), { status: 200 });
}
