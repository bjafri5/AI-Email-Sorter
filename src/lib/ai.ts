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
 * Combined classification and summarization
 */
export async function classifyAndSummarizeEmail(
  email: EmailData,
  categories: Category[]
): Promise<{
  categoryId: string | null;
  summary: string;
}> {
  const fallbackSummary = email.snippet || email.subject;

  if (categories.length === 0) {
    return { categoryId: null, summary: fallbackSummary };
  }

  const categoryList = categories
    .map((cat, index) => `${index + 1}. "${cat.name}": ${cat.description}`)
    .join("\n");

  const truncatedBody = email.body.substring(0, 5000);

  const prompt = `Analyze this email.

Categories:
${categoryList}

Email:
From: ${email.fromName || email.fromEmail}
Subject: ${email.subject}
Body: ${truncatedBody}

Tasks:
1. CATEGORY: Output a single number (0-${
    categories.length
  }). Use 0 if no category fits.
2. SUMMARY: One sentence describing the main point or action required.

Output format (exactly 2 lines, no extra text):
CATEGORY: <number only>
SUMMARY: <one sentence>`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content?.trim() || "";

    // Parse the response
    const categoryMatch = content.match(/CATEGORY:\s*(\d+)/i);
    const summaryMatch = content.match(/SUMMARY:\s*(.+)/i);

    const categoryIndex = categoryMatch ? parseInt(categoryMatch[1], 10) : 0;
    const summary = summaryMatch ? summaryMatch[1].trim() : fallbackSummary;

    let categoryId: string | null = null;
    if (categoryIndex > 0 && categoryIndex <= categories.length) {
      categoryId = categories[categoryIndex - 1].id;
    }

    return { categoryId, summary };
  } catch (error) {
    console.error("Classification/summarization error:", error);
    return { categoryId: null, summary: fallbackSummary };
  }
}

/**
 * Extract unsubscribe link from email HTML using AI
 * Called separately when regex extraction fails
 */
export async function extractUnsubscribeLinkAI(
  rawBody: string
): Promise<string | null> {
  // Use last 10000 chars where unsubscribe links typically appear
  const bodyEnd = rawBody.substring(Math.max(0, rawBody.length - 10000));

  const prompt = `Find the unsubscribe link in this email HTML. Return ONLY the URL, nothing else. If none found, return "NONE".

${bodyEnd}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-nano",
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.choices[0]?.message?.content?.trim() || "";

    // Validate the response is a proper URL
    if (content && content !== "NONE" && content.startsWith("http")) {
      return content;
    }

    return null;
  } catch (error) {
    console.error("Unsubscribe extraction error:", error);
    return null;
  }
}
