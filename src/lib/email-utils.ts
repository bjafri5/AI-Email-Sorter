import { load } from "cheerio";
import { gmail_v1 } from "googleapis";

/**
 * Clean email body by removing HTML and excessive whitespace
 */
export function cleanEmailBody(body: string): string {
  const hasHtml = /<[^>]+>/.test(body);

  if (hasHtml) {
    const $ = load(body);

    // Remove unwanted elements
    $("style, script, img").remove();

    // Get text content
    const plainText = $("body").text() || $.root().text();

    return cleanWhitespace(plainText);
  }

  return cleanWhitespace(body);
}

/**
 * Remove excessive whitespace and normalize text
 */
function cleanWhitespace(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

/**
 * Extract email from "Name <email@example.com>" format
 */
export function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

/**
 * Extract name from "Name <email@example.com>" format
 */
export function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*</);
  return match ? match[1].replace(/"/g, "").trim() : "";
}

/**
 * Extract body from multipart message - prefer HTML for display
 */
export function extractBodyFromParts(
  parts: gmail_v1.Schema$MessagePart[]
): string {
  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      plainText = Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.mimeType === "text/html" && part.body?.data) {
      htmlText = Buffer.from(part.body.data, "base64").toString("utf-8");
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts);
      if (nested) {
        // Check if nested result is HTML
        if (nested.includes("<") && nested.includes(">")) {
          htmlText = nested;
        } else if (!plainText) {
          plainText = nested;
        }
      }
    }
  }

  // Prefer HTML for display, fall back to plain text
  return htmlText || plainText;
}

/**
 * Fast cheerio-based unsubscribe link extraction (no AI)
 * Used during fetch phase for speed
 */
export function extractUnsubscribeLinkFast(body: string): string | null {
  const $ = load(body);

  // Helper function to search for a keyword in link text
  const searchForKeyword = (keyword: RegExp): string | null => {
    let foundLink: string | null = null;

    $("a").each((_, el) => {
      if (foundLink) return; // already found

      const text = $(el).text().toLowerCase();
      const href = $(el).attr("href");

      if (href && keyword.test(text) && !href.startsWith("mailto:")) {
        foundLink = href;
      }
    });

    return foundLink;
  };

  // First check for "unsubscribe"
  const unsubscribeLink = searchForKeyword(/unsubscribe/);
  if (unsubscribeLink) {
    return unsubscribeLink;
  }

  // Then check for "opt out" / "opt-out" / "optout"
  const optOutLink = searchForKeyword(/opt[\s-]?out/);
  if (optOutLink) {
    return optOutLink;
  }

  // Return null - caller should fall back to AI extraction if needed
  return null;
}
