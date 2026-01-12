import { chromium, Browser, Page, FrameLocator } from "playwright";
import { openai } from "./openai";
import pLimit from "p-limit";

// Default concurrency for parallel unsubscribe operations
export const UNSUBSCRIBE_CONCURRENCY = 5;

export interface UnsubscribeResult {
  success: boolean;
  method: "ai";
  message: string;
}

export interface UserInfo {
  email: string;
  name?: string;
}

export interface UnsubscribeProgress {
  index: number;
  link: string;
  fromEmail?: string;
  status: "started" | "completed";
  result?: UnsubscribeResult;
}

interface InteractiveElement {
  type: "button" | "link" | "input" | "checkbox" | "radio";
  text: string;
  placeholder?: string;
  value?: string;
  locator: any;
}

interface AnalyzeResult {
  done: boolean;
  success: boolean;
  message: string;
  shouldWaitForPageChange: boolean;
}

/**
 * Unsubscribe from a single link (convenience wrapper)
 * Uses unsubscribeFromLinks internally with concurrency of 1
 */
export async function unsubscribeFromLink(
  unsubscribeLink: string,
  userInfo: UserInfo
): Promise<UnsubscribeResult> {
  const results = await unsubscribeFromLinks([unsubscribeLink], userInfo, 1);
  return results[0];
}

export interface UnsubscribeFromLinksOptions {
  concurrency?: number;
  fromEmails?: string[];
  onProgress?: (progress: UnsubscribeProgress) => void;
}

/**
 * Unsubscribe from multiple links in parallel with shared browser
 * Uses p-limit for concurrency control and isolated browser contexts
 * Calls onProgress callback as each unsubscribe completes for real-time updates
 */
export async function unsubscribeFromLinks(
  links: string[],
  userInfo: UserInfo,
  optionsOrConcurrency:
    | number
    | UnsubscribeFromLinksOptions = UNSUBSCRIBE_CONCURRENCY
): Promise<UnsubscribeResult[]> {
  // Support both old signature (concurrency number) and new options object
  const options: UnsubscribeFromLinksOptions =
    typeof optionsOrConcurrency === "number"
      ? { concurrency: optionsOrConcurrency }
      : optionsOrConcurrency;

  const concurrency = options.concurrency ?? UNSUBSCRIBE_CONCURRENCY;
  const fromEmails = options.fromEmails;
  const onProgress = options.onProgress;

  if (links.length === 0) {
    return [];
  }

  console.log("\n" + "=".repeat(60));
  console.log(
    `BATCH UNSUBSCRIBE: ${links.length} links (concurrency: ${concurrency})`
  );
  console.log(`USER: ${userInfo.email} (${userInfo.name || "no name"})`);
  console.log("=".repeat(60));

  let browser: Browser | null = null;
  // Pre-allocate results array to maintain order
  const results: UnsubscribeResult[] = new Array(links.length);

  try {
    console.log("Launching chromium browser...");
    const launchStart = Date.now();
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    console.log(`Browser launched in ${Date.now() - launchStart}ms`);

    const limit = pLimit(concurrency);

    await Promise.allSettled(
      links.map((link, index) =>
        limit(async () => {
          const fromEmail = fromEmails?.[index];

          // Notify that this unsubscribe is starting
          onProgress?.({ index, link, fromEmail, status: "started" });

          const result = await processUnsubscribe(
            browser!,
            link,
            userInfo,
            fromEmail
          );
          results[index] = result;

          // Notify that this unsubscribe completed
          onProgress?.({ index, link, fromEmail, status: "completed", result });

          return result;
        })
      )
    );

    // Fill in any missing results (from rejected promises)
    for (let i = 0; i < links.length; i++) {
      if (!results[i]) {
        results[i] = {
          success: false,
          method: "ai" as const,
          message: "Unknown error",
        };
      }
    }

    return results;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("BATCH ERROR:", errorMessage);
    // Return failure for all links if browser launch fails
    return links.map(() => ({
      success: false,
      method: "ai" as const,
      message: errorMessage,
    }));
  } finally {
    if (browser) {
      await browser.close();
      console.log("Browser closed");
    }
    console.log("=".repeat(60) + "\n");
  }
}

