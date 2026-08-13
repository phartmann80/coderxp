import { describe, it, expect } from "vitest";
import robots from "@/app/robots";

describe("robots.ts — dynamic robots route", () => {
  it("should allow all user agents", () => {
    expect(robots.rules.userAgent).toBe("*");
    expect(robots.rules.allow).toBe("/");
  });

  it("should point sitemap to coderxp.pro", () => {
    expect(robots.sitemap).toBe("https://coderxp.pro/sitemap.xml");
  });

  it("should not have a disallow rule", () => {
    expect(robots.rules).not.toHaveProperty("disallow");
  });
});