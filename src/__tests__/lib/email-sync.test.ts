import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    email: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/gmail", () => ({
  fetchNewEmails: vi.fn(),
  archiveEmails: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  classifyAndSummarizeEmail: vi.fn(),
}));

vi.mock("@/lib/email-utils", () => ({
  cleanEmailBody: vi.fn((body) => body.replace(/<[^>]+>/g, "")),
}));

vi.mock("p-limit", () => ({
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

import { prisma } from "@/lib/prisma";
import { fetchNewEmails, archiveEmails } from "@/lib/gmail";
import { classifyAndSummarizeEmail } from "@/lib/ai";
import {
  fetchEmailsForUser,
  filterExistingEmails,
  processEmailsInParallel,
  batchArchiveEmails,
  updateAccountSyncTime,
  getUserCategories,
} from "@/lib/email-sync";

describe("email-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchEmailsForUser", () => {
    it("fetches emails from all accounts", async () => {
      vi.mocked(prisma.account.findMany).mockResolvedValue([
        { id: "acc1", email: "user1@example.com", userId: "user1" },
        { id: "acc2", email: "user2@example.com", userId: "user1" },
      ] as never);

      vi.mocked(fetchNewEmails).mockResolvedValue([
        {
          gmailId: "gmail1",
          threadId: "thread1",
          subject: "Test Email",
          fromEmail: "sender@example.com",
          fromName: "Sender",
          snippet: "Test snippet",
          body: "<p>Test body</p>",
          receivedAt: new Date(),
          unsubscribeLink: null,
        },
      ]);

      const { emails, accountIds } = await fetchEmailsForUser("user1", 10);

      expect(accountIds).toHaveLength(2);
      expect(emails).toHaveLength(2); // 1 email per account
      expect(fetchNewEmails).toHaveBeenCalledTimes(2);
    });

    it("returns empty when no accounts", async () => {
      vi.mocked(prisma.account.findMany).mockResolvedValue([]);

      const { emails, accountIds } = await fetchEmailsForUser("user1");

      expect(emails).toHaveLength(0);
      expect(accountIds).toHaveLength(0);
    });

    it("handles fetch errors gracefully per account", async () => {
      vi.mocked(prisma.account.findMany).mockResolvedValue([
        { id: "acc1", email: "user1@example.com", userId: "user1" },
        { id: "acc2", email: "user2@example.com", userId: "user1" },
      ] as never);

      vi.mocked(fetchNewEmails)
        .mockRejectedValueOnce(new Error("Gmail API error"))
        .mockResolvedValueOnce([
          {
            gmailId: "gmail2",
            threadId: "thread2",
            subject: "Test Email 2",
            fromEmail: "sender@example.com",
            fromName: "Sender",
            snippet: "Test snippet",
            body: "Test body",
            receivedAt: new Date(),
            unsubscribeLink: null,
          },
        ]);

      const { emails, accountIds } = await fetchEmailsForUser("user1");

      expect(accountIds).toHaveLength(2);
      expect(emails).toHaveLength(1); // Only successful account's emails
    });
  });

  describe("filterExistingEmails", () => {
    it("filters out existing emails", async () => {
      const emails = [
        { gmailId: "gmail1", accountId: "acc1" },
        { gmailId: "gmail2", accountId: "acc1" },
        { gmailId: "gmail3", accountId: "acc1" },
      ] as never;

      vi.mocked(prisma.email.findMany).mockResolvedValue([
        { gmailId: "gmail1" },
        { gmailId: "gmail3" },
      ] as never);

      const { newEmails, skippedCount } = await filterExistingEmails(emails);

      expect(newEmails).toHaveLength(1);
      expect(newEmails[0].gmailId).toBe("gmail2");
      expect(skippedCount).toBe(2);
    });

    it("returns all emails when none exist", async () => {
      const emails = [
        { gmailId: "gmail1", accountId: "acc1" },
        { gmailId: "gmail2", accountId: "acc1" },
      ] as never;

      vi.mocked(prisma.email.findMany).mockResolvedValue([]);

      const { newEmails, skippedCount } = await filterExistingEmails(emails);

      expect(newEmails).toHaveLength(2);
      expect(skippedCount).toBe(0);
    });

    it("handles empty input", async () => {
      const { newEmails, skippedCount } = await filterExistingEmails([]);

      expect(newEmails).toHaveLength(0);
      expect(skippedCount).toBe(0);
      expect(prisma.email.findMany).not.toHaveBeenCalled();
    });
  });

  describe("processEmailsInParallel", () => {
    const mockEmail = {
      gmailId: "gmail1",
      threadId: "thread1",
      accountId: "acc1",
      subject: "Test Email",
      fromEmail: "sender@example.com",
      fromName: "Sender",
      snippet: "Test snippet",
      body: "<p>Test body</p>",
      receivedAt: new Date(),
      unsubscribeLink: "https://example.com/unsub",
    };

    const mockCategories = [
      { id: "cat1", name: "Newsletters", description: "News" },
    ];

    it("processes emails and reports progress", async () => {
      vi.mocked(classifyAndSummarizeEmail).mockResolvedValue({
        categoryId: "cat1",
        summary: "Test summary",
      });
      vi.mocked(prisma.email.upsert).mockResolvedValue({ id: "email1" } as never);

      const progressCalls: unknown[] = [];
      const onProgress = vi.fn((...args) => progressCalls.push(args));

      const { results, counters } = await processEmailsInParallel(
        [mockEmail],
        mockCategories,
        0,
        onProgress
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(counters.processed).toBe(1);
      expect(counters.errors).toBe(0);
      expect(onProgress).toHaveBeenCalledTimes(1);
    });

    it("handles classification errors gracefully", async () => {
      vi.mocked(classifyAndSummarizeEmail).mockRejectedValue(
        new Error("AI error")
      );

      const { results, counters } = await processEmailsInParallel(
        [mockEmail],
        mockCategories,
        0
      );

      expect(results[0].success).toBe(false);
      expect(counters.processed).toBe(0);
      expect(counters.errors).toBe(1);
    });

    it("handles duplicate emails (P2002 error)", async () => {
      vi.mocked(classifyAndSummarizeEmail).mockResolvedValue({
        categoryId: "cat1",
        summary: "Test summary",
      });

      const p2002Error = new Error("Unique constraint") as Error & {
        code: string;
      };
      p2002Error.code = "P2002";
      vi.mocked(prisma.email.upsert).mockRejectedValue(p2002Error);

      const { results, counters } = await processEmailsInParallel(
        [mockEmail],
        mockCategories,
        0
      );

      expect(results[0].success).toBe(false);
      expect(counters.skipped).toBe(1);
      expect(counters.processed).toBe(0);
    });

    it("tracks initial skipped count", async () => {
      vi.mocked(classifyAndSummarizeEmail).mockResolvedValue({
        categoryId: "cat1",
        summary: "Test summary",
      });
      vi.mocked(prisma.email.upsert).mockResolvedValue({ id: "email1" } as never);

      const { counters } = await processEmailsInParallel(
        [mockEmail],
        mockCategories,
        5 // Initial skipped
      );

      expect(counters.skipped).toBe(5);
      expect(counters.processed).toBe(1);
    });
  });

  describe("batchArchiveEmails", () => {
    it("archives emails grouped by account", async () => {
      vi.mocked(archiveEmails).mockResolvedValue(undefined);

      const results = [
        {
          emailData: { gmailId: "gmail1", accountId: "acc1" },
          success: true,
        },
        {
          emailData: { gmailId: "gmail2", accountId: "acc1" },
          success: true,
        },
        {
          emailData: { gmailId: "gmail3", accountId: "acc2" },
          success: true,
        },
        {
          emailData: { gmailId: "gmail4", accountId: "acc1" },
          success: false,
        },
      ] as never;

      await batchArchiveEmails(results);

      expect(archiveEmails).toHaveBeenCalledTimes(2);
      expect(archiveEmails).toHaveBeenCalledWith("acc1", ["gmail1", "gmail2"]);
      expect(archiveEmails).toHaveBeenCalledWith("acc2", ["gmail3"]);
    });

    it("handles no successful results", async () => {
      const results = [
        {
          emailData: { gmailId: "gmail1", accountId: "acc1" },
          success: false,
        },
      ] as never;

      await batchArchiveEmails(results);

      expect(archiveEmails).not.toHaveBeenCalled();
    });
  });

  describe("updateAccountSyncTime", () => {
    it("updates sync time for all accounts", async () => {
      vi.mocked(prisma.account.update).mockResolvedValue({} as never);

      await updateAccountSyncTime(["acc1", "acc2"]);

      expect(prisma.account.update).toHaveBeenCalledTimes(2);
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: "acc1" },
        data: { lastSyncedAt: expect.any(Date) },
      });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: "acc2" },
        data: { lastSyncedAt: expect.any(Date) },
      });
    });
  });

  describe("getUserCategories", () => {
    it("returns categories for user", async () => {
      const categories = [
        { id: "cat1", name: "Newsletters", description: "News" },
      ];
      vi.mocked(prisma.category.findMany).mockResolvedValue(categories as never);

      const result = await getUserCategories("user1");

      expect(result).toEqual(categories);
      expect(prisma.category.findMany).toHaveBeenCalledWith({
        where: { userId: "user1" },
      });
    });

    it("returns empty array when no categories", async () => {
      vi.mocked(prisma.category.findMany).mockResolvedValue([]);

      const result = await getUserCategories("user1");

      expect(result).toHaveLength(0);
    });
  });
});