/**
 * Process a single unsubscribe link using a shared browser
 * Creates an isolated browser context for each link
 */
async function processUnsubscribe(
  browser: Browser,
  unsubscribeLink: string,
  userInfo: UserInfo,
  fromEmail?: string
): Promise<UnsubscribeResult> {
  console.log(`\n${"─".repeat(40)}`);
  console.log(`UNSUBSCRIBE: ${fromEmail || "unknown"} - ${unsubscribeLink}`);
  console.log("─".repeat(40));

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    console.log("Navigating to page...");
    await page.goto(unsubscribeLink, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for content to render (handles JS-rendered pages and iframes)
    await waitForContent(page);

    console.log("Page loaded. URL:", page.url());

    const actionHistory: string[] = [];

    for (let attempt = 1; attempt <= 5; attempt++) {
      console.log(`\n--- Attempt ${attempt}/5 ---`);

      const result = await analyzeAndAct(
        page,
        userInfo,
        attempt,
        actionHistory
      );

      if (result.done) {
        console.log(
          `DONE: ${result.success ? "SUCCESS" : "FAILED"} - ${result.message}`
        );
        return {
          success: result.success,
          method: "ai",
          message: result.message,
        };
      }

      // Only wait for page change if we clicked a button/link
      if (result.shouldWaitForPageChange) {
        await waitForPageChange(page);
      }
    }

    console.log("Max attempts reached");
    return {
      success: false,
      method: "ai",
      message: "Could not complete unsubscribe after multiple attempts",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("ERROR:", errorMessage);
    return {
      success: false,
      method: "ai",
      message: errorMessage,
    };
  } finally {
    await context.close();
  }
}

async function getFrameContent(
  page: Page
): Promise<{ frame: Page | FrameLocator; text: string }> {
  // Check main page
  const mainText = await page
    .locator("body")
    .innerText()
    .catch(() => "");

  if (mainText.length > 50) {
    return { frame: page, text: mainText };
  }

  // Check first level iframe
  const iframeCount = await page.locator("iframe").count();
  if (iframeCount > 0) {
    try {
      const iframe1 = page.frameLocator("iframe").first();
      const iframe1Text = await iframe1
        .locator("body")
        .innerText()
        .catch(() => "");

      if (iframe1Text.length > 50) {
        console.log(`Found content in iframe (${iframe1Text.length} chars)`);
        return { frame: iframe1, text: iframe1Text };
      }

      // Check nested iframe (iframe inside iframe)
      const nestedIframeCount = await iframe1.locator("iframe").count();
      if (nestedIframeCount > 0) {
        const iframe2 = iframe1.frameLocator("iframe").first();
        const iframe2Text = await iframe2
          .locator("body")
          .innerText()
          .catch(() => "");

        if (iframe2Text.length > 50) {
          console.log(
            `Found content in nested iframe (${iframe2Text.length} chars)`
          );
          return { frame: iframe2, text: iframe2Text };
        }
      }
    } catch (e) {
      console.log(`Error accessing iframes: ${e}`);
    }
  }

  return { frame: page, text: mainText };
}

async function waitForContent(
  page: Page,
  timeout: number = 10000
): Promise<void> {
  console.log("  Waiting for content to render...");

  try {
    await Promise.race([
      // Main page content
      page.waitForFunction(
        () => (document.body.innerText || "").trim().length > 50,
        { timeout }
      ),

      // Iframe appears
      page.waitForSelector("iframe", { timeout }).then(async () => {
        // Give iframe time to load content
        await page.waitForTimeout(1000);
      }),

      // Form/button appears
      page.waitForSelector(
        "form, button, [role='button'], input[type='submit']",
        { timeout }
      ),
    ]);

    console.log(`  → Content ready`);
  } catch {
    console.log(`  → Timeout, proceeding anyway`);
  }
}

async function waitForPageChange(page: Page): Promise<void> {
  const urlBefore = normalizeUrl(page.url());
  console.log(`  Waiting for page change...`);

  try {
    // Wait for URL change (ignoring hash)
    await page.waitForURL((url) => normalizeUrl(url.toString()) !== urlBefore, {
      timeout: 10000,
    });

    // Wait for new page to load
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });

    // Wait for content to render
    await waitForContent(page, 5000);

    console.log(`  → URL changed to: ${page.url()}`);
  } catch {
    // URL didn't change - might be AJAX update
    try {
      await page.waitForTimeout(2000);
      await waitForContent(page, 3000);
      console.log(`  → Waited for AJAX (same URL)`);
    } catch {
      console.log(`  → Timeout, proceeding`);
    }
  }
}

