// Client-side identity of the Harbor Point Order Desk. Everything the shell shows that is not data lives here.
import { BRAND } from "../copy/brand.ts";
import { INBOX } from "../copy/orders.ts";
type Capability = {
  icon: "track" | "return" | "compare" | "metrics" | "calendar" | "users" | "search" | "star" | "shield" | "doc" | "pin" | "wallet";
  title: string;
  line: string;
  send: string;
};

export const ui = {
  /** The rail shows one name: the company. "Order Desk" is already the team card right under it. */
  product: BRAND.company,
  tagline: "",
  agent: BRAND.product,
  role: "",
  title: BRAND.title,
  description: "An agent that works the order inbox inside Harbor Point's ERP, with people approving anything risky.",
  greeting: "Work queue",
  placeholder: "Ask about an order, a customer or stock",
  panelTitle: INBOX.panelTitle,
  /** Projects (a narrower data scope per conversation) are a platform feature the Order Desk does not use. */
  projects: false,
  capabilities: [
    { icon: "track", title: "Today's inbox", line: "Emails received on 2 Nov, by request type", send: "Summarize today's inbound emails by request type." },
    { icon: "shield", title: "Customers on credit hold", line: "Who is blocked and what they owe", send: "Which customers are on credit hold, and what do they owe?" },
    { icon: "metrics", title: "Out of stock", line: "Products with nothing available, and supply due", send: "Which products have no available stock, and when is supply due?" },
    { icon: "wallet", title: "Open orders", line: "Open and partially shipped sales orders", send: "List the open and partially shipped sales orders with their customers." },
  ] as Capability[],
  layout: "workbench",
  home: ["metrics", "suggestion-cards"],
  homeVisual: "wide",
  motionScale: 0.9,
} as const;
