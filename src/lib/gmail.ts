import { google } from "googleapis";
import { gmail_v1 } from "googleapis";
import { prisma } from "./prisma";
import pLimit from "p-limit";
import {
  extractBodyFromParts,
  extractEmail,
  extractName,
  extractUnsubscribeLinkFast,
} from "./email-utils";

// Re-export utility functions for backwards compatibility
export { extractEmail, extractName, extractUnsubscribeLinkFast };

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
  const unsubscribeLink = extractUnsubscribeLinkFast(body);

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
