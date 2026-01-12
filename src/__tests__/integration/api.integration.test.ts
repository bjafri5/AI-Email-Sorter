import { describe, it, expect, beforeAll } from "vitest";

// Check if server is running by attempting to connect
async function isServerRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("API Integration Tests", () => {
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await isServerRunning(BASE_URL);
    if (!serverAvailable) {
      console.log(`Server not running at ${BASE_URL} - skipping API integration tests`);
    }
  });

  describe("Health endpoint", () => {
    it("returns healthy status when database is connected", async () => {
      if (!serverAvailable) {
        console.log("Skipping: server not available");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("healthy");
      expect(data.checks.database).toBe("connected");
      expect(data.timestamp).toBeDefined();
    });

    it("returns valid ISO timestamp", async () => {
      if (!serverAvailable) {
        console.log("Skipping: server not available");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/health`);
      const data = await response.json();

      const timestamp = new Date(data.timestamp);
      expect(timestamp.toString()).not.toBe("Invalid Date");

      // Timestamp should be recent (within last minute)
      const now = new Date();
      const diffMs = now.getTime() - timestamp.getTime();
      expect(diffMs).toBeLessThan(60000);
    });
  });

  describe("Protected endpoints (without auth)", () => {
    it("returns 401 for /api/categories without session", async () => {
      if (!serverAvailable) {
        console.log("Skipping: server not available");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/categories`);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 for /api/categories/[id] without session", async () => {
      if (!serverAvailable) {
        console.log("Skipping: server not available");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/categories/some-id`);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 for POST /api/categories without session", async () => {
      if (!serverAvailable) {
        console.log("Skipping: server not available");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test", description: "Test category" }),
      });

      expect(response.status).toBe(401);
    });

    it("returns 401 for DELETE /api/categories/[id] without session", async () => {
      if (!serverAvailable) {
        console.log("Skipping: server not available");
        return;
      }

      const response = await fetch(`${BASE_URL}/api/categories/some-id`, {
        method: "DELETE",
      });

      expect(response.status).toBe(401);
    });
  });
});
