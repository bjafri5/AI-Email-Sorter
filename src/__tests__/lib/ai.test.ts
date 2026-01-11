import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock OpenAI
vi.mock("@/lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

import { openai } from "@/lib/openai";
import {
  classifyEmail,
  classifyAndSummarizeEmail,
  extractUnsubscribeLinkAI,
} from "@/lib/ai";

const mockCategories = [
  {
    id: "cat1",
    name: "Newsletters",
    description: "Email newsletters and digests",
  },
  {
    id: "cat2",
    name: "Promotions",
    description: "Marketing and promotional emails",
  },
  { id: "cat3", name: "Services", description: "Service notifications and alerts" },
];

const mockEmail = {
  subject: "Weekly Tech Digest",
  fromEmail: "newsletter@example.com",
  fromName: "Tech News",
  body: "Here are this week's top stories in tech...",
  snippet: "Top stories...",
};

describe("classifyEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct category ID when AI returns valid number", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "1" } }],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBe("cat1");
  });

  it("returns second category when AI returns 2", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "2" } }],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBe("cat2");
  });

  it("returns null when AI returns 0 (no match)", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "0" } }],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBeNull();
  });

  it("returns null when AI returns invalid text", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "invalid response" } }],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBeNull();
  });

  it("returns null when AI returns number out of range", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "10" } }],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBeNull();
  });

  it("returns null when categories array is empty", async () => {
    const result = await classifyEmail(mockEmail, []);
    expect(result).toBeNull();
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it("returns null on API error", async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(
      new Error("API error")
    );

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBeNull();
  });

  it("truncates long email body in prompt", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "1" } }],
    } as never);

    const longBodyEmail = { ...mockEmail, body: "x".repeat(10000) };
    await classifyEmail(longBodyEmail, mockCategories);

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0];
    const prompt = (call[0] as { messages: { content: string }[] }).messages[0]
      .content;
    // Body should be truncated to 5000 chars
    expect(prompt.length).toBeLessThan(10000);
  });

  it("uses fromEmail when fromName is null", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "1" } }],
    } as never);

    const emailNoName = { ...mockEmail, fromName: null };
    await classifyEmail(emailNoName, mockCategories);

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0];
    const prompt = (call[0] as { messages: { content: string }[] }).messages[0]
      .content;
    expect(prompt).toContain(`From: ${mockEmail.fromEmail}`);
  });

  it("handles malformed API response with missing choices", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBeNull();
  });

  it("handles malformed API response with null message content", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: null } }],
    } as never);

    const result = await classifyEmail(mockEmail, mockCategories);
    expect(result).toBeNull();
  });
});

describe("classifyAndSummarizeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns category and summary from valid response", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [
        {
          message: {
            content: "CATEGORY: 1\nSUMMARY: Weekly tech newsletter",
          },
        },
      ],
    } as never);

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBe("cat1");
    expect(result.summary).toBe("Weekly tech newsletter");
  });

  it("returns second category when AI returns 2", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [
        {
          message: {
            content: "CATEGORY: 2\nSUMMARY: Promotional offer from store",
          },
        },
      ],
    } as never);

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBe("cat2");
    expect(result.summary).toBe("Promotional offer from store");
  });

  it("returns null categoryId when category is 0", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [
        {
          message: {
            content: "CATEGORY: 0\nSUMMARY: Uncategorized email",
          },
        },
      ],
    } as never);

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBeNull();
    expect(result.summary).toBe("Uncategorized email");
  });

  it("returns fallback summary when parsing fails", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "completely invalid response" } }],
    } as never);

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBeNull();
    expect(result.summary).toBe(mockEmail.snippet);
  });

  it("returns snippet as fallback summary when no categories", async () => {
    const result = await classifyAndSummarizeEmail(mockEmail, []);
    expect(result.categoryId).toBeNull();
    expect(result.summary).toBe(mockEmail.snippet);
    expect(openai.chat.completions.create).not.toHaveBeenCalled();
  });

  it("returns subject as fallback when snippet is null", async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(
      new Error("API error")
    );

    const emailNoSnippet = { ...mockEmail, snippet: null };
    const result = await classifyAndSummarizeEmail(
      emailNoSnippet,
      mockCategories
    );
    expect(result.summary).toBe(mockEmail.subject);
  });

  it("handles API errors gracefully", async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(
      new Error("API error")
    );

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBeNull();
    expect(result.summary).toBe(mockEmail.snippet);
  });

  it("handles category out of range", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [
        {
          message: {
            content: "CATEGORY: 10\nSUMMARY: Some summary",
          },
        },
      ],
    } as never);

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBeNull();
    expect(result.summary).toBe("Some summary");
  });

  it("handles multiline summaries", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [
        {
          message: {
            content:
              "CATEGORY: 1\nSUMMARY: This is a longer summary that spans multiple lines.",
          },
        },
      ],
    } as never);

    const result = await classifyAndSummarizeEmail(mockEmail, mockCategories);
    expect(result.categoryId).toBe("cat1");
    expect(result.summary).toBe(
      "This is a longer summary that spans multiple lines."
    );
  });
});

describe("extractUnsubscribeLinkAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts valid https unsubscribe link", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "https://example.com/unsubscribe" } }],
    } as never);

    const result = await extractUnsubscribeLinkAI(
      '<html><a href="https://example.com/unsubscribe">Unsubscribe</a></html>'
    );
    expect(result).toBe("https://example.com/unsubscribe");
  });

  it("extracts valid http unsubscribe link", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "http://example.com/unsub" } }],
    } as never);

    const result = await extractUnsubscribeLinkAI(
      '<html><a href="http://example.com/unsub">Opt out</a></html>'
    );
    expect(result).toBe("http://example.com/unsub");
  });

  it("returns null when AI returns NONE", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "NONE" } }],
    } as never);

    const result = await extractUnsubscribeLinkAI("<html>No links here</html>");
    expect(result).toBeNull();
  });

  it("returns null when AI returns mailto link", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "mailto:unsub@example.com" } }],
    } as never);

    const result = await extractUnsubscribeLinkAI(
      '<html><a href="mailto:unsub@example.com">Unsubscribe</a></html>'
    );
    expect(result).toBeNull();
  });

  it("returns null when AI returns empty response", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "" } }],
    } as never);

    const result = await extractUnsubscribeLinkAI("<html>Email content</html>");
    expect(result).toBeNull();
  });

  it("returns null on API error", async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(
      new Error("API error")
    );

    const result = await extractUnsubscribeLinkAI("<html>Email content</html>");
    expect(result).toBeNull();
  });

  it("truncates long email body to last 10000 chars", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue({
      choices: [{ message: { content: "https://example.com/unsub" } }],
    } as never);

    const longBody = "x".repeat(20000) + '<a href="https://example.com/unsub">Unsubscribe</a>';
    await extractUnsubscribeLinkAI(longBody);

    const call = vi.mocked(openai.chat.completions.create).mock.calls[0];
    const prompt = (call[0] as { messages: { content: string }[] }).messages[0].content;
    // Should only include last 10000 chars plus prompt text
    expect(prompt.length).toBeLessThan(15000);
  });
});

