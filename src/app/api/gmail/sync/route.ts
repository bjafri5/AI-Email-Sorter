import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { fetchNewEmails, archiveEmail } from "@/lib/gmail";
import { classifyEmail, summarizeEmail } from "@/lib/ai";
import { cleanEmailBody } from "@/lib/email-utils";

interface EmailWithAccount {
  accountId: string;
  gmailId: string;
  threadId: string | null | undefined;
  subject: string;
  fromEmail: string;
  fromName: string | null;
  snippet: string | null;
  body: string;
  unsubscribeLink: string | null;
  receivedAt: Date;
}

export async function POST() {
  const session = await getSession();

  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const userId = session.user.id;
        const categories = await prisma.category.findMany({
          where: { userId },
        });

        if (categories.length === 0) {
          send({ type: "error", message: "No categories defined" });
          controller.close();
          return;
        }

        const accounts = await prisma.account.findMany({ where: { userId } });

        if (accounts.length === 0) {
          send({ type: "error", message: "No accounts connected" });
          controller.close();
          return;
        }

        // Phase 1: Fetch emails from all accounts in parallel
        send({ type: "fetching", message: "Fetching emails..." });

        const fetchResults = await Promise.all(
          accounts.map(async (account) => {
            try {
              const emails = await fetchNewEmails(account.id, 10);
              return emails.map((email) => ({
                ...email,
                accountId: account.id,
              }));
            } catch (error) {
              console.error(`Failed to fetch from ${account.email}:`, error);
              return [];
            }
          })
        );

        // Flatten all emails into a single array
        const allFetchedEmails: EmailWithAccount[] = fetchResults.flat();

        if (allFetchedEmails.length === 0) {
          send({ type: "complete", totalProcessed: 0, totalErrors: 0, totalSkipped: 0 });
          controller.close();
          return;
        }

        // Filter out emails that already exist in the database
        const existingEmails = await prisma.email.findMany({
          where: {
            gmailId: { in: allFetchedEmails.map((e) => e.gmailId) },
          },
          select: { gmailId: true },
        });
        const existingGmailIds = new Set(existingEmails.map((e) => e.gmailId));

        const newEmails = allFetchedEmails.filter(
          (e) => !existingGmailIds.has(e.gmailId)
        );
        const skippedCount = allFetchedEmails.length - newEmails.length;

        if (newEmails.length === 0) {
          send({
            type: "complete",
            totalProcessed: 0,
            totalErrors: 0,
            totalSkipped: skippedCount
          });
          controller.close();
          return;
        }

        // Phase 2: Process only new emails sequentially
        const total = newEmails.length;
        let processed = 0;
        let errors = 0;

        send({ type: "start", total, skipped: skippedCount });

        for (let i = 0; i < newEmails.length; i++) {
          const emailData = newEmails[i];

          try {
            const bodyText = cleanEmailBody(emailData.body);
            const categoryId = await classifyEmail(
              { ...emailData, body: bodyText },
              categories
            );
            const summary = await summarizeEmail({
              ...emailData,
              body: bodyText,
            });

            // Use upsert to handle race conditions where another sync
            // might have inserted this email between our batch check and now
            try {
              await prisma.email.upsert({
                where: { gmailId: emailData.gmailId },
                create: {
                  gmailId: emailData.gmailId,
                  threadId: emailData.threadId,
                  accountId: emailData.accountId,
                  categoryId,
                  subject: emailData.subject,
                  fromEmail: emailData.fromEmail,
                  fromName: emailData.fromName,
                  snippet: emailData.snippet,
                  body: emailData.body,
                  bodyText,
                  summary,
                  unsubscribeLink: emailData.unsubscribeLink,
                  receivedAt: emailData.receivedAt,
                  isArchived: true,
                },
                update: {}, // Don't update if already exists
              });
            } catch (upsertError) {
              // P2002 = unique constraint violation - email already exists, skip it
              if (
                upsertError instanceof Error &&
                "code" in upsertError &&
                (upsertError as { code: string }).code === "P2002"
              ) {
                // Already exists, treat as skipped not processed
                send({
                  type: "progress",
                  current: i + 1,
                  total,
                  processed,
                  skipped: skippedCount + 1,
                  errors,
                  status: "skipped",
                });
                continue;
              }
              throw upsertError; // Re-throw other errors
            }

            await archiveEmail(emailData.accountId, emailData.gmailId);
            processed++;

            send({
              type: "progress",
              current: i + 1,
              total,
              processed,
              skipped: skippedCount,
              errors,
              status: "processed",
            });
          } catch (error) {
            console.error(
              `Error processing email ${emailData.gmailId} (${emailData.subject}):`,
              error
            );
            errors++;
            send({
              type: "progress",
              current: i + 1,
              total,
              processed,
              skipped: skippedCount,
              errors,
              status: "error",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Update lastSyncedAt for all accounts
        const now = new Date();
        await Promise.all(
          accounts.map((account) =>
            prisma.account.update({
              where: { id: account.id },
              data: { lastSyncedAt: now },
            })
          )
        );

        send({ type: "complete", totalProcessed: processed, totalErrors: errors, totalSkipped: skippedCount });
      } catch (error) {
        send({ type: "error", message: String(error) });
      }

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