function normalizeUrl(url: string): string {
  return url.split("#")[0];
}

async function getVisibleText(frame: Page | FrameLocator): Promise<string> {
  return await frame.locator("body").evaluate(() => {
    function isElementVisible(el: HTMLElement): boolean {
      const style = window.getComputedStyle(el);

      if (style.display === "none") return false;
      if (style.visibility === "hidden") return false;
      if (style.opacity === "0") return false;

      // Check for hidden via overflow/max-height trick
      if (style.overflow === "hidden") {
        const maxHeight = parseFloat(style.maxHeight);
        if (maxHeight === 0) return false;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;

      return true;
    }

    function getVisibleTextFromElement(el: HTMLElement): string {
      if (!isElementVisible(el)) return "";

      let text = "";
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.textContent || "";
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          text += getVisibleTextFromElement(child as HTMLElement);
        }
      }
      return text;
    }

    return getVisibleTextFromElement(document.body).trim().replace(/\s+/g, " ");
  });
}

async function analyzeAndAct(
  page: Page,
  userInfo: UserInfo,
  attempt: number,
  actionHistory: string[]
): Promise<AnalyzeResult> {
  const { frame, text: frameText } = await getFrameContent(page);

  // Get page text for AI analysis (can include some hidden elements, that's OK for context)
  let pageText = "";

  const mainSelectors = [
    "main",
    "[role='main']",
    "form",
    ".content",
    "#content",
  ];
  for (const selector of mainSelectors) {
    try {
      const el = frame.locator(selector).first();
      if (await el.isVisible({ timeout: 500 })) {
        const text = await el.innerText();
        if (text && text.length > 100) {
          pageText = text;
          console.log(`Found content via "${selector}"`);
          break;
        }
      }
    } catch {}
  }

  if (!pageText) {
    pageText = frameText;
    console.log(`Using body text (${pageText.length} chars)`);
  }

  console.log(
    `Page text (first 500 chars):`,
    pageText.substring(0, 500).replace(/\n/g, " ")
  );

  // Get ONLY visible text for success detection
  const visibleText = await getVisibleText(frame);

  // Check for success using visible text only
  if (isSuccessPage(visibleText)) {
    console.log(`✓ Success message detected`);
    return {
      done: true,
      success: true,
      message: "Unsubscribed successfully",
      shouldWaitForPageChange: false,
    };
  }

  // If content disappeared after a button click, assume success
  if (visibleText.length < 50 && attempt > 1) {
    console.log(`✓ Content disappeared after action - assuming success`);
    return {
      done: true,
      success: true,
      message: "Unsubscribed successfully",
      shouldWaitForPageChange: false,
    };
  }

  // Check for error using visible text
  if (isErrorPage(visibleText)) {
    console.log(`✗ Error message detected`);
    return {
      done: true,
      success: false,
      message: "Unsubscribe failed - error on page",
      shouldWaitForPageChange: false,
    };
  }

  // Get interactive elements from the correct context
  const elements = await getInteractiveElements(frame);
  console.log(`Found ${elements.length} interactive elements:`);
  elements.forEach((e, i) => {
    let details = "";
    if (e.placeholder) details += ` (placeholder: ${e.placeholder})`;
    if (e.value) details += ` (value: "${e.value}")`;
    console.log(`  ${i + 1}. [${e.type}] "${e.text}"${details}`);
  });

  // If no interactive elements, let AI analyze the page text for success/error messages
  if (elements.length === 0) {
    // Check if the page text indicates success (AI might catch patterns we missed)
    const prompt = `You are an unsubscribe assistant. Analyze this page text and determine if the unsubscribe was successful.

PAGE TEXT:
${pageText.substring(0, 5000)}

The page has no interactive elements (buttons, links, forms). Based on the text, determine:
1. Is there a SUCCESS message indicating the user has been unsubscribed?
2. Is there an ERROR message?
3. Is the page just empty or unclear?

RESPOND WITH JSON:
{"success": true, "message": "reason"} - if page indicates successful unsubscribe
{"success": false, "message": "reason"} - if error, empty, or unclear

JSON only:`;

    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const aiResponse = response.choices[0]?.message?.content?.trim() || "";
    console.log(`AI (no elements):`, aiResponse);

    try {
      const result = JSON.parse(aiResponse);
      return {
        done: true,
        success: result.success,
        message: result.message || "No interactive elements found",
        shouldWaitForPageChange: false,
      };
    } catch {
      return {
        done: true,
        success: false,
        message: "No interactive elements found",
        shouldWaitForPageChange: false,
      };
    }
  }

  // Build element list for AI
  const elementList = elements
    .map((e, i) => {
      let desc = `${i + 1}. [${e.type}] "${e.text}"`;
      if (e.placeholder) desc += ` (placeholder: ${e.placeholder})`;
      if (e.value) desc += ` (current value: "${e.value}")`;
      return desc;
    })
    .join("\n");

  // Build action history for AI context
  const historySection =
    actionHistory.length > 0
      ? `\nPREVIOUS ACTIONS THIS SESSION:\n${actionHistory.join("\n")}\n`
      : "";

  const prompt = `You are an unsubscribe assistant. Analyze this page and decide ONE action.

  PAGE TEXT:
  ${pageText.substring(0, 5000)}

  INTERACTIVE ELEMENTS:
  ${elementList}
  ${historySection}
  USER INFO:
  - Email: ${userInfo.email}
  - Name: ${userInfo.name || "N/A"}

  GOAL: Unsubscribe the user from emails.

  RULES:
  1. If you see a SUCCESS MESSAGE, return DONE with success:true. Examples:
    - "you have been unsubscribed", "successfully unsubscribed", "preferences saved"
    - "removed from list", "no longer subscribed", "opt-out complete"
    - "already unsubscribed", "not subscribed", "no active subscription"

  2. If you see an ERROR MESSAGE, return DONE with success:false. Examples:
    - "link expired", "invalid link", "error occurred", "try again later"
    - "captcha", "verify you're human" (we cannot solve these)

  3. If both "Unsubscribe" and "Manage preferences" options exist, prefer "Unsubscribe"

  4. BEFORE clicking Submit/Update, fill any empty input fields:
    - Email fields → fill with user's email (REQUIRED before submit)
    - Name fields → fill with user's name
    - Reason fields → fill with "No longer interested"

  5. For checkboxes/radios:
    - "Unsubscribe from X" or "Remove me" → must be CHECKED
    - "Subscribe" or "Keep subscribed" → must be UNCHECKED
    - For YES/NO toggles about RECEIVING emails: unchecked=correct, checked=wrong (click to uncheck)
    - For YES/NO toggles about NOT receiving/unsubscribing: checked=correct, unchecked=wrong (click to check)
    - Click to toggle if in wrong state, then verify it changed before submitting

  6. Workflow order: Fill inputs → Set checkboxes → Click Submit → Verify success

  7. Do NOT repeat actions. Check PREVIOUS ACTIONS and do the next step.

  8. Return DONE with success:true only if:
    - Page shows success message, OR
    - Submit was clicked AND form is in correct state

  9. Return DONE with success:false if error or cannot proceed.

  RESPOND WITH JSON:
  {"action": "DONE", "success": true, "message": "reason"} - if confirmation visible OR save was clicked with correct state
  {"action": "DONE", "success": false, "message": "reason"} - if error or can't proceed  
  {"action": "CLICK", "element": <number>} - click a button, link, checkbox, or radio
  {"action": "FILL", "element": <number>, "value": "text"} - fill input field

  JSON only:`;

  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const aiResponse = response.choices[0]?.message?.content?.trim() || "";
  console.log(`AI:`, aiResponse);

  // Parse JSON separately
  let action: any;
  try {
    action = JSON.parse(aiResponse);
  } catch {
    console.log(`Failed to parse AI response as JSON`);
    return {
      done: true,
      success: false,
      message: "AI response parsing failed",
      shouldWaitForPageChange: false,
    };
  }

  // Execute action separately
  try {
    if (action.action === "DONE") {
      return {
        done: true,
        success: action.success,
        message: action.message,
        shouldWaitForPageChange: false,
      };
    }

    if (action.action === "CLICK" && action.element) {
      const idx = action.element - 1;
      if (idx >= 0 && idx < elements.length) {
        const element = elements[idx];
        console.log(`→ Clicking: [${element.type}] "${element.text}"`);

        // Track this action
        actionHistory.push(
          `Attempt ${attempt}: Clicked [${element.type}] "${element.text}"`
        );

        try {
          await element.locator.scrollIntoViewIfNeeded();
        } catch {}

        try {
          await element.locator.click({ force: true, timeout: 5000 });
        } catch {
          console.log(`  Fallback: clicking via JS`);
          await element.locator.evaluate((el: HTMLElement) => el.click());
        }

        const shouldWait = element.type === "button" || element.type === "link";
        return {
          done: false,
          success: false,
          message: "",
          shouldWaitForPageChange: shouldWait,
        };
      } else {
        console.log(`Invalid element index: ${action.element}`);
        return {
          done: true,
          success: false,
          message: "Invalid element index",
          shouldWaitForPageChange: false,
        };
      }
    }

    if (action.action === "FILL" && action.element && action.value) {
      const idx = action.element - 1;
      if (idx >= 0 && idx < elements.length) {
        console.log(
          `→ Filling: "${elements[idx].text}" with "${action.value}"`
        );

        // Track this action
        actionHistory.push(
          `Attempt ${attempt}: Filled "${elements[idx].text}" with "${action.value}"`
        );

        await elements[idx].locator.scrollIntoViewIfNeeded();
        await elements[idx].locator.fill(action.value);
        return {
          done: false,
          success: false,
          message: "",
          shouldWaitForPageChange: false,
        };
      } else {
        console.log(`Invalid element index: ${action.element}`);
        return {
          done: true,
          success: false,
          message: "Invalid element index",
          shouldWaitForPageChange: false,
        };
      }
    }

    console.log(`Unknown action: ${action.action}`);
    return {
      done: true,
      success: false,
      message: "Invalid AI action",
      shouldWaitForPageChange: false,
    };
  } catch (e: any) {
    console.log(`Action failed: ${e.message || e}`);
    return {
      done: true,
      success: false,
      message: `Action failed: ${e.message || e}`,
      shouldWaitForPageChange: false,
    };
  }
}

