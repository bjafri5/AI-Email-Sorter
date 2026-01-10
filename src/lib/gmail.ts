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
  const unsubscribeLink = extractUnsubscribeLink(unsubscribeHeader, body);

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

// Extract unsubscribe link (with optional AI fallback)
export function extractUnsubscribeLink(
  header: string,
  body: string
): string | null {
  // Try header first (most reliable)
  if (header) {
    const urlMatch = header.match(/<(https?:\/\/[^>]+)>/);
    if (urlMatch) return urlMatch[1];
  }

  // Try common patterns in body
  const patterns = [
    /https?:\/\/[^\s"<>]*unsubscribe[^\s"<>]*/i,
    /https?:\/\/[^\s"<>]*optout[^\s"<>]*/i,
    /https?:\/\/[^\s"<>]*opt-out[^\s"<>]*/i,
    /https?:\/\/[^\s"<>]*remove[^\s"<>]*/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[0];
  }

  return null;
}

// Async version with AI fallback (use when regex fails)
export async function extractUnsubscribeLinkWithAI(
  header: string,
  body: string
): Promise<string | null> {
  // Try regex first
  const regexResult = extractUnsubscribeLink(header, body);
  if (regexResult) return regexResult;

  // Fall back to AI
  return extractUnsubscribeLinkAI(body);
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
