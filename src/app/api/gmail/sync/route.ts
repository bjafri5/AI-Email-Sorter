import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { fetchNewEmails, archiveEmail } from "@/lib/gmail";
import { classifyEmail, summarizeEmail } from "@/lib/ai";
import { cleanEmailBody } from "@/lib/email-utils";

interface EmailWithAccount {
  accountId: string;
  gmailId: string;
  threadId: string | null;
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
        const allEmails: EmailWithAccount[] = fetchResults.flat();

        if (allEmails.length === 0) {
          send({ type: "complete", totalProcessed: 0, totalErrors: 0, totalSkipped: 0 });
          controller.close();
          return;
        }

        // Phase 2: Process all emails sequentially with unified progress
        const total = allEmails.length;
        let processed = 0;
        let skipped = 0;
        let errors = 0;

        send({ type: "start", total });

        for (let i = 0; i < allEmails.length; i++) {
          const emailData = allEmails[i];

          try {
            // Skip if exists
            const existing = await prisma.email.findUnique({
              where: { gmailId: emailData.gmailId },
            });

            if (existing) {
              skipped++;
              send({
                type: "progress",
                current: i + 1,
                total,
                processed,
                skipped,
                errors,
                status: "skipped",
              });
              continue;
            }

            const bodyText = cleanEmailBody(emailData.body);
            const categoryId = await classifyEmail(
              { ...emailData, body: bodyText },
              categories
            );
            const summary = await summarizeEmail({
              ...emailData,
              body: bodyText,
            });

            await prisma.email.create({
              data: {
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
            });

            await archiveEmail(emailData.accountId, emailData.gmailId);
            processed++;

            send({
              type: "progress",
              current: i + 1,
              total,
              processed,
              skipped,
              errors,
              status: "processed",
            });
          } catch (error) {
            errors++;
            send({
              type: "progress",
              current: i + 1,
              total,
              processed,
              skipped,
              errors,
              status: "error",
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

        send({ type: "complete", totalProcessed: processed, totalErrors: errors, totalSkipped: skipped });
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
