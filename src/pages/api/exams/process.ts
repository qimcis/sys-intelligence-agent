import type { APIRoute } from "astro";
import { extractTextFromFile } from "../../../lib/pdf-utils";
import { callOpenAI } from "../../../lib/openai-client";
import { COURSEEXAM_PATH } from "../../../lib/config";
import fs from "fs/promises";
import path from "path";

function getExamPath(repoPath?: string): string {
  if (repoPath) {
    return path.join(repoPath, "benchmarks", "courseexam_bench", "data", "raw");
  }
  return COURSEEXAM_PATH;
}

const EXAM_SYSTEM_PROMPT = `You are an expert at converting exam documents into a structured markdown format for the CourseExam benchmark.

You will receive:
1. The raw text of an exam
2. The raw text of the solutions
3. Optional metadata overrides (any field not provided should be inferred from the exam content)

Your task is to produce a single exam.md file that follows this EXACT format:

IMPORTANT: For any metadata fields not explicitly provided, you MUST infer them from the exam content:
- exam_id: Generate from course code, semester, year, and exam type (e.g., "cs537_fall_2021_final"). Use lowercase with underscores.
- test_paper_name: Create a human-readable title from the exam header/title
- course: Extract the course name from the exam
- institution: Look for university name in headers, footers, or letterhead
- year: Extract from date on exam or filename
- score_total: Sum up all question points, or use stated total
- tags: Generate relevant topic tags based on the exam content

1. Start with a JSON metadata block (no markdown code fence, just raw JSON):
{
  "exam_id": "unique_exam_id",
  "test_paper_name": "Human readable exam title",
  "course": "Course name",
  "institution": "University name",
  "year": 2024,
  "score_total": 100,
  "num_questions": 10
}

2. Then for each question, use this format (separated by ---):

---

## Question {number} [{points} points]

{Question text - convert any images to text descriptions if possible, otherwise note "[Figure excluded]"}

\`\`\`json
{
  "problem_id": "{number}",
  "points": {points},
  "type": "ExactMatch" or "Freeform",
  "tags": ["tag1", "tag2"],
  "choices": ["A option", "B option", "C option", "D option"],  // Only for ExactMatch with choices
  "answer": "The correct answer (letter A/B/C/D for choices, or full text for Freeform)",
  "llm_judge_instructions": "Rubric for grading (required for Freeform)",
  "comments": "Optional explanation"
}
\`\`\`

IMPORTANT RULES:
- For multiple choice questions, use type "ExactMatch" and include "choices" array. Answer should be the letter (A, B, C, D).
- For True/False, use type "ExactMatch" with choices ["True", "False"]. Answer should be "A" for True, "B" for False.
- For free-form/explanation questions, use type "Freeform" and include "llm_judge_instructions" with a detailed rubric.
- For multi-select questions, use type "Freeform" since multiple answers are possible.
- For multi-part questions (e.g., 5.1, 5.2), create separate question entries with sub-IDs.
- Tags should be lowercase with hyphens (e.g., "operating-systems", "virtual-memory").
- If a question relies on a figure/image that cannot be described in text, exclude it and update score_total accordingly.
- The sum of all question points MUST equal score_total in the metadata.

Output ONLY the exam.md content, no other text.`;

