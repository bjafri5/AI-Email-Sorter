import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import {
  unsubscribeFromLinks,
  UnsubscribeProgress,
  UNSUBSCRIBE_CONCURRENCY,
} from "@/lib/unsubscribe-agent";

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
        select: { email: true, name: true },
      },
    },
  });

  // Preserve the order of emailIds from the request
  const emailOrder = new Map(
    emailIds.map((id: string, index: number) => [id, index])
  );
  const emails = fetchedEmails.sort(
    (a, b) => (emailOrder.get(a.id) ?? 0) - (emailOrder.get(b.id) ?? 0)
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

  const userId = session.user.id;

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
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

      // Group emails by account for batch processing
      const emailsByAccount = new Map<string, typeof emails>();
      for (const email of emails) {
        const accountKey = email.account.email || "";
        const existing = emailsByAccount.get(accountKey) || [];
        existing.push(email);
        emailsByAccount.set(accountKey, existing);
      }

      const results: Array<{
        emailId: string;
        fromEmail: string;
        success: boolean;
        method: string;
        message: string;
      }> = [];

      let succeeded = 0;
      let failed = 0;

      // Process each account's emails in parallel with real-time progress
      for (const [accountEmail, accountEmails] of emailsByAccount) {
        const accountInfo = {
          email: accountEmail,
          name: accountEmails[0].account.name || undefined,
        };

        const links = accountEmails.map((e) => e.unsubscribeLink!);
        const fromEmails = accountEmails.map((e) => e.fromEmail);

        // Create a map of link -> email for quick lookup in callback
        const linkToEmail = new Map(
          accountEmails.map((e) => [e.unsubscribeLink!, e])
        );

        // Track pending async operations to await before closing
        const pendingOperations: Promise<void>[] = [];

        // Real-time progress callback - fires on started and completed
        const handleProgress = (progress: UnsubscribeProgress) => {
          const email = linkToEmail.get(progress.link);
          if (!email) return;

          if (progress.status === "started") {
            // Send "processing" update when an unsubscribe starts
            send({
              type: "processing",
              total: emails.length,
              processed: results.length,
              succeeded,
              failed,
              currentId: email.id,
              current: email.fromEmail,
            });
            return;
          }

          // Handle completion
          const result = progress.result!;

          // Queue the async database operation
          const operation = (async () => {
            try {
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
                    account: { userId },
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

              // Send real-time progress update
              send({
                type: "progress",
                total: emails.length,
                processed: results.length,
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

              send({
                type: "progress",
                total: emails.length,
                processed: results.length,
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
          })();

          pendingOperations.push(operation);
        };

        // Process all links with real-time progress callback
        await unsubscribeFromLinks(links, accountInfo, {
          concurrency: UNSUBSCRIBE_CONCURRENCY,
          fromEmails,
          onProgress: handleProgress,
        });

        // Wait for all pending database operations to complete
        await Promise.all(pendingOperations);
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
