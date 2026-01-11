import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { unsubscribeFromLink } from "@/lib/unsubscribe-agent";

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

  // Get emails with unsubscribe links that belong to this user
  const fetchedEmails = await prisma.email.findMany({
    where: {
      id: { in: emailIds },
      account: { userId: session.user.id },
      unsubscribeLink: { not: null },
    },
    include: {
      account: {
        select: { email: true },
      },
    },
  });

  // Preserve the order of emailIds from the request
  const emailOrder = new Map(emailIds.map((id: string, index: number) => [id, index]));
  const emails = fetchedEmails.sort((a, b) =>
    (emailOrder.get(a.id) ?? 0) - (emailOrder.get(b.id) ?? 0)
  );

  if (emails.length === 0) {
    return new Response(
      JSON.stringify({ error: "No emails with unsubscribe links found" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // User info from session
  const userInfo = {
    email: session.user.email || "",
    name: session.user.name || undefined,
  };

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial progress
      send({
        type: "start",
        total: emails.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      });

      const results: Array<{
        emailId: string;
        fromEmail: string;
        success: boolean;
        method: string;
        message: string;
      }> = [];

      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];

        // Send progress update - processing
        send({
          type: "processing",
          total: emails.length,
          processed: i,
          succeeded,
          failed,
          currentId: email.id,
          current: email.fromEmail,
        });

        try {
          const result = await unsubscribeFromLink(
            email.unsubscribeLink!,
            userInfo
          );

          await prisma.email.update({
            where: { id: email.id },
            data: {
              unsubscribeStatus: result.success ? "success" : "failed",
              unsubscribedAt: result.success ? new Date() : null,
              unsubscribeAttempts: { increment: 1 },
            },
          });

          if (result.success) {
            // Mark all emails from same sender as unsubscribed
            await prisma.email.updateMany({
              where: {
                fromEmail: email.fromEmail,
                account: { userId: session.user.id },
                id: { not: email.id },
              },
              data: {
                unsubscribeStatus: "success",
                unsubscribedAt: new Date(),
              },
            });
            succeeded++;
          } else {
            failed++;
          }

          results.push({
            emailId: email.id,
            fromEmail: email.fromEmail,
            success: result.success,
            method: result.method,
            message: result.message,
          });

          // Send progress update - completed one
          send({
            type: "progress",
            total: emails.length,
            processed: i + 1,
            succeeded,
            failed,
            current: email.fromEmail,
            result: {
              emailId: email.id,
              fromEmail: email.fromEmail,
              success: result.success,
              message: result.message,
            },
          });
        } catch (error) {
          await prisma.email.update({
            where: { id: email.id },
            data: {
              unsubscribeStatus: "failed",
              unsubscribeAttempts: { increment: 1 },
            },
          });

          results.push({
            emailId: email.id,
            fromEmail: email.fromEmail,
            success: false,
            method: "none",
            message: `Error: ${error}`,
          });
          failed++;

          // Send progress update - error
          send({
            type: "progress",
            total: emails.length,
            processed: i + 1,
            succeeded,
            failed,
            current: email.fromEmail,
            result: {
              emailId: email.id,
              fromEmail: email.fromEmail,
              success: false,
              message: `Error: ${error}`,
            },
          });
        }
      }

      // Send final result
      send({
        type: "complete",
        total: emails.length,
        processed: emails.length,
        succeeded,
        failed,
        results,
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
