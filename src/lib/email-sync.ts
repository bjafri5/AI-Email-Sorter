import { prisma } from "./prisma";
import { fetchNewEmails, archiveEmails } from "./gmail";
import { classifyAndSummarizeEmail, extractUnsubscribeLinkAI } from "./ai";
import { cleanEmailBody } from "./email-utils";
import pLimit from "p-limit";

// Process 10 emails concurrently for ~10x speedup
const CONCURRENCY_LIMIT = 10;

export interface EmailWithAccount {
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

export interface SyncCounters {
  processed: number;
  errors: number;
  skipped: number;
  completed: number;
}

export interface ProcessResult {
  emailData: EmailWithAccount;
  success: boolean;
}

export type ProgressCallback = (
  counters: SyncCounters,
  total: number,
  status: "processed" | "skipped" | "error",
  errorMessage?: string
) => void;

interface Category {
  id: string;
  name: string;
  description: string;
}

/**
 * Fetch emails from all accounts for a user
 */
export async function fetchEmailsForUser(
  userId: string,
  maxPerAccount: number = 10
): Promise<{ emails: EmailWithAccount[]; accountIds: string[] }> {
  const accounts = await prisma.account.findMany({ where: { userId } });

  if (accounts.length === 0) {
    return { emails: [], accountIds: [] };
  }

  const fetchResults = await Promise.all(
    accounts.map(async (account) => {
      try {
        const emails = await fetchNewEmails(account.id, maxPerAccount);
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

  return {
    emails: fetchResults.flat(),
    accountIds: accounts.map((a) => a.id),
  };
}

/**
 * Filter out emails that already exist in the database
 */
export async function filterExistingEmails(
  emails: EmailWithAccount[]
): Promise<{ newEmails: EmailWithAccount[]; skippedCount: number }> {
  if (emails.length === 0) {
    return { newEmails: [], skippedCount: 0 };
  }

  const existingEmails = await prisma.email.findMany({
    where: {
      gmailId: { in: emails.map((e) => e.gmailId) },
    },
    select: { gmailId: true },
  });

  const existingGmailIds = new Set(existingEmails.map((e) => e.gmailId));
  const newEmails = emails.filter((e) => !existingGmailIds.has(e.gmailId));

  return {
    newEmails,
    skippedCount: emails.length - newEmails.length,
  };
}

/**
 * Process emails in parallel with concurrency limit
 * Uses combined AI call for classification + summarization
 */
export async function processEmailsInParallel(
  emails: EmailWithAccount[],
  categories: Category[],
  initialSkipped: number,
  onProgress?: ProgressCallback
): Promise<{ results: ProcessResult[]; counters: SyncCounters }> {
  const counters: SyncCounters = {
    processed: 0,
    errors: 0,
    skipped: initialSkipped,
    completed: 0,
  };

  const total = emails.length;
  const limit = pLimit(CONCURRENCY_LIMIT);

  const reportProgress = (
    status: "processed" | "skipped" | "error",
    errorMessage?: string
  ) => {
    counters.completed++;
    if (status === "processed") counters.processed++;
    else if (status === "skipped") counters.skipped++;
    else if (status === "error") counters.errors++;

    onProgress?.(counters, total, status, errorMessage);
  };

  const results = await Promise.all(
    emails.map((emailData) =>
      limit(async (): Promise<ProcessResult> => {
        try {
          const bodyText = cleanEmailBody(emailData.body);

          // AI call: classify + summarize
          const { categoryId, summary } = await classifyAndSummarizeEmail(
            { ...emailData, body: bodyText },
            categories
          );

          // If regex didn't find unsubscribe link, try AI extraction
          let finalUnsubscribeLink = emailData.unsubscribeLink;
          if (!finalUnsubscribeLink) {
            finalUnsubscribeLink = await extractUnsubscribeLinkAI(emailData.body);
          }

          // Use upsert to handle race conditions
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
                unsubscribeLink: finalUnsubscribeLink,
                receivedAt: emailData.receivedAt,
                isArchived: true,
              },
              update: {},
            });
          } catch (upsertError) {
            // P2002 = unique constraint violation - email already exists
            if (
              upsertError instanceof Error &&
              "code" in upsertError &&
              (upsertError as { code: string }).code === "P2002"
            ) {
              reportProgress("skipped");
              return { emailData, success: false };
            }
            throw upsertError;
          }

          reportProgress("processed");
          return { emailData, success: true };
        } catch (error) {
          console.error(
            `Error processing email ${emailData.gmailId} (${emailData.subject}):`,
            error
          );
          reportProgress(
            "error",
            error instanceof Error ? error.message : String(error)
          );
          return { emailData, success: false };
        }
      })
    )
  );

  return { results, counters };
}

/**
 * Batch archive successfully processed emails grouped by account
 */
export async function batchArchiveEmails(
  results: ProcessResult[]
): Promise<void> {
  const successfulByAccount = new Map<string, string[]>();

  for (const result of results) {
    if (result.success) {
      const existing =
        successfulByAccount.get(result.emailData.accountId) || [];
      existing.push(result.emailData.gmailId);
      successfulByAccount.set(result.emailData.accountId, existing);
    }
  }

  await Promise.all(
    Array.from(successfulByAccount.entries()).map(([accountId, gmailIds]) =>
      archiveEmails(accountId, gmailIds)
    )
  );
}

/**
 * Update lastSyncedAt for accounts
 */
export async function updateAccountSyncTime(
  accountIds: string[]
): Promise<void> {
  const now = new Date();
  await Promise.all(
    accountIds.map((accountId) =>
      prisma.account.update({
        where: { id: accountId },
        data: { lastSyncedAt: now },
      })
    )
  );
}

/**
 * Get categories for a user
 */
export async function getUserCategories(userId: string): Promise<Category[]> {
  return prisma.category.findMany({
    where: { userId },
  });
}
