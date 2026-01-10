import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { fetchNewEmails, archiveEmail } from "@/lib/gmail";
import { classifyEmail, summarizeEmail } from "@/lib/ai";
import { cleanEmailBody } from "@/lib/email-utils";

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
        let totalProcessed = 0;
        let totalErrors = 0;

        for (const account of accounts) {
          const emails = await fetchNewEmails(account.id, 20);
          const total = emails.length;

          send({ type: "start", total, accountEmail: account.email });

          for (let i = 0; i < emails.length; i++) {
            const emailData = emails[i];

            try {
              // Skip if exists
              const existing = await prisma.email.findUnique({
                where: { gmailId: emailData.gmailId },
              });

              if (existing) {
                send({
                  type: "progress",
                  current: i + 1,
                  total,
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
                  accountId: account.id,
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

              await archiveEmail(account.id, emailData.gmailId);
              totalProcessed++;

              send({
                type: "progress",
                current: i + 1,
                total,
                status: "processed",
              });
            } catch (error) {
              totalErrors++;
              send({
                type: "progress",
                current: i + 1,
                total,
                status: "error",
              });
            }
          }

          await prisma.account.update({
            where: { id: account.id },
            data: { lastSyncedAt: new Date() },
          });
        }

        send({ type: "complete", totalProcessed, totalErrors });
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
