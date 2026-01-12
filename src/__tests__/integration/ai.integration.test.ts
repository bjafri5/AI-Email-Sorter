import { describe, it, expect } from "vitest";
import {
  classifyAndSummarizeEmail,
  classifyEmail,
  extractUnsubscribeLinkAI,
} from "@/lib/ai";

const shouldRunIntegration = !!process.env.OPENAI_API_KEY;

describe.skipIf(!shouldRunIntegration)("AI Integration Tests", () => {
  const categories = [
    {
      id: "newsletters",
      name: "Newsletters",
      description: "Email newsletters, digests, and regular updates from publications",
    },
    {
      id: "promotions",
      name: "Promotions",
      description: "Marketing emails, sales, discounts, and promotional offers",
    },
    {
      id: "services",
      name: "Services",
      description: "Account notifications, receipts, and service alerts",
    },
  ];

  it("classifies a newsletter email correctly", async () => {
    const result = await classifyEmail(
      {
        subject: "Your Weekly Tech Digest - Issue #142",
        fromEmail: "digest@techweekly.com",
        fromName: "Tech Weekly",
        body: "Here are this week's top stories in technology. We've curated the best articles about AI, startups, and software development for your reading pleasure.",
        snippet: "Top stories in tech...",
      },
      categories
    );

    expect(result).toBe("newsletters");
  }, 30000);

  it("classifies a promotional email correctly", async () => {
    const result = await classifyEmail(
      {
        subject: "50% OFF Everything - Flash Sale Ends Tonight!",
        fromEmail: "deals@store.com",
        fromName: "Big Store",
        body: "Don't miss out on our biggest sale of the year! Use code SAVE50 at checkout. Limited time only. Shop now and save big on all items.",
        snippet: "50% off everything...",
      },
      categories
    );

    expect(result).toBe("promotions");
  }, 30000);

  it("classifies a service notification correctly", async () => {
    const result = await classifyEmail(
      {
        subject: "Your order has shipped - Order #12345",
        fromEmail: "orders@amazon.com",
        fromName: "Amazon",
        body: "Your package is on its way! Track your shipment using the link below. Estimated delivery: Tomorrow by 9pm.",
        snippet: "Your package is on its way...",
      },
      categories
    );

    expect(result).toBe("services");
  }, 30000);

  it("returns null for unrelated email", async () => {
    const result = await classifyEmail(
      {
        subject: "Re: Meeting tomorrow",
        fromEmail: "colleague@company.com",
        fromName: "John Doe",
        body: "Hey, just confirming our meeting tomorrow at 2pm. See you then!",
        snippet: "Confirming meeting...",
      },
      categories
    );

    expect(result).toBeNull();
  }, 30000);

  it("classifies and summarizes email together", async () => {
    const result = await classifyAndSummarizeEmail(
      {
        subject: "Your Monthly Statement is Ready",
        fromEmail: "statements@bank.com",
        fromName: "My Bank",
        body: "Your statement for December 2025 is now available. Log in to view your account activity and download your statement.",
        snippet: "Statement ready...",
      },
      categories
    );

    expect(result.categoryId).toBe("services");
    expect(result.summary).toBeTruthy();
    expect(result.summary.length).toBeGreaterThan(10);
  }, 30000);

  it("extracts unsubscribe link from email HTML", async () => {
    const emailHtml = `
      <html>
        <body>
          <p>Thank you for subscribing to our newsletter!</p>
          <p>Here's your weekly update...</p>
          <footer>
            <a href="https://example.com/privacy">Privacy Policy</a> |
            <a href="https://example.com/unsubscribe?id=abc123">Unsubscribe</a> |
            <a href="https://example.com/contact">Contact Us</a>
          </footer>
        </body>
      </html>
    `;

    const result = await extractUnsubscribeLinkAI(emailHtml);

    expect(result).toBe("https://example.com/unsubscribe?id=abc123");
  }, 30000);

  it("extracts unsubscribe link with different wording", async () => {
    const emailHtml = `
      <html>
        <body>
          <p>Special offers just for you!</p>
          <div style="font-size: 10px; color: gray;">
            Don't want these emails? <a href="https://store.com/opt-out/user123">Click here to opt out</a>
          </div>
        </body>
      </html>
    `;

    const result = await extractUnsubscribeLinkAI(emailHtml);

    expect(result).toBe("https://store.com/opt-out/user123");
  }, 30000);

  it("returns null when no unsubscribe link exists", async () => {
    const emailHtml = `
      <html>
        <body>
          <p>Hey, just wanted to follow up on our conversation.</p>
          <p>Let me know when you're free to chat.</p>
          <p>Best, John</p>
        </body>
      </html>
    `;

    const result = await extractUnsubscribeLinkAI(emailHtml);

    expect(result).toBeNull();
  }, 30000);
});
