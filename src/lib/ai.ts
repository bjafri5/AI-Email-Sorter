import { openai } from "./openai";

interface EmailData {
  subject: string;
  fromEmail: string;
  fromName: string | null;
  body: string; // Should be cleaned plain text, not raw HTML
  snippet: string | null;
}

interface Category {
  id: string;
  name: string;
  description: string;
}

/**
 * Classify an email into one of the user's categories using AI
 */
export async function classifyEmail(
  email: EmailData,
  categories: Category[]
): Promise<string | null> {
  if (categories.length === 0) {
    return null;
  }

  // Build category list for prompt
  const categoryList = categories
    .map((cat, index) => `${index + 1}. "${cat.name}": ${cat.description}`)
    .join("\n");

  // Truncate body to avoid token limits
  const truncatedBody = email.body.substring(0, 5000);

  const prompt = `You are an email classifier. Classify the following email into ONE of these categories.

Categories:
${categoryList}

Email:
From: ${email.fromName || email.fromEmail}
Subject: ${email.subject}
Body: ${truncatedBody}

Instructions:
- Respond with ONLY the category number (1, 2, 3, etc.)
- If the email doesn't fit any category well, respond with "0"
- Do not include any other text in your response

Category number:`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
    });

    const result = response.choices[0]?.message?.content?.trim() || "0";
    const categoryIndex = parseInt(result, 10);

    if (categoryIndex > 0 && categoryIndex <= categories.length) {
      return categories[categoryIndex - 1].id;
    }

    return null;
  } catch (error) {
    console.error("Classification error:", error);
    return null;
  }
}

/**
 * Generate a concise summary of an email using AI
 */
export async function summarizeEmail(email: EmailData): Promise<string> {
  // Truncate body to avoid token limits
  const truncatedBody = email.body.substring(0, 3000);

  const prompt = `Summarize this email in 1-2 concise sentences. Focus on the main point or action required.

From: ${email.fromName || email.fromEmail}
Subject: ${email.subject}
Body: ${truncatedBody}

Summary:`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
    });

    const summary = response.choices[0]?.message?.content?.trim();
    return summary || email.snippet || email.subject;
  } catch (error) {
    console.error("Summarization error:", error);
    return email.snippet || email.subject;
  }
}

/**
 * Extract unsubscribe link from email body using AI (fallback method)
 */
export async function extractUnsubscribeLinkAI(
  emailBody: string
): Promise<string | null> {
  const truncatedBody = emailBody.substring(0, 4000);

  const prompt = `Find the unsubscribe URL in this email. 
  
Email content:
${truncatedBody}

Instructions:
- Return ONLY the full unsubscribe URL (starting with http:// or https://)
- If no unsubscribe link is found, respond with "NONE"
- Do not include any other text

Unsubscribe URL:`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
    });

    const result = response.choices[0]?.message?.content?.trim() || "NONE";

    if (result === "NONE" || !result.startsWith("http")) {
      return null;
    }

    return result;
  } catch (error) {
    console.error("Unsubscribe extraction error:", error);
    return null;
  }
}
