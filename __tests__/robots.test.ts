import { describe, it, expect } from "vitest";
import robots from "@/app/robots";

describe("robots.ts — dynamic robots.txt route", () => {
  it("should return valid robots configuration", () => {
    const config = robots();
    expect(config.rules).toBeDefined();
    const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;
    expect(rules?.userAgent).toBe("*");
    expect(rules?.allow).toBe("/");
    expect(config.sitemap).toBe("https://coderxp.pro/sitemap.xml");
    expect(config.host).toBe("https://coderxp.pro");
  });
});
