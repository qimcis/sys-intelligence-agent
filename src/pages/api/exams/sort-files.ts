import type { APIRoute } from "astro";
import { callOpenAI, MODELS } from "../../../lib/openai-client";

const SORT_SYSTEM_PROMPT = `You are an expert at analyzing exam file names and matching exam questions with their solutions.

You will receive a list of file names. Your task is to:
1. Identify which files are exam questions and which are solutions
2. Match each exam file with its corresponding solutions file
3. Group them into exam pairs

File naming patterns to look for:
- Exams often contain: "exam", "midterm", "final", "quiz", "test", "questions", "problems"
- Solutions often contain: "solution", "solutions", "answer", "answers", "key", "sol"
- Files from the same exam usually share: course code, semester, year, exam type
- Examples: "cs537-fall21-final.pdf" pairs with "cs537-fall21-final-solutions.pdf"

Output a JSON array where each object represents one exam:
{
  "exams": [
    {
      "exam_file": "filename1.pdf",
      "solutions_file": "filename2.pdf",
      "reference_files": ["ref1.pdf"],
      "inferred_name": "CS 537 Fall 2021 Final"
    }
  ]
}

Rules:
- Every exam MUST have both an exam_file and solutions_file
- If you cannot confidently match a file, exclude it and note it in an "unmatched" array
- reference_files are optional supplementary materials (syllabus, lecture notes, etc.)
- inferred_name should be a human-readable name based on the filename

Output ONLY valid JSON, no explanations.`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { fileNames, apiKey } = await request.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "No API key provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return new Response(
        JSON.stringify({ error: "No files provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const userPrompt = `Here are the uploaded file names:\n${fileNames.map((f: string, i: number) => `${i + 1}. ${f}`).join("\n")}\n\nPlease analyze these files and group them into exam/solution pairs.`;

    const response = await callOpenAI(
      [
        { role: "system", content: SORT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      apiKey,
      MODELS.judge // Using gpt-5-mini for sorting
    );

    // Parse the JSON response
    let result;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: response }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};
