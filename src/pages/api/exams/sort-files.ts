import type { APIRoute } from "astro";
import { callOpenAI, MODELS } from "../../../lib/openai-client";

const SORT_SYSTEM_PROMPT = `You are an expert at analyzing exam file names and organizing them for processing.

You will receive a list of file names. Your task is to group them into exams.

IMPORTANT: Many solution files contain BOTH questions AND answers in one document.
- Files like "F18-midterm-sol.pdf", "comp3000-final-2014F-sol.pdf", "W19-midterm-sol.pdf" are COMBINED files
- These contain the full exam with answers included
- For combined files: set BOTH exam_file AND solutions_file to the SAME filename

File naming patterns:
- Combined Q&A files often have: "-sol", "-soln", "-solution", "-answers" in the name WITH NO separate exam file
- Semester codes: F=Fall, W=Winter, S=Spring/Summer, followed by year (e.g., F18=Fall 2018, W19=Winter 2019)
- Exam types: "midterm", "mid", "final", "quiz", "exam"

TWO SCENARIOS:

1. COMBINED Q&A files (most common when only solution files are uploaded):
{
  "exams": [
    {
      "exam_file": "F18-midterm-sol.pdf",
      "solutions_file": "F18-midterm-sol.pdf",
      "reference_files": [],
      "inferred_name": "Fall 2018 Midterm"
    }
  ]
}

2. SEPARATE exam and solution files:
{
  "exams": [
    {
      "exam_file": "F18-midterm.pdf",
      "solutions_file": "F18-midterm-sol.pdf",
      "reference_files": [],
      "inferred_name": "Fall 2018 Midterm"
    }
  ]
}

Rules:
- If ALL files have "sol", "soln", "solution", or "answers" in the name, treat them ALL as combined Q&A files
- For combined files, exam_file and solutions_file should be THE SAME file
- inferred_name: Extract semester, year, and exam type (e.g., "Fall 2018 Midterm", "Winter 2019 Final")

Output ONLY valid JSON, no explanations.`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { fileNames, apiKey } = await request.json();

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "No API key provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return new Response(JSON.stringify({ error: "No files provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userPrompt = `Here are the uploaded file names:\n${fileNames.map((f: string, i: number) => `${i + 1}. ${f}`).join("\n")}\n\nPlease analyze these files and group them into exam/solution pairs.`;

    const response = await callOpenAI(
      [
        { role: "system", content: SORT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      apiKey,
      MODELS.judge, // Using gpt-5-mini for sorting
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
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
