import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { trashEmail } from "@/lib/gmail";

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

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({
        type: "start",
        total: emails.length,
        processed: 0,
      });

      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];

        send({
          type: "processing",
          total: emails.length,
          processed: i,
          succeeded,
          failed,
        });

        try {
          // Move to trash in Gmail
          await trashEmail(email.account.id, email.gmailId);

          // Delete from database
          await prisma.email.delete({
            where: { id: email.id },
          });

          succeeded++;

          send({
            type: "progress",
            total: emails.length,
            processed: i + 1,
            succeeded,
            failed,
          });
        } catch (error) {
          console.error(`Failed to delete email ${email.id}:`, error);
          failed++;

          send({
            type: "progress",
            total: emails.length,
            processed: i + 1,
            succeeded,
            failed,
          });
        }
      }

      send({
        type: "complete",
        total: emails.length,
        processed: emails.length,
        succeeded,
        failed,
      });

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
