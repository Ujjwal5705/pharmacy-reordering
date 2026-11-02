/**
 * Renders the SYNTHETIC prescription fixtures used by the demo and the tests, and writes
 * fixtures/prescriptions/manifest.json with each file's SHA-256 and its ground-truth transcription.
 * All names, clinics and registration numbers are fictional. Requires `npx playwright install chromium`.
 *
 *   npm run fixtures:generate
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import type { RawExtraction } from "../src/server/extraction/types";

type Fixture = {
  file: string;
  description: string;
  patient: string;
  doctor: string;
  regNo: string;
  clinic: string;
  date: string;
  lines: string[];
  style: "print" | "handwritten-blurred";
  transcription: RawExtraction;
};

const f = (value: string | number | null, confidence: number) => ({ value, confidence }) as never;

const FIXTURES: Fixture[] = [
  {
    file: "rx-sunita-ghosh.png",
    description: "Readable printed prescription: metformin with written dosage, levothyroxine 'as directed' (no dosage).",
    patient: "Sunita Ghosh",
    doctor: "Dr. Arindam Banerjee",
    regNo: "WBMC-DEMO-1042",
    clinic: "12 Demo Lane, Sector II, Salt Lake, Kolkata",
    date: "03/10/2026",
    lines: ["1. Tab. Metformin 500 mg 1-0-1 (twice daily) x 30 days", "2. Tab. Levothyroxine 50 mcg as directed"],
    style: "print",
    transcription: {
      pageConfidence: 0.93,
      fields: [
        { key: "patient_name", value: "Sunita Ghosh", confidence: 0.95 },
        { key: "prescriber_name", value: "Dr. Arindam Banerjee", confidence: 0.94 },
        { key: "prescriber_reg_no", value: "WBMC-DEMO-1042", confidence: 0.9 },
        { key: "prescriber_address", value: "12 Demo Lane, Sector II, Salt Lake, Kolkata", confidence: 0.88 },
        { key: "prescription_date", value: "03/10/2026", confidence: 0.92 },
      ],
      lines: [
        {
          medicineName: f("Metformin", 0.96),
          strength: f("500 mg", 0.95),
          form: "Tablet",
          dosageText: f("1-0-1 (twice daily)", 0.93),
          durationDays: f(30, 0.92),
          quantityUnits: f(null, 0),
        },
        {
          medicineName: f("Levothyroxine", 0.94),
          strength: f("50 mcg", 0.93),
          form: "Tablet",
          dosageText: f(null, 0),
          durationDays: f(null, 0),
          quantityUnits: f(null, 0),
        },
      ],
    },
  },
  {
    file: "rx-rina-sen.png",
    description: "Readable printed prescription: telmisartan once daily for 30 days.",
    patient: "Rina Sen",
    doctor: "Dr. Moumita Chatterjee",
    regNo: "WBMC-DEMO-2210",
    clinic: "4 Sample Road, Behala, Kolkata",
    date: "20/10/2026",
    lines: ["1. Tab. Telmisartan 40 mg 1-0-0 (once daily) x 30 days"],
    style: "print",
    transcription: {
      pageConfidence: 0.94,
      fields: [
        { key: "patient_name", value: "Rina Sen", confidence: 0.96 },
        { key: "prescriber_name", value: "Dr. Moumita Chatterjee", confidence: 0.93 },
        { key: "prescriber_reg_no", value: "WBMC-DEMO-2210", confidence: 0.91 },
        { key: "prescriber_address", value: "4 Sample Road, Behala, Kolkata", confidence: 0.89 },
        { key: "prescription_date", value: "20/10/2026", confidence: 0.93 },
      ],
      lines: [
        {
          medicineName: f("Telmisartan", 0.95),
          strength: f("40 mg", 0.95),
          form: "Tablet",
          dosageText: f("1-0-0 (once daily)", 0.94),
          durationDays: f(30, 0.93),
          quantityUnits: f(null, 0),
        },
      ],
    },
  },
  {
    file: "rx-arif-mondal-blurred.png",
    description: "Blurred handwritten-style photo: strength illegible. Must trigger a re-upload request.",
    patient: "Arif Mondal",
    doctor: "Dr. Shirin Haque",
    regNo: "WBMC-DEMO-3307",
    clinic: "9 Example Street, Howrah Maidan, Howrah",
    date: "18/10/2026",
    lines: ["1. Tab. Levothyroxine 50 mcg 1-0-0 x 100 days"],
    style: "handwritten-blurred",
    transcription: {
      pageConfidence: 0.38,
      fields: [
        { key: "patient_name", value: "Arif Mondal", confidence: 0.52 },
        { key: "prescriber_name", value: null, confidence: 0 },
      ],
      lines: [
        {
          medicineName: f("Levothyrox", 0.41),
          strength: f(null, 0),
          form: "Tablet",
          dosageText: f(null, 0),
          durationDays: f(null, 0),
          quantityUnits: f(null, 0),
        },
      ],
    },
  },
  {
    file: "rx-debasish-ghosh.png",
    description: "Readable printed prescription: telmisartan and amlodipine with written dosage.",
    patient: "Debasish Ghosh",
    doctor: "Dr. Arindam Banerjee",
    regNo: "WBMC-DEMO-1042",
    clinic: "12 Demo Lane, Sector II, Salt Lake, Kolkata",
    date: "01/09/2026",
    lines: ["1. Tab. Telmisartan 40 mg 1-0-0 (once daily) x 30 days", "2. Tab. Amlodipine 5 mg 0-0-1 x 30 days"],
    style: "print",
    transcription: {
      pageConfidence: 0.93,
      fields: [
        { key: "patient_name", value: "Debasish Ghosh", confidence: 0.95 },
        { key: "prescriber_name", value: "Dr. Arindam Banerjee", confidence: 0.94 },
        { key: "prescriber_reg_no", value: "WBMC-DEMO-1042", confidence: 0.9 },
        { key: "prescriber_address", value: "12 Demo Lane, Sector II, Salt Lake, Kolkata", confidence: 0.88 },
        { key: "prescription_date", value: "01/09/2026", confidence: 0.92 },
      ],
      lines: [
        {
          medicineName: f("Telmisartan", 0.95),
          strength: f("40 mg", 0.94),
          form: "Tablet",
          dosageText: f("1-0-0 (once daily)", 0.93),
          durationDays: f(30, 0.92),
          quantityUnits: f(null, 0),
        },
        {
          medicineName: f("Amlodipine", 0.94),
          strength: f("5 mg", 0.93),
          form: "Tablet",
          dosageText: f("0-0-1", 0.92),
          durationDays: f(30, 0.92),
          quantityUnits: f(null, 0),
        },
      ],
    },
  },
  {
    file: "rx-priya-das-h1.png",
    description: "Readable printed prescription for the fictional Schedule H1 demo item (exercises the H1 register).",
    patient: "Priya Das",
    doctor: "Dr. Kaushik Mitra",
    regNo: "WBMC-DEMO-4419",
    clinic: "27 Placeholder Avenue, Gariahat, Kolkata",
    date: "28/10/2026",
    lines: ["1. Cap. Cefdinova 300 mg 1-0-1 (twice daily) x 5 days"],
    style: "print",
    transcription: {
      pageConfidence: 0.94,
      fields: [
        { key: "patient_name", value: "Priya Das", confidence: 0.96 },
        { key: "prescriber_name", value: "Dr. Kaushik Mitra", confidence: 0.93 },
        { key: "prescriber_reg_no", value: "WBMC-DEMO-4419", confidence: 0.9 },
        { key: "prescriber_address", value: "27 Placeholder Avenue, Gariahat, Kolkata", confidence: 0.88 },
        { key: "prescription_date", value: "28/10/2026", confidence: 0.93 },
      ],
      lines: [
        {
          medicineName: f("Cefdinova", 0.94),
          strength: f("300 mg", 0.95),
          form: "Capsule",
          dosageText: f("1-0-1 (twice daily)", 0.93),
          durationDays: f(5, 0.92),
          quantityUnits: f(null, 0),
        },
      ],
    },
  },
];

function html(fx: Fixture) {
  const hand = fx.style === "handwritten-blurred";
  const bodyFont = hand ? `"Bradley Hand", "Noteworthy", "Chalkboard SE", cursive` : `Helvetica, Arial, sans-serif`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: ${hand ? "#e9e4d8" : "#ffffff"}; }
    .page { width: 1100px; height: 1460px; box-sizing: border-box; padding: 60px 70px; font-family: Helvetica, Arial, sans-serif; color: #1b1b1b;
            ${hand ? "filter: blur(2.6px) contrast(0.55) brightness(1.05); transform: rotate(-2.5deg);" : ""} }
    .banner { border: 3px dashed #b42318; color: #b42318; font-weight: 700; font-size: 22px; padding: 10px 14px; text-align: center; letter-spacing: .5px; }
    h1 { font-size: 40px; margin: 36px 0 4px; }
    .muted { font-size: 26px; color: #333; margin: 6px 0; }
    hr { border: 0; border-top: 3px solid #1b1b1b; margin: 28px 0; }
    .rx { font-size: 54px; font-weight: 700; margin: 10px 0 18px; }
    .line { font-family: ${bodyFont}; font-size: ${hand ? 44 : 36}px; margin: 26px 0; }
    .sig { margin-top: 120px; font-size: 26px; }
    .foot { position: absolute; bottom: 50px; left: 70px; right: 70px; font-size: 20px; color: #b42318; text-align: center; }
  </style></head><body><div class="page" style="position:relative">
    <div class="banner">SYNTHETIC DEMO PRESCRIPTION - FICTIONAL PEOPLE - NOT VALID FOR DISPENSING</div>
    <h1>${fx.doctor}</h1>
    <div class="muted">Reg. No: ${fx.regNo}</div>
    <div class="muted">Clinic: ${fx.clinic}</div>
    <hr/>
    <div class="muted">Patient: ${fx.patient}</div>
    <div class="muted">Date: ${fx.date}</div>
    <div class="rx">Rx</div>
    ${fx.lines.map((l) => `<div class="line">${l}</div>`).join("\n")}
    <div class="sig">Signature: ____________________</div>
    <div class="foot">Generated test fixture for a software prototype. Contains no real patient data.</div>
  </div></body></html>`;
}

async function main() {
  const dir = path.join(process.cwd(), "fixtures", "prescriptions");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 1460 } });
  const manifest: { fixtures: { file: string; description: string; sha256: string; transcription: RawExtraction }[] } = {
    fixtures: [],
  };
  for (const fx of FIXTURES) {
    await page.setContent(html(fx));
    const out = path.join(dir, fx.file);
    await page.screenshot({ path: out, type: "png", fullPage: false });
    const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
    manifest.fixtures.push({ file: fx.file, description: fx.description, sha256, transcription: fx.transcription });
    console.log(`wrote ${fx.file}`);
  }
  // A PDF variant to exercise the "cannot read automatically → manual review" path for local OCR.
  await page.setContent(html(FIXTURES[1]));
  await page.pdf({ path: path.join(dir, "rx-rina-sen.pdf"), width: "1100px", height: "1460px", printBackground: true });
  console.log("wrote rx-rina-sen.pdf");
  await browser.close();
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("wrote manifest.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
