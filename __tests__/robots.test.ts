import { describe, it, expect } from "vitest";
import robotsFn from "@/app/robots";

describe("robots.ts — dynamic robots route", () => {
  const robots = robotsFn();
  // `rules` is typed as a single rule or an array of rules; this route returns a single rule.
  const rules = robots.rules as Exclude<typeof robots.rules, unknown[]>;

  it("should allow all user agents", () => {
    expect(rules.userAgent).toBe("*");
    expect(rules.allow).toBe("/");
  });

  it("should point sitemap to coderxp.pro", () => {
    expect(robots.sitemap).toBe("https://coderxp.pro/sitemap.xml");
  });

  it("should not have a disallow rule", () => {
    expect(robots.rules).not.toHaveProperty("disallow");
  });
});