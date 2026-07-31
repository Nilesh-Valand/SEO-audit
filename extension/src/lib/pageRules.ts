import type { PageExtractResult, PageRuleResult, RuleSeverity } from "./pageCheckTypes";

type RuleDef = {
  id: string;
  category: string;
  severity: RuleSeverity;
  description: string;
  check: (data: PageExtractResult) => { passed: boolean; message: string };
};

const RULES: RuleDef[] = [
  {
    id: "missing_title",
    category: "technical",
    severity: "high",
    description: "Page is missing a title tag.",
    check: (data) => ({
      passed: Boolean(data.title?.trim()),
      message: data.title?.trim()
        ? `Title present (${data.title.trim().length} chars).`
        : "No document title found.",
    }),
  },
  {
    id: "missing_meta_description",
    category: "technical",
    severity: "medium",
    description: "Page is missing a meta description.",
    check: (data) => ({
      passed: Boolean(data.metaDescription?.trim()),
      message: data.metaDescription?.trim()
        ? `Meta description present (${data.metaDescription.trim().length} chars).`
        : "No meta description found.",
    }),
  },
  {
    id: "missing_h1",
    category: "technical",
    severity: "medium",
    description: "Page is missing an H1 heading.",
    check: (data) => ({
      passed: data.h1Count > 0,
      message:
        data.h1Count > 0
          ? `Found ${data.h1Count} H1 heading(s).`
          : "No H1 heading found on the page.",
    }),
  },
  {
    id: "multiple_h1",
    category: "technical",
    severity: "low",
    description: "Page contains multiple H1 headings.",
    check: (data) => ({
      passed: data.h1Count <= 1,
      message:
        data.h1Count <= 1
          ? "Single H1 (or none — see missing_h1)."
          : `Found ${data.h1Count} H1 headings; prefer one primary H1.`,
    }),
  },
  {
    id: "missing_schema",
    category: "structured_data",
    severity: "medium",
    description: "Page type likely needs schema but none was found.",
    check: (data) => ({
      passed: data.schemaTypes.length > 0,
      message:
        data.schemaTypes.length > 0
          ? `JSON-LD types: ${data.schemaTypes.join(", ")}.`
          : "No JSON-LD @type values detected.",
    }),
  },
  {
    id: "images_missing_alt",
    category: "accessibility",
    severity: "medium",
    description: "Images are missing alt attributes.",
    check: (data) => ({
      passed: data.imagesMissingAlt.count === 0,
      message:
        data.imagesMissingAlt.count === 0
          ? "All images have alt attributes."
          : `${data.imagesMissingAlt.count} image(s) missing alt text.`,
    }),
  },
  {
    id: "mixed_content",
    category: "security",
    severity: "critical",
    description: "HTTPS page references insecure HTTP resources.",
    check: (data) => {
      if (!data.isHttps) {
        return { passed: true, message: "Page is not HTTPS; mixed-content rule skipped." };
      }
      return {
        passed: data.mixedContentUrls.length === 0,
        message:
          data.mixedContentUrls.length === 0
            ? "No http:// subresources found on this HTTPS page."
            : `${data.mixedContentUrls.length} insecure http:// resource(s) found.`,
      };
    },
  },
];

export function evaluatePageRules(data: PageExtractResult): PageRuleResult[] {
  return RULES.map((rule) => {
    const result = rule.check(data);
    return {
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      description: rule.description,
      passed: result.passed,
      message: result.message,
    };
  });
}