export const POST: APIRoute = async ({ request }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const log = (msg: string) => {
        controller.enqueue(encoder.encode(msg + "\n"));
      };

      try {
        const formData = await request.formData();

        const examId = formData.get("examId") as string;
        const examName = formData.get("examName") as string;
        const course = formData.get("course") as string;
        const institution = formData.get("institution") as string;
        const year = formData.get("year") as string;
        const scoreTotal = formData.get("scoreTotal") as string;
        const tags = formData.get("tags") as string;
        const notes = formData.get("notes") as string;
        const examFile = formData.get("examFile") as File;
        const solutionsFile = formData.get("solutionsFile") as File;
        const apiKey =
          (formData.get("apiKey") as string) || process.env.OPENAI_API_KEY;
        const repoPath = formData.get("repoPath") as string;

        if (!apiKey) {
          log(
            "ERROR: No OpenAI API key provided. Set OPENAI_API_KEY environment variable or enter it in the UI.",
          );
          controller.close();
          return;
        }

        log(`[1/5] Extracting text from exam file: ${examFile.name}`);
        const examText = await extractTextFromFile(examFile);
        log(`  -> Extracted ${examText.length} characters`);

        log(`[2/5] Extracting text from solutions file: ${solutionsFile.name}`);
        const solutionsText = await extractTextFromFile(solutionsFile);
        log(`  -> Extracted ${solutionsText.length} characters`);

        log(`[3/5] Calling OpenAI to generate structured exam.md...`);

        // Build metadata overrides section - only include fields that were provided
        const overrides: string[] = [];
        if (examId) overrides.push(`- Exam ID: ${examId}`);
        if (examName) overrides.push(`- Exam Name: ${examName}`);
        if (course) overrides.push(`- Course: ${course}`);
        if (institution) overrides.push(`- Institution: ${institution}`);
        if (year) overrides.push(`- Year: ${year}`);
        if (scoreTotal) overrides.push(`- Total Score: ${scoreTotal}`);
        if (tags) overrides.push(`- Tags: ${tags}`);

        const overridesSection =
          overrides.length > 0
            ? `The following metadata was explicitly provided as overrides (use these values):\n${overrides.join("\n")}\n\nFor any fields NOT listed above, infer them from the exam content.`
            : `No metadata overrides were provided. Infer ALL metadata fields from the exam content.`;

        const userPrompt = `${overridesSection}

Additional notes from the uploader:
${notes || "None"}

=== EXAM CONTENT ===
${examText}

=== SOLUTIONS ===
${solutionsText}

Please generate the exam.md file following the exact format specified. Remember to infer any metadata not explicitly provided above.`;

        const examMd = await callOpenAI(
          [
            { role: "system", content: EXAM_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          apiKey,
        );

        log(`  -> Generated ${examMd.length} characters of exam.md`);

        // Extract exam_id from generated content if not provided
        let finalExamId = examId;
        if (!finalExamId) {
          const match = examMd.match(/"exam_id"\s*:\s*"([^"]+)"/);
          if (match) {
            finalExamId = match[1];
            log(`  -> Auto-generated exam ID: ${finalExamId}`);
          } else {
            finalExamId = `exam_${Date.now()}`;
            log(
              `  -> Could not extract exam ID, using fallback: ${finalExamId}`,
            );
          }
        }

        const courseExamPath = getExamPath(repoPath);
        log(`[4/5] Creating exam directory: ${finalExamId}`);
        log(`  -> Using repo path: ${courseExamPath}`);
        const examDir = path.join(courseExamPath, finalExamId);
        await fs.mkdir(examDir, { recursive: true });

        log(`[5/5] Writing exam.md to ${examDir}/exam.md`);
        await fs.writeFile(path.join(examDir, "exam.md"), examMd, "utf-8");

        // Handle reference files
        const referenceFiles = formData.getAll("referenceFiles") as File[];
        if (referenceFiles.length > 0) {
          log(`[+] Writing ${referenceFiles.length} reference file(s)...`);
          for (const refFile of referenceFiles) {
            const refPath = path.join(examDir, refFile.name);
            const refContent = Buffer.from(await refFile.arrayBuffer());
            await fs.writeFile(refPath, refContent);
            log(`  -> ${refFile.name}`);
          }
        }

        log(`\n=== SUCCESS ===`);
        log(`Exam added to: ${examDir}`);
        log(`\nNext steps:`);
        log(`1. Review the generated exam.md file`);
        log(
          `2. Run 'python prepare_dataset.py' in the courseexam_bench directory to regenerate the dataset`,
        );
        log(`3. Commit your changes to the repository`);

        controller.close();
      } catch (error) {
        log(`\nERROR: ${error}`);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
    },
  });
};
