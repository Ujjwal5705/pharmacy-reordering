/**
 * Builds the assignment submission:
 *   submission/TDD-pharmacy-reordering.pdf   (rendered from docs/TDD.md with Chromium)
 *   submission/deployment.md
 *   submission/pharmacy-reordering-submission.zip  (exactly those two files)
 *
 *   npm run submission:build      (needs `npx playwright install chromium` once)
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { marked } from "marked";

const root = path.resolve(__dirname, "..");
const docs = path.join(root, "docs");
const out = path.join(root, "submission");
const REPO = "https://github.com/Ujjwal5705/pharmacy-reordering";
const PDF = "TDD-pharmacy-reordering.pdf";
const ZIP = "pharmacy-reordering-submission.zip";

function inlineImages(html: string) {
  return html.replace(/<img src="([^"]+)" alt="([^"]*)"(?: width="\d+")?/g, (_m, src: string, alt: string) => {
    const file = path.join(docs, src);
    const ext = path.extname(file).slice(1);
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const cls = src.startsWith("diagrams/") ? "diagram" : /0[1-5]-|12-/.test(src) ? "phone" : "wide";
    return `<img class="${cls}" src="data:${mime};base64,${readFileSync(file).toString("base64")}" alt="${alt}"`;
  });
}

function absoluteLinks(html: string) {
  return html.replace(/href="\.\.\/deployment\.md"/g, `href="${REPO}/blob/main/deployment.md"`);
}

const CSS = `
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, "Noto Sans", sans-serif; color: #14201b; font-size: 10.2pt; line-height: 1.45; }
  h1 { font-size: 19pt; line-height: 1.2; margin: 0 0 8pt; color: #0b5549; }
  h2 { font-size: 14pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #0f6b5c; color: #0b5549; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
  p, li { margin: 4pt 0; }
  ul, ol { padding-left: 16pt; }
  a { color: #0b5549; }
  code { font-family: Menlo, Consolas, monospace; font-size: 8.8pt; background: #f1f4f2; padding: 0 2pt; border-radius: 2pt; }
  blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #fff3dc; border-left: 3pt solid #8a5300; }
  blockquote p { margin: 0; }
  hr { border: 0; border-top: 0.6pt solid #c3cec8; margin: 10pt 0; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.8pt; break-inside: auto; }
  tr { break-inside: avoid; }
  th, td { border: 0.6pt solid #c3cec8; padding: 3.5pt 5pt; vertical-align: top; text-align: left; }
  th { background: #e2f1ec; }
  img.diagram { width: 100%; display: block; margin: 6pt 0; break-inside: avoid; }
  img.wide { width: 100%; display: block; margin: 8pt 0 2pt; border: 0.6pt solid #c3cec8; break-inside: avoid; }
  img.phone { height: 105mm; width: auto; display: block; margin: 0 auto; border: 0.6pt solid #c3cec8; }
  td img.phone { margin: 4pt auto; }
  em { color: #3c4a44; }
  table.shots, table.shots td { border: 0; background: none; text-align: center; font-size: 9pt; }
  table.shots td { width: 50%; padding: 4pt 6pt 10pt; }
  p:has(> img.wide) { break-inside: avoid; }
`;

async function main() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const md = readFileSync(path.join(docs, "TDD.md"), "utf8");
  const body = absoluteLinks(inlineImages(await marked.parse(md)));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Technical Design Document — Pharmacy Reordering</title><style>${CSS}</style></head><body>${body}</body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: path.join(out, PDF),
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#5f6e67;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>Pharmacy reordering prototype — TDD · synthetic data only</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" },
  });
  await browser.close();

  copyFileSync(path.join(root, "deployment.md"), path.join(out, "deployment.md"));
  execFileSync("zip", ["-j", "-X", "-q", path.join(out, ZIP), path.join(out, PDF), path.join(out, "deployment.md")]);
  const listing = execFileSync("unzip", ["-l", path.join(out, ZIP)]).toString();
  const mb = statSync(path.join(out, ZIP)).size / 1024 / 1024;
  console.log(listing);
  console.log(`ZIP size: ${mb.toFixed(2)} MB (limit 25 MB)`);
  if (mb > 25) throw new Error("Submission ZIP exceeds 25 MB");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
