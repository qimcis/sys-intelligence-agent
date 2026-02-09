import { pdf } from "pdf-to-img";
import { callAnthropic } from "./anthropic-client";

const MIN_TEXT_LENGTH = 100;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error(`Failed to parse PDF: ${error}`);
  }
}

export async function extractTextFromPdfWithOcr(
  buffer: Buffer,
  apiKey: string,
  onLog?: (msg: string) => void,
): Promise<string> {
  let extractedText = "";
  try {
    extractedText = await extractTextFromPdf(buffer);
  } catch {}

  if (extractedText.trim().length >= MIN_TEXT_LENGTH) {
    return extractedText;
  }

  if (onLog) {
    onLog("PDF appears to be image-based, using OCR...");
  } else {
    console.log("PDF appears to be image-based, using OCR...");
  }

  const pages: string[] = [];
  let pageNum = 0;

  const pdfDocument = await pdf(buffer, { scale: 2.0 });
  for await (const image of pdfDocument) {
    pageNum++;
    const base64Image = image.toString("base64");

    const pageText = await callAnthropic(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text from this image exactly as it appears. Preserve the original formatting, layout, and structure as much as possible. Include all questions, answers, headers, footers, and any other text. Output ONLY the extracted text, nothing else.",
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: base64Image,
              },
            },
          ],
        },
      ],
      apiKey,
      undefined,
      { maxTokens: 4096 },
    );
    pages.push(`--- Page ${pageNum} ---\n${pageText}`);
  }

  return pages.join("\n\n");
}

export async function extractTextFromFile(
  file: File,
  apiKey?: string,
  onLog?: (msg: string) => void,
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.name.endsWith(".pdf")) {
    if (apiKey) {
      return extractTextFromPdfWithOcr(buffer, apiKey, onLog);
    }
    return extractTextFromPdf(buffer);
  } else if (file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    return buffer.toString("utf-8");
  } else {
    throw new Error(`Unsupported file type: ${file.name}`);
  }
}
