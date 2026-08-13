import { describe, it, expect } from "vitest";
import sitemap from "@/app/sitemap";

describe("sitemap.ts — dynamic sitemap route", () => {
  const urls = sitemap().map((entry) => entry.url);

  it("should include the homepage with highest priority", () => {
    const entries = sitemap();
    const home = entries.find((e) => e.url === "https://coderxp.pro");
    expect(home).toBeDefined();
    expect(home?.priority).toBe(1);
  });

  it("should include all expected routes", () => {
    const expectedRoutes = [
      "https://coderxp.pro",
      "https://coderxp.pro/features",
      "https://coderxp.pro/workspace",
      "https://coderxp.pro/models",
      "https://coderxp.pro/bring-your-own-key",
      "https://coderxp.pro/local-models",
      "https://coderxp.pro/pricing",
      "https://coderxp.pro/docs",
      "https://coderxp.pro/api",
      "https://coderxp.pro/security",
      "https://coderxp.pro/about",
      "https://coderxp.pro/contact",
      "https://coderxp.pro/privacy",
      "https://coderxp.pro/terms",
      "https://coderxp.pro/cookies",
    ];

    for (const route of expectedRoutes) {
      expect(urls).toContain(route);
    }
  });

  it("should set non-homepage routes to priority 0.8", () => {
    const entries = sitemap();
    for (const entry of entries) {
      if (entry.url !== "https://coderxp.pro") {
        expect(entry.priority).toBe(0.8);
      }
    }
  });

  it("should set changeFrequency to monthly", () => {
    const entries = sitemap();
    for (const entry of entries) {
      expect(entry.changeFrequency).toBe("monthly");
    }
  });

  it("should produce exactly 15 entries", () => {
    expect(sitemap()).toHaveLength(15);
  });
});