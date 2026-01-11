import { getSession } from "@/lib/auth-helpers";
import {
  fetchEmailsForUser,
  filterExistingEmails,
  processEmailsInParallel,
  batchArchiveEmails,
  updateAccountSyncTime,
  getUserCategories,
  SyncCounters,
} from "@/lib/email-sync";

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

        // Get user's categories
        const categories = await getUserCategories(userId);
        if (categories.length === 0) {
          send({ type: "error", message: "No categories defined" });
          controller.close();
          return;
        }

        // Phase 1: Fetch emails from all accounts
        send({ type: "fetching", message: "Fetching emails..." });

        const { emails: allFetchedEmails, accountIds } =
          await fetchEmailsForUser(userId, 10);

        if (accountIds.length === 0) {
          send({ type: "error", message: "No accounts connected" });
          controller.close();
          return;
        }

        if (allFetchedEmails.length === 0) {
          send({
            type: "complete",
            totalProcessed: 0,
            totalErrors: 0,
            totalSkipped: 0,
          });
          controller.close();
          return;
        }

        // Filter out existing emails
        const { newEmails, skippedCount } =
          await filterExistingEmails(allFetchedEmails);

        if (newEmails.length === 0) {
          send({
            type: "complete",
            totalProcessed: 0,
            totalErrors: 0,
            totalSkipped: skippedCount,
          });
          controller.close();
          return;
        }

        // Phase 2: Process emails in parallel
        const total = newEmails.length;
        send({ type: "start", total, skipped: skippedCount });

        const onProgress = (
          counters: SyncCounters,
          total: number,
          status: "processed" | "skipped" | "error",
          errorMessage?: string
        ) => {
          send({
            type: "progress",
            current: counters.completed,
            total,
            processed: counters.processed,
            skipped: counters.skipped,
            errors: counters.errors,
            status,
            ...(errorMessage && { errorMessage }),
          });
        };

        const { results, counters } = await processEmailsInParallel(
          newEmails,
          categories,
          skippedCount,
          onProgress
        );

        // Phase 3: Batch archive and update sync time
        await batchArchiveEmails(results);
        await updateAccountSyncTime(accountIds);

        send({
          type: "complete",
          totalProcessed: counters.processed,
          totalErrors: counters.errors,
          totalSkipped: counters.skipped,
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
