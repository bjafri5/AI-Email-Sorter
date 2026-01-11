import { google } from "googleapis";
import { gmail_v1 } from "googleapis";
import { prisma } from "./prisma";
import pLimit from "p-limit";

// Concurrency limit for fetching email details
const FETCH_CONCURRENCY = 10;

// Create OAuth2 client
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
}

// Get Gmail client for a specific account
export async function getGmailClient(accountId: string) {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error("Account not found");
  }

  const oauth2Client = getOAuth2Client();

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });

  // Handle token refresh
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.account.update({
        where: { id: accountId },
        data: {
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : null,
        },
      });
    }
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

// Fetch unread emails from inbox (parallelized)
export async function fetchNewEmails(accountId: string, maxResults = 10) {
  const gmail = await getGmailClient(accountId);

  const response = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults,
  });

  const messages = response.data.messages || [];

  // Fetch email details in parallel with concurrency limit
  const limit = pLimit(FETCH_CONCURRENCY);
  const emailPromises = messages.map((message) =>
    limit(() => getEmailDetails(gmail, message.id!))
  );

  const results = await Promise.all(emailPromises);
  return results.filter((email) => email !== null);
}

// Get full email details
async function getEmailDetails(gmail: gmail_v1.Gmail, messageId: string) {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const message = response.data;
  const headers = message.payload?.headers || [];

  const getHeader = (name: string) =>
    headers.find(
      (h: gmail_v1.Schema$MessagePartHeader) =>
        h.name?.toLowerCase() === name.toLowerCase()
    )?.value || "";

  // Extract body
  let body = "";
  if (message.payload?.body?.data) {
    body = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
  } else if (message.payload?.parts) {
    body = extractBodyFromParts(message.payload.parts);
  }

  // Extract unsubscribe link using regex only (no AI during fetch phase)
  const unsubscribeHeader = getHeader("List-Unsubscribe");
  const unsubscribeLink = extractUnsubscribeLinkFast(unsubscribeHeader, body);

  return {
    gmailId: message.id!,
    threadId: message.threadId,
    subject: getHeader("Subject") || "(No Subject)",
    fromEmail: extractEmail(getHeader("From")),
    fromName: extractName(getHeader("From")),
    snippet: message.snippet || "",
    body,
    unsubscribeLink,
    receivedAt: new Date(parseInt(message.internalDate!)),
  };
}

// Extract body from multipart message - prefer HTML for display
function extractBodyFromParts(parts: gmail_v1.Schema$MessagePart[]): string {
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

// Extract email from "Name <email@example.com>" format
export function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

// Extract name from "Name <email@example.com>" format
export function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*</);
  return match ? match[1].replace(/"/g, "").trim() : "";
}

// Archive multiple emails
export async function archiveEmails(accountId: string, gmailIds: string[]) {
  const gmail = await getGmailClient(accountId);

  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: gmailIds,
      removeLabelIds: ["INBOX"],
    },
  });
}

// Delete email (move to trash)
export async function deleteEmail(accountId: string, gmailId: string) {
  const gmail = await getGmailClient(accountId);

  await gmail.users.messages.trash({
    userId: "me",
    id: gmailId,
  });
}

// Delete multiple emails (batch - moves to trash)
export async function deleteEmails(accountId: string, gmailIds: string[]) {
  if (gmailIds.length === 0) return;

  const gmail = await getGmailClient(accountId);

  // Use batchModify to add TRASH label to all emails at once
  await gmail.users.messages.batchModify({
    userId: "me",
    requestBody: {
      ids: gmailIds,
      addLabelIds: ["TRASH"],
      removeLabelIds: ["INBOX"],
    },
  });
}

/**
 * Fast regex-based unsubscribe link extraction (no AI)
 * Used during fetch phase for speed
 */
export function extractUnsubscribeLinkFast(
  header: string,
  body: string
): string | null {
  let match;

  // Helper function to search for a keyword pattern
  const searchForKeyword = (keyword: string): string | null => {
    // 1. Look for anchor tags with keyword in the link text
    const anchorPattern = new RegExp(
      `<a[^>]*href=["']([^"']+)["'][^>]*>[^<]*${keyword}[^<]*<\\/a>`,
      "gi"
    );
    while ((match = anchorPattern.exec(body)) !== null) {
      if (!match[1].startsWith("mailto:")) {
        return decodeHtmlEntities(match[1]);
      }
    }

    // 2. Look for keyword BEFORE a link (common pattern: "unsubscribe click here")
    const beforePattern = new RegExp(
      `${keyword}[^<]{0,100}<a[^>]*href=["']([^"']+)["'][^>]*>`,
      "gi"
    );
    while ((match = beforePattern.exec(body)) !== null) {
      if (!match[1].startsWith("mailto:")) {
        return decodeHtmlEntities(match[1]);
      }
    }

    // 3. Look for keyword AFTER a link (within 100 chars after </a>)
    const afterPattern = new RegExp(
      `<a[^>]*href=["']([^"']+)["'][^>]*>[^<]*<\\/a>[^<]{0,100}${keyword}`,
      "gi"
    );
    while ((match = afterPattern.exec(body)) !== null) {
      if (!match[1].startsWith("mailto:")) {
        return decodeHtmlEntities(match[1]);
      }
    }

    return null;
  };

  // First check for "unsubscribe"
  const unsubscribeLink = searchForKeyword("unsubscribe");
  if (unsubscribeLink) {
    return unsubscribeLink;
  }

  // Then check for "opt out" / "opt-out" / "optout"
  const optOutLink = searchForKeyword("opt[\\s-]?out");
  if (optOutLink) {
    return optOutLink;
  }

  // Fallback: List-Unsubscribe header (skip mailto:)
  if (header) {
    const urlMatch = header.match(/<(https?:\/\/[^>]+)>/);
    if (urlMatch) {
      return urlMatch[1];
    }
  }

  // No AI fallback here - that happens during processing phase if needed
  return null;
}

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
