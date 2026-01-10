import { convert } from "html-to-text";

/**
 * Clean email body by removing HTML and excessive whitespace
 */
export function cleanEmailBody(body: string): string {
  // Check if body contains HTML
  const hasHtml = /<[^>]+>/.test(body);

  if (hasHtml) {
    // Convert HTML to plain text
    const plainText = convert(body, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "script", format: "skip" },
      ],
    });

    return cleanWhitespace(plainText);
  }

  // If not HTML, just clean whitespace
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
