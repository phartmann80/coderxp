import { describe, it, expect } from "vitest";
import { metadata as aboutMeta } from "@/app/about/page";
import { metadata as apiMeta } from "@/app/api/page";
import { metadata as byokMeta } from "@/app/bring-your-own-key/page";
import { metadata as contactMeta } from "@/app/contact/page";
import { metadata as cookiesMeta } from "@/app/cookies/page";
import { metadata as docsMeta } from "@/app/docs/page";
import { metadata as featuresMeta } from "@/app/features/page";
import { metadata as localModelsMeta } from "@/app/local-models/page";
import { metadata as modelsMeta } from "@/app/models/page";
import { metadata as pricingMeta } from "@/app/pricing/page";
import { metadata as privacyMeta } from "@/app/privacy/page";
import { metadata as securityMeta } from "@/app/security/page";
import { metadata as termsMeta } from "@/app/terms/page";
import { metadata as workspaceMeta } from "@/app/workspace/page";

describe("Route Metadata Integrity", () => {
  const pages = [
    { route: "/about", meta: aboutMeta },
    { route: "/api", meta: apiMeta },
    { route: "/bring-your-own-key", meta: byokMeta },
    { route: "/contact", meta: contactMeta },
    { route: "/cookies", meta: cookiesMeta },
    { route: "/docs", meta: docsMeta },
    { route: "/features", meta: featuresMeta },
    { route: "/local-models", meta: localModelsMeta },
    { route: "/models", meta: modelsMeta },
    { route: "/pricing", meta: pricingMeta },
    { route: "/privacy", meta: privacyMeta },
    { route: "/security", meta: securityMeta },
    { route: "/terms", meta: termsMeta },
    { route: "/workspace", meta: workspaceMeta },
  ];

  it("should have valid title and description defined on every route", () => {
    for (const page of pages) {
      expect(page.meta).toBeDefined();
      expect(typeof page.meta.title).toBe("string");
      expect((page.meta.title as string).length).toBeGreaterThan(5);
      expect(typeof page.meta.description).toBe("string");
      expect((page.meta.description as string).length).toBeGreaterThan(10);
    }
  });

  it("should have correct canonical route alternates", () => {
    for (const page of pages) {
      expect(page.meta.alternates?.canonical).toBe(page.route);
    }
  });
});
