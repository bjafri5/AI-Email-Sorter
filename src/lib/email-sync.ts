import { prisma } from "./prisma";
import { fetchNewEmails, archiveEmail } from "./gmail";
import { classifyEmail, summarizeEmail } from "./ai";
import { cleanEmailBody } from "./email-utils";

export interface SyncResult {
  accountId: string;
  accountEmail: string;
  fetched: number;
  processed: number;
  skipped: number;
  errors: string[];
}

export async function syncEmailsForUser(userId: string): Promise<SyncResult[]> {
  const accounts = await prisma.account.findMany({
    where: { userId },
  });

  const results: SyncResult[] = [];

  for (const account of accounts) {
    const result = await syncEmailsForAccount(account.id, userId);
    results.push({
      accountId: account.id,
      accountEmail: account.email || "Unknown",
      ...result,
    });
  }

  return results;
}

async function syncEmailsForAccount(
  accountId: string,
  userId: string
): Promise<{
  fetched: number;
  processed: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let fetched = 0;
  let processed = 0;
  let skipped = 0;

  try {
    // Get user's categories
    const categories = await prisma.category.findMany({
      where: { userId },
    });

    if (categories.length === 0) {
      return {
        fetched: 0,
        processed: 0,
        skipped: 0,
        errors: ["No categories defined"],
      };
    }

    // Get account with last sync time
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    // Fetch new emails (use last sync time for incremental sync)
    const emails = await fetchNewEmails(accountId, 20);
    fetched = emails.length;

    const syncStartTime = new Date();

    for (const emailData of emails) {
      try {
        // Skip if already imported
        const existing = await prisma.email.findUnique({
          where: { gmailId: emailData.gmailId },
        });

        if (existing) {
          skipped++;
          continue;
        }

        // Clean the email body for AI processing
        const bodyText = cleanEmailBody(emailData.body);

        // Classify email using AI
        const categoryId = await classifyEmail(
          { ...emailData, body: bodyText },
          categories
        );

        // Summarize email using AI
        const summary = await summarizeEmail({ ...emailData, body: bodyText });

        // Save to database
        await prisma.email.create({
          data: {
            gmailId: emailData.gmailId,
            threadId: emailData.threadId,
            accountId,
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

        // Archive in Gmail
        await archiveEmail(accountId, emailData.gmailId);

        processed++;
      } catch (error) {
        errors.push(`Failed to process email ${emailData.gmailId}: ${error}`);
      }
    }

    // Update last sync time
    await prisma.account.update({
      where: { id: accountId },
      data: { lastSyncedAt: syncStartTime },
    });
  } catch (error) {
    errors.push(`Failed to fetch emails: ${error}`);
  }

  return { fetched, processed, skipped, errors };
}