export function isSuccessPage(text: string): boolean {
  const patterns = [
    /already unsubscribed/i,
    /you are now unsubscribed/i,
    /successfully unsubscribed/i,
    /you('ve| have) been unsubscribed/i,
    /request.*accepted/i,
    /request.*being processed/i,
    /removed from.*list/i,
    /no longer receive/i,
    /subscription.*cancell?ed/i,
    /opt.*out.*complete/i,
    /preferences.*updated/i,
    /preferences.*saved/i,
    /thank you.*unsubscrib/i,
    /thanks.*confirming.*preferences/i,
    /we('ve| have) removed/i,
    /you('ve| have) been removed/i,
    /changes.*saved/i,
    /settings.*saved/i,
    /settings.*updated/i,
    /successfully.*updated/i,
    /updated our system/i,
    /we('ve| have) updated/i,
    /email preferences.*updated/i,
    /saved.*preferences/i,
    /saved.*email.*preferences/i,
    /"success":true/i,
    /unsubscribe successful/i,
  ];
  return patterns.some((p) => p.test(text));
}

export function isErrorPage(text: string): boolean {
  const patterns = [
    /unsubscribe.*failed/i,
    /error.*occurred/i,
    /something went wrong/i,
    /try again later/i,
    /link.*expired/i,
    /invalid.*link/i,
  ];
  return patterns.some((p) => p.test(text));
}

async function getInteractiveElements(
  frame: Page | FrameLocator
): Promise<InteractiveElement[]> {
  const startTime = Date.now();
  console.log("  [getElements] Starting...");

  const elementData = await frame.locator("body").evaluate(() => {
    const results: any[] = [];
    const debug: string[] = [];

    // Check if element has display:none or visibility:hidden ancestor
    // These are definitive hiding - element cannot be interacted with
    function hasHiddenAncestor(el: HTMLElement): boolean {
      let current: HTMLElement | null = el;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);

        // Definitive hiding
        if (style.display === "none") return true;
        if (style.visibility === "hidden") return true;

        // Collapsed sections (common pattern for expandable content)
        if (style.overflow === "hidden") {
          const height = parseFloat(style.height);
          const maxHeight = parseFloat(style.maxHeight);
          if (height === 0 || maxHeight === 0) return true;
        }

        current = current.parentElement;
      }
      return false;
    }

    // Check if element AND all ancestors are visible
    // This includes opacity and size checks which may false-positive on styled elements
    function isElementVisible(el: HTMLElement): boolean {
      let current: HTMLElement | null = el;

      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);

        if (style.display === "none") return false;
        if (style.visibility === "hidden") return false;
        if (style.opacity === "0") return false;

        if (style.overflow === "hidden") {
          const maxHeight = parseFloat(style.maxHeight);
          if (maxHeight === 0) return false;
        }

        const rect = current.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          if (current.tagName !== "INPUT") return false;
        }

        current = current.parentElement;
      }

      return true;
    }

    // Helper to find label text from various sources
    function findLabelInfo(el: HTMLInputElement): {
      text: string;
      sourceElement: HTMLElement | null;
    } {
      const id = el.id;
      const name = el.name || "";

      // Check aria-labelledby first
      const ariaLabelledBy = el.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const labelIds = ariaLabelledBy.split(" ");
        for (const labelId of labelIds) {
          const labelEl = document.getElementById(labelId);
          if (labelEl) {
            const text = (labelEl.textContent || "").trim();
            if (text.length > 0)
              return { text: text.substring(0, 50), sourceElement: labelEl };
          }
        }
      }

      // Check label[for="id"]
      if (id) {
        const labelFor = document.querySelector(`label[for="${id}"]`);
        if (labelFor) {
          const text = (labelFor.textContent || "").trim();
          if (text.length > 0)
            return {
              text: text.substring(0, 50),
              sourceElement: labelFor as HTMLElement,
            };
        }
      }

      // Check parent label
      const parentLabel = el.closest("label");
      if (parentLabel) {
        const text = (parentLabel.textContent || "").trim();
        if (text.length > 0)
          return {
            text: text.substring(0, 50),
            sourceElement: parentLabel as HTMLElement,
          };
      }

      // Check table row
      const row = el.closest("tr");
      if (row) {
        const cells = row.querySelectorAll("td");
        for (const cell of cells) {
          if (!cell.contains(el)) {
            const text = (cell.textContent || "").trim();
            if (text.length > 0)
              return {
                text: text.substring(0, 50),
                sourceElement: cell as HTMLElement,
              };
          }
        }
      }

      // Check adjacent sibling
      const parent = el.parentElement;
      if (parent && parent.nextElementSibling) {
        const text = (parent.nextElementSibling.textContent || "").trim();
        if (text.length > 0)
          return {
            text: text.substring(0, 50),
            sourceElement: parent.nextElementSibling as HTMLElement,
          };
      }

      // Check aria-label (attribute, not element)
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel)
        return { text: ariaLabel.substring(0, 50), sourceElement: null };

      return { text: name || "option", sourceElement: null };
    }

    // Track DOM indices per selector type for locator creation
    const domIndices = {
      button: 0,
      checkbox: 0,
      radio: 0,
      input: 0,
    };

    // Single pass through all interactive elements in DOM order
    document
      .querySelectorAll(
        'button, input, textarea, [role="button"], [role="switch"], a'
      )
      .forEach((el) => {
        const htmlEl = el as HTMLElement;
        const tagName = el.tagName.toLowerCase();
        const inputType = (el as HTMLInputElement).type?.toLowerCase() || "";
        const role = el.getAttribute("role");

        // Buttons
        if (
          tagName === "button" ||
          inputType === "submit" ||
          inputType === "button" ||
          role === "button" ||
          role === "switch"
        ) {
          // Always filter display:none / visibility:hidden ancestors
          if (hasHiddenAncestor(htmlEl)) return;

          const text = (el.textContent || "")
            .trim()
            .replace(/\s+/g, " ")
            .substring(0, 50);
          const ariaLabel = el.getAttribute("aria-label") || "";
          const value = (el as HTMLInputElement).value || "";
          const buttonText = text || ariaLabel || value || "button";

          const hasVisibleText =
            buttonText && buttonText !== "button" && buttonText.length > 0;

          // Additional size/opacity checks only if no visible text
          if (!hasVisibleText) {
            if (!isElementVisible(htmlEl)) return;
          }

          results.push({
            domIndex: domIndices.button++,
            selector:
              'button, input[type="submit"], input[type="button"], [role="button"], [role="switch"]',
            elementType: "button",
            text: buttonText,
          });
          return;
        }

        // Checkboxes
        if (tagName === "input" && inputType === "checkbox") {
          const input = el as HTMLInputElement;

          if (input.disabled) return;

          // Always filter display:none / visibility:hidden ancestors
          if (hasHiddenAncestor(htmlEl)) return;

          const { text: labelText, sourceElement } = findLabelInfo(input);
          const hasVisibleLabel =
            labelText && labelText !== "option" && labelText.length > 0;

          // If label source element is hidden, filter out
          if (
            hasVisibleLabel &&
            sourceElement &&
            hasHiddenAncestor(sourceElement)
          )
            return;

          // Additional size/opacity checks only if no visible label
          if (!hasVisibleLabel) {
            const row = input.closest("tr");
            const parentLabel = input.closest("label");
            const labelFor = input.id
              ? document.querySelector(`label[for="${input.id}"]`)
              : null;
            const checkElement = row || parentLabel || labelFor || input;
            if (!isElementVisible(checkElement as HTMLElement)) return;
          }

          results.push({
            domIndex: domIndices.checkbox++,
            elementType: "checkbox",
            text: labelText,
            checked: input.checked,
          });
          return;
        }

        // Radio buttons
        if (tagName === "input" && inputType === "radio") {
          const input = el as HTMLInputElement;

          if (input.disabled) return;

          // Always filter display:none / visibility:hidden ancestors
          if (hasHiddenAncestor(htmlEl)) return;

          const { text: labelText, sourceElement } = findLabelInfo(input);
          const hasVisibleLabel =
            labelText && labelText !== "option" && labelText.length > 0;

          // If label source element is hidden, filter out
          if (
            hasVisibleLabel &&
            sourceElement &&
            hasHiddenAncestor(sourceElement)
          )
            return;

          // Additional size/opacity checks only if no visible label
          if (!hasVisibleLabel) {
            const row = input.closest("tr");
            const parentLabel = input.closest("label");
            const labelFor = input.id
              ? document.querySelector(`label[for="${input.id}"]`)
              : null;
            const checkElement = row || parentLabel || labelFor || input;
            if (!isElementVisible(checkElement as HTMLElement)) return;
          }

          results.push({
            domIndex: domIndices.radio++,
            elementType: "radio",
            text: labelText,
            checked: input.checked,
          });
          return;
        }

        // Text inputs
        if (
          tagName === "textarea" ||
          (tagName === "input" &&
            (inputType === "text" || inputType === "email" || inputType === ""))
        ) {
          // Skip hidden inputs explicitly
          if (inputType === "hidden" || el.getAttribute("type") === "hidden")
            return;

          // Always filter display:none / visibility:hidden ancestors
          if (hasHiddenAncestor(htmlEl)) return;

          const placeholder = el.getAttribute("placeholder") || "";
          const ariaLabel = el.getAttribute("aria-label") || "";
          const name = el.getAttribute("name") || "";
          const id = el.getAttribute("id") || "";
          const dataLabel = el.getAttribute("data-nl-label") || "";
          const value = (el as HTMLInputElement).value || "";

          // Check if id or name suggests email field
          const isEmailField =
            /email/i.test(id) ||
            /email/i.test(name) ||
            /email/i.test(dataLabel);

          // Check for label in same table row
          let rowLabel = "";
          const row = el.closest("tr");
          if (row) {
            const cells = row.querySelectorAll("td");
            for (const cell of cells) {
              if (!cell.contains(el)) {
                const text = (cell.textContent || "").trim();
                if (text.length > 2 && text !== ":") {
                  // Skip empty/colon-only labels
                  rowLabel = text.substring(0, 50);
                  break;
                }
              }
            }
          }

          // Build descriptive text
          let inputText =
            ariaLabel ||
            dataLabel ||
            placeholder ||
            rowLabel ||
            name ||
            "text field";

          // If we detected it's an email field, make that clear
          if (isEmailField && !/email/i.test(inputText)) {
            inputText = `email: ${inputText}`;
          }

          const hasVisibleText =
            (ariaLabel && ariaLabel.length > 0) ||
            (placeholder && placeholder.length > 0) ||
            (name && name.length > 0) ||
            (dataLabel && dataLabel.length > 0) ||
            (rowLabel && rowLabel.length > 0);

          // Additional size/opacity checks only if no visible text
          if (!hasVisibleText) {
            if (!isElementVisible(htmlEl)) return;
          }

          results.push({
            domIndex: domIndices.input++,
            selector: 'input[type="text"], input[type="email"], textarea',
            elementType: "input",
            text: inputText,
            placeholder,
            value,
          });
          return;
        }

        // Links (filtered to unsubscribe-related only)
        if (tagName === "a") {
          // Always filter display:none / visibility:hidden ancestors
          if (hasHiddenAncestor(htmlEl)) return;

          let text = (el.textContent || "")
            .trim()
            .replace(/\s+/g, " ")
            .substring(0, 50);

          // If no text, check for image alt text inside the link
          if (!text) {
            const img = el.querySelector("img");
            if (img) {
              text = (img.getAttribute("alt") || "").trim().substring(0, 50);
            }
          }

          // Also check aria-label
          if (!text) {
            text = (el.getAttribute("aria-label") || "")
              .trim()
              .substring(0, 50);
          }

          if (
            text &&
            /unsub|confirm|submit|yes|opt.?out|remove|cancel|update/i.test(text)
          ) {
            results.push({
              elementType: "link",
              text,
            });
          }
        }
      });

    return { results, debug };
  });

  console.log(
    `  [getElements] Found ${elementData.results.length} elements in ${
      Date.now() - startTime
    }ms`
  );

  // Create locators
  const elements: InteractiveElement[] = [];

  for (const data of elementData.results) {
    let locator;

    if (data.elementType === "button") {
      locator = frame.locator(data.selector).nth(data.domIndex);
      elements.push({ type: "button", text: data.text, locator });
    } else if (
      data.elementType === "checkbox" ||
      data.elementType === "radio"
    ) {
      const selector =
        data.elementType === "radio"
          ? 'input[type="radio"]'
          : 'input[type="checkbox"]';
      locator = frame.locator(selector).nth(data.domIndex);

      elements.push({
        type: data.elementType as "checkbox" | "radio",
        text: data.text,
        value: data.checked ? "checked" : "unchecked",
        locator,
      });
    } else if (data.elementType === "input") {
      locator = frame.locator(data.selector).nth(data.domIndex);
      elements.push({
        type: "input",
        text: data.text,
        placeholder: data.placeholder || undefined,
        value: data.value || undefined,
        locator,
      });
    } else if (data.elementType === "link") {
      locator = frame.getByRole("link", { name: data.text, exact: false });
      elements.push({ type: "link", text: data.text, locator });
    }
  }

  console.log(
    `  [getElements] TOTAL: ${elements.length} elements in ${
      Date.now() - startTime
    }ms`
  );

  return elements;
}
