import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

const shouldRunIntegration = !!process.env.DATABASE_URL;

describe.skipIf(!shouldRunIntegration)("Database Integration Tests", () => {
  // Test data IDs for cleanup
  let testUserId: string;
  let testAccountId: string;
  let testCategoryId: string;
  let testEmailId: string;

  const testPrefix = `test_${Date.now()}`;

  beforeAll(async () => {
    // Create a test user
    const user = await prisma.user.create({
      data: {
        email: `${testPrefix}@test.com`,
        name: "Test User",
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    // Clean up all test data in reverse order of dependencies
    if (testEmailId) {
      await prisma.email.delete({ where: { id: testEmailId } }).catch(() => {});
    }
    if (testCategoryId) {
      await prisma.category.delete({ where: { id: testCategoryId } }).catch(() => {});
    }
    if (testAccountId) {
      await prisma.account.delete({ where: { id: testAccountId } }).catch(() => {});
    }
    if (testUserId) {
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    }
  });

  describe("User operations", () => {
    it("creates a user with required fields", async () => {
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
      });

      expect(user).not.toBeNull();
      expect(user?.email).toBe(`${testPrefix}@test.com`);
      expect(user?.name).toBe("Test User");
    });

    it("enforces unique email constraint", async () => {
      await expect(
        prisma.user.create({
          data: {
            email: `${testPrefix}@test.com`, // Duplicate
            name: "Duplicate User",
          },
        })
      ).rejects.toThrow();
    });
  });

  describe("Account operations", () => {
    it("creates an account linked to user", async () => {
      const account = await prisma.account.create({
        data: {
          userId: testUserId,
          provider: "google",
          providerAccountId: `${testPrefix}_provider_id`,
          type: "oauth",
          access_token: "test_access_token",
          refresh_token: "test_refresh_token",
          email: `${testPrefix}@gmail.com`,
        },
      });
      testAccountId = account.id;

      expect(account).not.toBeNull();
      expect(account.userId).toBe(testUserId);
      expect(account.provider).toBe("google");
    });

    it("retrieves account with user relation", async () => {
      const account = await prisma.account.findUnique({
        where: { id: testAccountId },
        include: { user: true },
      });

      expect(account?.user).not.toBeNull();
      expect(account?.user.id).toBe(testUserId);
    });

    it("updates lastSyncedAt timestamp", async () => {
      const now = new Date();
      const updated = await prisma.account.update({
        where: { id: testAccountId },
        data: { lastSyncedAt: now },
      });

      expect(updated.lastSyncedAt).toEqual(now);
    });
  });

  describe("Category operations", () => {
    it("creates a category for user", async () => {
      const category = await prisma.category.create({
        data: {
          userId: testUserId,
          name: "Test Category",
          description: "A test category for integration tests",
        },
      });
      testCategoryId = category.id;

      expect(category).not.toBeNull();
      expect(category.name).toBe("Test Category");
      expect(category.userId).toBe(testUserId);
    });

    it("retrieves categories with email count", async () => {
      const categories = await prisma.category.findMany({
        where: { userId: testUserId },
        include: {
          _count: {
            select: { emails: true },
          },
        },
      });

      expect(categories.length).toBeGreaterThan(0);
      expect(categories[0]._count.emails).toBe(0);
    });
  });

  describe("Email operations", () => {
    it("creates an email with account and category", async () => {
      const email = await prisma.email.create({
        data: {
          gmailId: `${testPrefix}_gmail_id`,
          accountId: testAccountId,
          categoryId: testCategoryId,
          subject: "Test Email Subject",
          fromEmail: "sender@example.com",
          fromName: "Test Sender",
          body: "<p>Test email body</p>",
          bodyText: "Test email body",
          snippet: "Test email...",
          receivedAt: new Date(),
        },
      });
      testEmailId = email.id;

      expect(email).not.toBeNull();
      expect(email.subject).toBe("Test Email Subject");
      expect(email.categoryId).toBe(testCategoryId);
    });

    it("enforces unique gmailId constraint", async () => {
      await expect(
        prisma.email.create({
          data: {
            gmailId: `${testPrefix}_gmail_id`, // Duplicate
            accountId: testAccountId,
            subject: "Duplicate Email",
            fromEmail: "sender@example.com",
            body: "Duplicate",
            receivedAt: new Date(),
          },
        })
      ).rejects.toThrow();
    });

    it("retrieves email with category relation", async () => {
      const email = await prisma.email.findUnique({
        where: { id: testEmailId },
        include: { category: true },
      });

      expect(email?.category).not.toBeNull();
      expect(email?.category?.name).toBe("Test Category");
    });

    it("updates unsubscribe status", async () => {
      const updated = await prisma.email.update({
        where: { id: testEmailId },
        data: {
          unsubscribeStatus: "success",
          unsubscribedAt: new Date(),
          unsubscribeAttempts: 1,
        },
      });

      expect(updated.unsubscribeStatus).toBe("success");
      expect(updated.unsubscribeAttempts).toBe(1);
      expect(updated.unsubscribedAt).not.toBeNull();
    });

    it("updates category count after email creation", async () => {
      const category = await prisma.category.findUnique({
        where: { id: testCategoryId },
        include: {
          _count: {
            select: { emails: true },
          },
        },
      });

      expect(category?._count.emails).toBe(1);
    });
  });

  describe("Cascade delete behavior", () => {
    it("sets categoryId to null when category is deleted (SetNull)", async () => {
      // Create a temporary category
      const tempCategory = await prisma.category.create({
        data: {
          userId: testUserId,
          name: "Temp Category",
          description: "Will be deleted",
        },
      });

      // Create an email in that category
      const tempEmail = await prisma.email.create({
        data: {
          gmailId: `${testPrefix}_temp_gmail_id`,
          accountId: testAccountId,
          categoryId: tempCategory.id,
          subject: "Temp Email",
          fromEmail: "temp@example.com",
          body: "Temp body",
          receivedAt: new Date(),
        },
      });

      // Delete the category
      await prisma.category.delete({ where: { id: tempCategory.id } });

      // Verify email still exists but categoryId is null
      const email = await prisma.email.findUnique({
        where: { id: tempEmail.id },
      });

      expect(email).not.toBeNull();
      expect(email?.categoryId).toBeNull();

      // Cleanup
      await prisma.email.delete({ where: { id: tempEmail.id } });
    });
  });
});
