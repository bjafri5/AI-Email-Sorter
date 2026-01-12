import { getSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { classifyEmail } from "@/lib/ai";
import pLimit from "p-limit";

const RECATEGORIZE_CONCURRENCY = 10;

export async function POST(request: Request) {
  const session = await getSession();

  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  const { emailIds } = await request.json();

  if (!Array.isArray(emailIds) || emailIds.length === 0) {
    return new Response(JSON.stringify({ error: "No email IDs provided" }), {
      status: 400,
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

        // Get user's categories
        const categories = await prisma.category.findMany({
          where: { userId },
        });

        if (categories.length === 0) {
          send({ type: "error", message: "No categories defined" });
          controller.close();
          return;
        }

        // Fetch the emails to recategorize (only those belonging to the user)
        const emails = await prisma.email.findMany({
          where: {
            id: { in: emailIds },
            account: { userId },
          },
          select: {
            id: true,
            subject: true,
            fromEmail: true,
            fromName: true,
            bodyText: true,
            snippet: true,
          },
        });

        if (emails.length === 0) {
          send({ type: "error", message: "No valid emails found" });
          controller.close();
          return;
        }

        const total = emails.length;
        let processed = 0;
        let succeeded = 0;
        let failed = 0;

        send({ type: "start", total });

        const results: Array<{
          emailId: string;
          fromEmail: string;
          fromName: string | null;
          success: boolean;
          categoryId: string | null;
          categoryName: string | null;
        }> = [];

        const limit = pLimit(RECATEGORIZE_CONCURRENCY);

        await Promise.all(
          emails.map((email) =>
            limit(async () => {
              send({
                type: "processing",
                total,
                processed,
                succeeded,
                failed,
                currentId: email.id,
                current: email.fromEmail,
              });

              try {
                const categoryId = await classifyEmail(
                  {
                    subject: email.subject,
                    fromEmail: email.fromEmail,
                    fromName: email.fromName,
                    body: email.bodyText || "",
                    snippet: email.snippet,
                  },
                  categories
                );

                if (categoryId) {
                  await prisma.email.update({
                    where: { id: email.id },
                    data: { categoryId },
                  });

                  const category = categories.find((c) => c.id === categoryId);
                  succeeded++;
                  results.push({
                    emailId: email.id,
                    fromEmail: email.fromEmail,
                    fromName: email.fromName,
                    success: true,
                    categoryId,
                    categoryName: category?.name || null,
                  });
                } else {
                  // Still uncategorized
                  failed++;
                  results.push({
                    emailId: email.id,
                    fromEmail: email.fromEmail,
                    fromName: email.fromName,
                    success: false,
                    categoryId: null,
                    categoryName: null,
                  });
                }

                processed++;
                send({
                  type: "progress",
                  total,
                  processed,
                  succeeded,
                  failed,
                  result: results[results.length - 1],
                });
              } catch (error) {
                console.error(`Error recategorizing email ${email.id}:`, error);
                processed++;
                failed++;
                results.push({
                  emailId: email.id,
                  fromEmail: email.fromEmail,
                  fromName: email.fromName,
                  success: false,
                  categoryId: null,
                  categoryName: null,
                });
                send({
                  type: "progress",
                  total,
                  processed,
                  succeeded,
                  failed,
                  result: results[results.length - 1],
                });
              }
            })
          )
        );

        send({
          type: "complete",
          total,
          succeeded,
          failed,
          results,
        });
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
