/**
 * Injected into the active tab via chrome.scripting.executeScript({ func }).
 * Must be self-contained (no imports / outer-scope refs) so Chrome can serialize it.
 */
export function extractPageSeoData(): import("./pageCheckTypes").PageExtractResult {
  const abs = (value: string | null | undefined): string => {
    if (!value) return "";
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return value;
    }
  };

  const metaContent = (selector: string): string | null => {
    const el = document.querySelector(selector);
    const content = el?.getAttribute("content")?.trim();
    return content || null;
  };

  const title = document.title?.trim() || null;
  const metaDescription =
    metaContent('meta[name="description" i]') ||
    metaContent('meta[property="og:description" i]');
  const canonical =
    document.querySelector('link[rel="canonical" i]')?.getAttribute("href")?.trim() || null;
  const metaRobots =
    metaContent('meta[name="robots" i]') || metaContent('meta[name="googlebot" i]');

  const headings: { tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"; text: string }[] = [];
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((node) => {
    const tag = node.tagName.toLowerCase() as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text) headings.push({ tag, text });
  });
  const h1Count = headings.filter((h) => h.tag === "h1").length;

  const schemaTypes: string[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    const raw = script.textContent?.trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const visit = (node: unknown) => {
        if (!node) return;
        if (Array.isArray(node)) {
          node.forEach(visit);
          return;
        }
        if (typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        const typeVal = obj["@type"];
        if (typeof typeVal === "string") schemaTypes.push(typeVal);
        else if (Array.isArray(typeVal)) {
          typeVal.forEach((t) => {
            if (typeof t === "string") schemaTypes.push(t);
          });
        }
        if (obj["@graph"]) visit(obj["@graph"]);
      };
      visit(parsed);
    } catch {
      // ignore invalid JSON-LD
    }
  });

  const imagesMissingAltSamples: string[] = [];
  let imagesMissingAltCount = 0;
  document.querySelectorAll("img").forEach((img) => {
    const alt = img.getAttribute("alt");
    if (alt === null || alt.trim() === "") {
      imagesMissingAltCount += 1;
      if (imagesMissingAltSamples.length < 8) {
        imagesMissingAltSamples.push(abs(img.getAttribute("src")) || "(no src)");
      }
    }
  });

  const pageHost = location.hostname.replace(/^www\./i, "").toLowerCase();
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  document.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href")?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      return;
    }
    try {
      const url = new URL(href, document.baseURI);
      if (!/^https?:$/i.test(url.protocol)) return;
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();
      if (host === pageHost) internalLinkCount += 1;
      else externalLinkCount += 1;
    } catch {
      // ignore bad hrefs
    }
  });

  const clone = document.body ? (document.body.cloneNode(true) as HTMLElement) : null;
  if (clone) {
    clone
      .querySelectorAll("script, style, noscript, svg, iframe, canvas, template")
      .forEach((el) => el.remove());
  }
  const visibleText = (clone?.innerText || document.body?.innerText || "")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = visibleText ? visibleText.split(/\s+/).filter(Boolean).length : 0;

  const isHttps = location.protocol === "https:";
  const mixedContentUrls: string[] = [];
  if (isHttps) {
    const attrs = [
      ["img", "src"],
      ["script", "src"],
      ["iframe", "src"],
      ["source", "src"],
      ["video", "src"],
      ["audio", "src"],
      ["link", "href"],
    ] as const;
    for (const [tag, attr] of attrs) {
      document.querySelectorAll(`${tag}[${attr}]`).forEach((el) => {
        const value = el.getAttribute(attr);
        if (!value) return;
        const resolved = abs(value);
        if (resolved.startsWith("http://") && mixedContentUrls.length < 20) {
          mixedContentUrls.push(resolved);
        }
      });
    }
  }

  return {
    url: location.href,
    title,
    metaDescription,
    canonical: canonical ? abs(canonical) : null,
    metaRobots,
    headings,
    h1Count,
    schemaTypes: Array.from(new Set(schemaTypes)),
    imagesMissingAlt: { src: "aggregate", count: imagesMissingAltCount },
    imagesMissingAltSamples,
    internalLinkCount,
    externalLinkCount,
    wordCount,
    isHttps,
    mixedContentUrls: Array.from(new Set(mixedContentUrls)),
  };
}
