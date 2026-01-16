import pdf from 'pdf-parse';

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdf(buffer);
    return data.text;
  } catch (error) {
    throw new Error(`Failed to parse PDF: ${error}`);
  }
}

export async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  
  if (file.name.endsWith('.pdf')) {
    return extractTextFromPdf(buffer);
  } else if (file.name.endsWith('.txt') || file.name.endsWith('.md')) {
    return buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${file.name}`);
  }
}
