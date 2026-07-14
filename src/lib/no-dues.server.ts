/**
 * No-Dues server-only helpers (PDF, QR, storage upload, hashing).
 * NEVER import this from client code — filename ends in `.server.ts`.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { createHash, randomBytes } from "node:crypto";

export function generateRawToken(): string {
  // 32 bytes → 43-char base64url token
  return randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

interface CertificateInput {
  societyName: string;
  societyAddress?: string | null;
  unitLabel: string;
  residentName: string;
  certificateNumber: string;
  issuedAt: Date;
  validUntil?: Date | null;
  verificationUrl: string;
}

export async function renderCertificatePdf(input: CertificateInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  // Border
  page.drawRectangle({
    x: 30, y: 30, width: width - 60, height: height - 60,
    borderColor: rgb(0.1, 0.2, 0.5), borderWidth: 2,
  });

  page.drawText("NO DUES CERTIFICATE", {
    x: 90, y: height - 100, size: 24, font, color: rgb(0.1, 0.2, 0.5),
  });
  page.drawText(input.societyName, {
    x: 90, y: height - 130, size: 14, font: body, color: rgb(0.2, 0.2, 0.2),
  });
  if (input.societyAddress) {
    page.drawText(input.societyAddress.slice(0, 90), {
      x: 90, y: height - 148, size: 10, font: body, color: rgb(0.35, 0.35, 0.35),
    });
  }

  const lines = [
    ["Certificate No.", input.certificateNumber],
    ["Issued To", input.residentName],
    ["Unit", input.unitLabel],
    ["Issue Date", input.issuedAt.toISOString().slice(0, 10)],
    ["Valid Until", input.validUntil ? input.validUntil.toISOString().slice(0, 10) : "—"],
  ];
  let y = height - 210;
  for (const [k, v] of lines) {
    page.drawText(`${k}:`, { x: 90, y, size: 12, font, color: rgb(0.15, 0.15, 0.15) });
    page.drawText(v, { x: 220, y, size: 12, font: body, color: rgb(0.15, 0.15, 0.15) });
    y -= 24;
  }

  page.drawText(
    "This is to certify that the above unit has no outstanding dues with the society",
    { x: 90, y: y - 20, size: 11, font: body, color: rgb(0.25, 0.25, 0.25) },
  );
  page.drawText(
    "as of the issue date. Verify authenticity by scanning the QR code below.",
    { x: 90, y: y - 36, size: 11, font: body, color: rgb(0.25, 0.25, 0.25) },
  );

  // QR
  const qrDataUrl = await QRCode.toDataURL(input.verificationUrl, { margin: 1, width: 220 });
  const qrPng = await doc.embedPng(qrDataUrl);
  page.drawImage(qrPng, { x: width / 2 - 90, y: 120, width: 180, height: 180 });
  page.drawText("Scan to verify", { x: width / 2 - 40, y: 100, size: 10, font: body, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(input.verificationUrl.slice(0, 60), {
    x: 60, y: 60, size: 8, font: body, color: rgb(0.45, 0.45, 0.45),
  });

  return await doc.save();
}
