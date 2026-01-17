import { pdf } from "pdf-to-img";

// Minimum text length to consider a PDF as having extractable text
const MIN_TEXT_LENGTH = 100;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    // Import pdf-parse's core functionality directly to avoid test file issue
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
): Promise<string> {
  // First, try regular text extraction
  let extractedText = "";
  try {
    extractedText = await extractTextFromPdf(buffer);
  } catch {
    // Ignore extraction errors, we'll try OCR
  }

  // If we got enough text, return it
  if (extractedText.trim().length >= MIN_TEXT_LENGTH) {
    return extractedText;
  }

  // Otherwise, use OCR via OpenAI Vision API
  console.log("PDF appears to be image-based, using OCR...");

  const pages: string[] = [];
  let pageNum = 0;

  // Convert PDF pages to images
  const pdfDocument = await pdf(buffer, { scale: 2.0 });
  for await (const image of pdfDocument) {
    pageNum++;
    // image is a Buffer containing PNG data
    const base64Image = image.toString("base64");

    // Call OpenAI Vision API to extract text
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract ALL text from this image exactly as it appears. Preserve the original formatting, layout, and structure as much as possible. Include all questions, answers, headers, footers, and any other text. Output ONLY the extracted text, nothing else.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${error}`);
    }

    const result = await response.json();
    const pageText = result.choices?.[0]?.message?.content || "";
    pages.push(`--- Page ${pageNum} ---\n${pageText}`);
  }

  return pages.join("\n\n");
}

export async function extractTextFromFile(
  file: File,
  apiKey?: string,
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.name.endsWith(".pdf")) {
    if (apiKey) {
      return extractTextFromPdfWithOcr(buffer, apiKey);
    }
    return extractTextFromPdf(buffer);
  } else if (file.name.endsWith(".txt") || file.name.endsWith(".md")) {
    return buffer.toString("utf-8");
  } else {
    throw new Error(`Unsupported file type: ${file.name}`);
  }
}
