import { describe, it, expect } from "vitest";

import {
  extractUnsubscribeLinkFast,
  extractEmail,
  extractName,
  extractBodyFromParts,
} from "@/lib/email-utils";

describe("extractUnsubscribeLinkFast", () => {
  describe("anchor tag extraction", () => {
    it('extracts link from anchor tag with "unsubscribe" text', () => {
      const body =
        '<p>Not interested? <a href="https://example.com/unsub">Unsubscribe here</a></p>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/unsub");
    });

    it("handles case-insensitive matching", () => {
      const body = '<a href="https://example.com/unsub">UNSUBSCRIBE</a>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/unsub");
    });

    it("skips mailto: links and returns null", () => {
      const body = '<a href="mailto:unsub@example.com">Unsubscribe</a>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBeNull();
    });

    it("decodes HTML entities in URLs via cheerio", () => {
      const body =
        '<a href="https://example.com/unsub?a=1&amp;b=2">Unsubscribe</a>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/unsub?a=1&b=2");
    });

    it("only matches when unsubscribe is in link text, not surrounding text", () => {
      const body =
        '<p>To unsubscribe, <a href="https://example.com/unsub">click here</a></p>';
      const result = extractUnsubscribeLinkFast(body);
      // "click here" doesn't contain "unsubscribe", so no match
      expect(result).toBeNull();
    });
  });

  describe("opt-out pattern extraction", () => {
    it("extracts opt-out links", () => {
      const body =
        '<p><a href="https://example.com/optout">Opt out of emails</a></p>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/optout");
    });

    it("extracts opt-out with hyphen", () => {
      const body = '<a href="https://example.com/optout">Opt-out here</a>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/optout");
    });

    it("extracts optout without space", () => {
      const body = '<a href="https://example.com/optout">Optout of all</a>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/optout");
    });

    it("prefers unsubscribe over opt-out when both present", () => {
      const body = `
        <a href="https://example.com/optout">Opt out</a>
        <a href="https://example.com/unsub">Unsubscribe</a>
      `;
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/unsub");
    });
  });

  describe("edge cases", () => {
    it("handles empty body", () => {
      const result = extractUnsubscribeLinkFast("");
      expect(result).toBeNull();
    });

    it("handles body with no anchor tags", () => {
      const body = "<p>This is a plain text email with no links.</p>";
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBeNull();
    });

    it("handles multiple unsubscribe links (returns first)", () => {
      const body = `
        <a href="https://first.com/unsub">Unsubscribe</a>
        <a href="https://second.com/unsub">Unsubscribe from all</a>
      `;
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://first.com/unsub");
    });

    it("handles nested HTML structures", () => {
      const body = `
        <div>
          <table>
            <tr>
              <td>
                <a href="https://example.com/unsub">
                  <span>Unsubscribe</span>
                </a>
              </td>
            </tr>
          </table>
        </div>
      `;
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/unsub");
    });

    it("handles links with extra whitespace in text", () => {
      const body =
        '<a href="https://example.com/unsub">  Unsubscribe  </a>';
      const result = extractUnsubscribeLinkFast(body);
      expect(result).toBe("https://example.com/unsub");
    });
  });
});

describe("extractEmail", () => {
  it('extracts email from "Name <email>" format', () => {
    expect(extractEmail("John Doe <john@example.com>")).toBe(
      "john@example.com"
    );
  });

  it("extracts email from quoted name format", () => {
    expect(extractEmail('"John Doe" <john@example.com>')).toBe(
      "john@example.com"
    );
  });

  it("returns original string when no angle brackets", () => {
    expect(extractEmail("john@example.com")).toBe("john@example.com");
  });

  it("handles empty string", () => {
    expect(extractEmail("")).toBe("");
  });

  it("handles name with special characters", () => {
    expect(extractEmail('John "The Man" Doe <john@example.com>')).toBe(
      "john@example.com"
    );
  });

  it("handles email-only without name", () => {
    expect(extractEmail("<john@example.com>")).toBe("john@example.com");
  });
});

describe("extractName", () => {
  it('extracts name from "Name <email>" format', () => {
    expect(extractName("John Doe <john@example.com>")).toBe("John Doe");
  });

  it("extracts name and removes quotes", () => {
    expect(extractName('"John Doe" <john@example.com>')).toBe("John Doe");
  });

  it("returns empty string when no name before angle bracket", () => {
    expect(extractName("<john@example.com>")).toBe("");
  });

  it("returns empty string for email-only format", () => {
    expect(extractName("john@example.com")).toBe("");
  });

  it("handles empty string", () => {
    expect(extractName("")).toBe("");
  });

  it("trims whitespace from name", () => {
    expect(extractName("  John Doe  <john@example.com>")).toBe("John Doe");
  });

  it("handles name with multiple spaces", () => {
    expect(extractName("John  Doe <john@example.com>")).toBe("John  Doe");
  });
});

describe("extractBodyFromParts", () => {
  // Helper to encode string to base64
  const toBase64 = (str: string) => Buffer.from(str).toString("base64");

  it("extracts plain text from single part", () => {
    const parts = [
      {
        mimeType: "text/plain",
        body: { data: toBase64("Hello, World!") },
      },
    ];
    expect(extractBodyFromParts(parts)).toBe("Hello, World!");
  });

  it("extracts HTML from single part", () => {
    const html = "<p>Hello, World!</p>";
    const parts = [
      {
        mimeType: "text/html",
        body: { data: toBase64(html) },
      },
    ];
    expect(extractBodyFromParts(parts)).toBe(html);
  });

  it("prefers HTML over plain text when both present", () => {
    const html = "<p>HTML Content</p>";
    const parts = [
      {
        mimeType: "text/plain",
        body: { data: toBase64("Plain Content") },
      },
      {
        mimeType: "text/html",
        body: { data: toBase64(html) },
      },
    ];
    expect(extractBodyFromParts(parts)).toBe(html);
  });

  it("falls back to plain text when no HTML", () => {
    const parts = [
      {
        mimeType: "text/plain",
        body: { data: toBase64("Plain Content") },
      },
      {
        mimeType: "application/pdf",
        body: { data: toBase64("PDF data") },
      },
    ];
    expect(extractBodyFromParts(parts)).toBe("Plain Content");
  });

  it("handles nested multipart structure", () => {
    const html = "<p>Nested HTML</p>";
    const parts = [
      {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: toBase64("Nested Plain") },
          },
          {
            mimeType: "text/html",
            body: { data: toBase64(html) },
          },
        ],
      },
    ];
    expect(extractBodyFromParts(parts)).toBe(html);
  });

  it("returns empty string when no text parts found", () => {
    const parts = [
      {
        mimeType: "image/png",
        body: { data: toBase64("image data") },
      },
    ];
    expect(extractBodyFromParts(parts)).toBe("");
  });

  it("handles empty parts array", () => {
    expect(extractBodyFromParts([])).toBe("");
  });

  it("handles parts with missing body data", () => {
    const parts = [
      {
        mimeType: "text/plain",
        body: {},
      },
      {
        mimeType: "text/html",
        body: { data: toBase64("<p>Content</p>") },
      },
    ];
    expect(extractBodyFromParts(parts)).toBe("<p>Content</p>");
  });
});
