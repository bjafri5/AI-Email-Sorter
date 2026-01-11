import { google } from "googleapis";
import { gmail_v1 } from "googleapis";
import { prisma } from "./prisma";
import { extractUnsubscribeLinkAI } from "./ai";

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

// Fetch unread emails from inbox
export async function fetchNewEmails(accountId: string, maxResults = 20) {
  const gmail = await getGmailClient(accountId);

  const response = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults,
  });

  const messages = response.data.messages || [];
  const emails = [];

  for (const message of messages) {
    const email = await getEmailDetails(gmail, message.id!);
    if (email) {
      emails.push(email);
    }
  }

  return emails;
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

  // Extract unsubscribe link from headers
  const unsubscribeHeader = getHeader("List-Unsubscribe");
  const unsubscribeLink = await extractUnsubscribeLink(unsubscribeHeader, body);

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
function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

// Extract name from "Name <email@example.com>" format
function extractName(from: string): string {
  const match = from.match(/^(.+?)\s*</);
  return match ? match[1].replace(/"/g, "").trim() : "";
}

// Archive email (remove from inbox)
export async function archiveEmail(accountId: string, gmailId: string) {
  const gmail = await getGmailClient(accountId);

  await gmail.users.messages.modify({
    userId: "me",
    id: gmailId,
    requestBody: {
      removeLabelIds: ["INBOX"],
    },
  });
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

// Delete multiple emails
export async function deleteEmails(accountId: string, gmailIds: string[]) {
  const gmail = await getGmailClient(accountId);

  for (const gmailId of gmailIds) {
    await gmail.users.messages.trash({
      userId: "me",
      id: gmailId,
    });
  }
}

// Extract unsubscribe link from body or header
export async function extractUnsubscribeLink(
  header: string,
  body: string
): Promise<string | null> {
  // 1. Look for anchor tags with "unsubscribe" in the link text
  const anchorPattern =
    /<a[^>]*href=["']([^"']+)["'][^>]*>[^<]*unsubscribe[^<]*<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(body)) !== null) {
    if (!match[1].startsWith("mailto:")) {
      return decodeHtmlEntities(match[1]);
    }
  }

  // 2. Look for "unsubscribe" BEFORE a link (common pattern: "unsubscribe click here")
  const beforePattern =
    /unsubscribe[^<]{0,100}<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  while ((match = beforePattern.exec(body)) !== null) {
    if (!match[1].startsWith("mailto:")) {
      return decodeHtmlEntities(match[1]);
    }
  }

  // 3. Look for "unsubscribe" AFTER a link (within 100 chars after </a>)
  const afterPattern =
    /<a[^>]*href=["']([^"']+)["'][^>]*>[^<]*<\/a>[^<]{0,100}unsubscribe/gi;
  while ((match = afterPattern.exec(body)) !== null) {
    if (!match[1].startsWith("mailto:")) {
      return decodeHtmlEntities(match[1]);
    }
  }

  // 4. Fallback: List-Unsubscribe header (skip mailto:)
  if (header) {
    const urlMatch = header.match(/<(https?:\/\/[^>]+)>/);
    if (urlMatch) {
      return urlMatch[1];
    }
  }

  // 5. Fallback: AI extraction
  return await extractUnsubscribeLinkAI(body);
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function trashEmail(
  accountId: string,
  gmailId: string
): Promise<void> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
  });

  if (!account) {
    throw new Error("Account not found");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  await gmail.users.messages.trash({
    userId: "me",
    id: gmailId,
  });
}
