import type { APIRoute } from "astro";
import { extractTextFromFile } from "../../../lib/pdf-utils";
import { callOpenAI, MODELS } from "../../../lib/openai-client";
import { BENCHMARK_REPO_PATH, COURSEEXAM_PATH } from "../../../lib/config";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const JUDGE_SYSTEM_PROMPT = `You are a meticulous judge that validates and corrects exam markdown files for the CourseExam benchmark.

Your task is to review the generated exam.md content and fix ALL issues:

VALIDATION CHECKS:
1. VERIFY score_total: Sum all "points" values. The score_total in metadata MUST equal this sum.
2. VERIFY num_questions: Count all questions including sub-parts (8a, 8b, 8c each count as 1). The num_questions in metadata MUST match.
3. CHECK format consistency: All questions must follow the correct format.
4. FIX any JSON syntax errors.
5. ENSURE the # header matches test_paper_name in metadata.

CRITICAL CONTENT CHECKS - FIX THESE:
6. REMOVE any answers/solutions from the question text body. Questions should ONLY contain what a student sees on the exam.
7. For Freeform questions: REMOVE "choices" field - it should NOT exist. Keep "answer" field.
8. For Freeform questions: ENSURE "answer" and "llm_judge_instructions" exist.
9. For ExactMatch questions: ENSURE "choices" array and "answer" field exist.
10. REMOVE any student responses, professor comments, or solution text that got mixed into question text body.
11. FIX vague llm_judge_instructions. Replace phrases like "Grade by understanding" or "Provide scoring rubrics" with specific point allocations (e.g., "Award 2 pts for X, 1 pt for Y").
12. VERIFY llm_judge_instructions point allocations sum to the question's total points and match any rubric given in the source solutions.
13. CHECK question numbering is consistent - no gaps (e.g., Q1, Q2, Q4 missing Q3). If source has gaps, renumber sequentially.
14. VERIFY num_questions matches actual question count (count all problem_ids including sub-parts like 8a, 8b as separate questions).
15. REMOVE any skipped/excluded questions entirely (e.g., "Skipped", "Excluded", or points=0). Do NOT include them in the output.
16. UPDATE score_total and num_questions after removing any skipped/excluded questions.

EXAMPLE OF BAD (fix this):
## Question 1 [5 points]
What does TLB stand for?
TLB stands for Translation Lookaside Buffer.  <-- REMOVE THIS, it's the answer!

EXAMPLE OF GOOD:
## Question 1 [5 points]
What does TLB stand for?

If you find errors, output the CORRECTED exam.md content.
If everything is correct, output the original content unchanged.

Output ONLY the exam.md content, no explanations or commentary.`;

const FORMAT_SYSTEM_PROMPT = `You are a strict formatter for CourseExam exam.md files.

Your job is to fix formatting only so the file can be parsed by prepare_dataset.py.
Do NOT change meaning, answers, points, tags, or question text.
Do NOT add or remove questions.

FORMAT REQUIREMENTS:
1. The exam metadata JSON must be the first JSON block in the file.
2. Every JSON block must be fenced with exactly:
   \`\`\`json
   { ... }
   \`\`\`
3. Each question must have exactly one JSON block, and the block must be closed.
4. Question separators must be exactly a line containing only: ---
5. Preserve all content; only fix formatting issues (missing/extra backticks, stray whitespace around separators, etc.).

If the input is already correctly formatted, output it unchanged.
Output ONLY the corrected exam.md content, no explanations or commentary.`;

function getExamPath(repoPath?: string): string {
  if (repoPath) {
    return path.join(repoPath, "benchmarks", "courseexam_bench", "data", "raw");
  }
  return COURSEEXAM_PATH;
}

function getCourseExamBenchPath(repoPath?: string): string {
  const basePath = repoPath || BENCHMARK_REPO_PATH;
  return path.join(basePath, "benchmarks", "courseexam_bench");
}

const EXAM_SYSTEM_PROMPT = `You are an expert at converting exam documents into a structured markdown format for the CourseExam benchmark.

You will receive:
1. The raw text of an exam (questions only)
2. The raw text of the solutions (answers)
3. Optional metadata overrides

Your task is to produce a single exam.md file with ONLY THE QUESTIONS (no answers in the question text).

CRITICAL RULES - READ CAREFULLY:
1. DO NOT include answers, solutions, or student responses in the question text
2. DO NOT include "choices" field for Freeform questions - only use it for ExactMatch
3. The solutions file is ONLY used to determine correct answers for the JSON metadata, NOT to be included in question text

METADATA INFERENCE (for fields not provided):
- exam_id: Generate from course code, semester, year, and exam type. Use lowercase with underscores.
  CRITICAL: The exam type MUST be correct - look for "midterm", "mid-term", "mid", "final", "quiz", "exam" in the document title/header.
  - "Midterm", "Mid-term", "Mid" → use "midterm"
  - "Final" → use "final"
  Examples: "cs537_fall_2021_midterm", "cs537_spring_2018_final"
- test_paper_name: Human-readable title from exam header (should match the # header)
- course: Course code (e.g., "CS 537")
- institution: University name (e.g., "University of Wisconsin-Madison")
- year: Extract from exam date
- score_total: Sum of all question points (calculate, don't assume)
- num_questions: Count of questions

FORMAT:

# {Exam Title}

\`\`\`json
{
  "exam_id": "cs537_fall_2021_midterm",
  "test_paper_name": "CS 537 Fall 2021 Midterm",
  "course": "CS 537",
  "institution": "University of Wisconsin-Madison",
  "year": 2021,
  "score_total": 100,
  "num_questions": 20
}
\`\`\`

---

## Question 1 [5 point(s)]

{Question text ONLY - no answer, no solution in the text}

\`\`\`json
{
  "problem_id": "1",
  "points": 5,
  "type": "Freeform",
  "tags": ["topic-tag"],
  "answer": "The correct answer goes here (from solutions file)",
  "llm_judge_instructions": "Award 5 points for [correct answer criteria]. Award 3 points for [partial credit criteria]. Award 0 points otherwise."
}
\`\`\`

---

## Question 2 [3 point(s)]

What is X?

A) Option 1
B) Option 2
C) Option 3
D) Option 4

\`\`\`json
{
  "problem_id": "2",
  "points": 3,
  "type": "ExactMatch",
  "tags": ["topic-tag"],
  "choices": ["Option 1", "Option 2", "Option 3", "Option 4"],
  "answer": "B"
}
\`\`\`

QUESTION TYPE RULES:
- ExactMatch: Multiple choice or True/False. Include "choices" array (the TEXT of each option, not letters) and "answer" (letter A-E corresponding to index).
  Example: "choices": ["Running", "Ready", "Blocked"], "answer": "C" means Blocked is correct
- Freeform: Open-ended questions. Include "answer" (the correct answer text) and "llm_judge_instructions" (grading rubric). NO "choices" field.
- Multi-select questions (choose all that apply): Use Freeform type with answer like "A, B, D" and llm_judge_instructions for partial credit.

GRADING RUBRIC REQUIREMENTS (llm_judge_instructions):
- MUST be specific and actionable, not vague
- MUST specify point allocation for each part of multi-part questions
- MUST describe what earns full credit vs partial credit
- CRITICAL: If the solutions file specifies exact point breakdowns (e.g., "1 mark for X, 2 marks for Y"), you MUST use those EXACT point values in the rubric. Do NOT change or redistribute points.
- BAD example: "Grade based on understanding" or "Provide scoring rubrics"
- GOOD example: "Award 2 pts for identifying X. Award 1 pt for partial answer mentioning Y. Award 0 pts if Z is missing."

CRITICAL REMINDERS:
- Question text = ONLY the question as a student would see it on the exam
- NO answers, NO solutions, NO student responses in the question text body
- The "answer" field in JSON metadata stores the correct answer (from solutions file)
- Tags should be lowercase with hyphens (e.g., "virtual-memory")
- Use "point" (singular) when points=1, "points" (plural) otherwise

MULTI-PART QUESTIONS:
- Each sub-question (e.g., 8a, 8b, 8c, 8d) becomes a SEPARATE question with its own problem_id
- CRITICAL: Each sub-question must be SELF-CONTAINED. Include ALL context (code, diagrams, shared text) needed to answer that specific part.
- Do NOT say "this scheme" or "the code above" - include the actual code/context in each sub-question
- Example: If Q8 has parts a-d each analyzing different code, each part (8a, 8b, 8c, 8d) must include its own code snippet

Output ONLY the exam.md content.`;

export const POST: APIRoute = async ({ request }) => {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      const getTimestamp = () => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        return `[${elapsed}s]`;
      };
      const log = (msg: string) => {
        controller.enqueue(encoder.encode(`${getTimestamp()} ${msg}\n`));
      };
      const logRaw = (msg: string) => {
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
        const githubUsername = formData.get("githubUsername") as string;
        const githubToken = formData.get("githubToken") as string;

        const hasGitHub = !!(githubUsername && githubToken && repoPath);
        const totalSteps = hasGitHub ? 10 : 8;

        if (!apiKey) {
          log(
            "ERROR: No OpenAI API key provided. Set OPENAI_API_KEY environment variable or enter it in the UI.",
          );
          controller.close();
          return;
        }

        // Step 1: Extract exam text
        logRaw(`\n── Step 1/${totalSteps}: Extract Exam Text ──`);
        log(`Reading: ${examFile.name}`);
        const examText = await extractTextFromFile(examFile, apiKey);
        log(`Extracted ${examText.length.toLocaleString()} characters`);

        // Step 2: Extract solutions text
        logRaw(`\n── Step 2/${totalSteps}: Extract Solutions Text ──`);
        log(`Reading: ${solutionsFile.name}`);
        const solutionsText = await extractTextFromFile(solutionsFile, apiKey);
        log(`Extracted ${solutionsText.length.toLocaleString()} characters`);

        // Step 3: Generate exam.md
        logRaw(`\n── Step 3/${totalSteps}: Generate Exam Markdown ──`);
        log(`Model: ${MODELS.generator}`);

        // Build metadata overrides section - only include fields that were provided
        const overrides: string[] = [];
        if (examId) overrides.push(`- Exam ID: ${examId}`);
        if (examName) overrides.push(`- Exam Name: ${examName}`);
        if (course) overrides.push(`- Course: ${course}`);
        if (institution) overrides.push(`- Institution: ${institution}`);
        if (year) overrides.push(`- Year: ${year}`);
        if (scoreTotal) overrides.push(`- Total Score: ${scoreTotal}`);
        if (tags) overrides.push(`- Tags: ${tags}`);

        if (overrides.length > 0) {
          log(`Using overrides: ${course || "–"} @ ${institution || "–"}`);
        }

        const overridesSection =
          overrides.length > 0
            ? `The following metadata was explicitly provided as overrides (use these values):\n${overrides.join("\n")}\n\nFor any fields NOT listed above, infer them from the exam content.`
            : `No metadata overrides were provided. Infer ALL metadata fields from the exam content.`;

        const userPrompt = `${overridesSection}

IMPORTANT - Exam filename: "${examFile.name}"
IMPORTANT - Solutions filename: "${solutionsFile.name}"
The filename often contains critical hints about the exam type (midterm vs final), semester, and year. For example:
- "21-fall-mid.pdf" → Fall 2021 Midterm (note: "mid" = midterm, NOT final)
- "18-spring-final.pdf" → Spring 2018 Final
Use these filename hints to help determine the correct exam_id.

Additional notes from the uploader:
${notes || "None"}

=== EXAM CONTENT ===
${examText}

=== SOLUTIONS ===
${solutionsText}

Please generate the exam.md file following the exact format specified. Remember to infer any metadata not explicitly provided above.`;

        const generatedExamMd = await callOpenAI(
          [
            { role: "system", content: EXAM_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          apiKey,
          MODELS.generator,
        );

        log(`Generated ${generatedExamMd.length.toLocaleString()} characters`);

        // Step 4: Validate with judge
        logRaw(`\n── Step 4/${totalSteps}: Validate & Correct ──`);
        log(`Model: ${MODELS.judge}`);

        const examMd = await callOpenAI(
          [
            { role: "system", content: JUDGE_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Please validate and correct the following exam.md content:\n\n${generatedExamMd}`,
            },
          ],
          apiKey,
          MODELS.judge,
        );

        log(`Validated: ${examMd.length.toLocaleString()} characters`);

        // Step 5: Format verification
        logRaw(`\n── Step 5/${totalSteps}: Format Verification ──`);
        log(`Model: ${MODELS.judge}`);

        const formattedExamMd = await callOpenAI(
          [
            { role: "system", content: FORMAT_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Please verify and correct the formatting of the following exam.md content:\n\n${examMd}`,
            },
          ],
          apiKey,
          MODELS.judge,
        );

        log(
          `Format-checked: ${formattedExamMd.length.toLocaleString()} characters`,
        );

        // Extract exam_id from generated content if not provided
        let finalExamId = examId;
        if (!finalExamId) {
          const match = formattedExamMd.match(/"exam_id"\s*:\s*"([^"]+)"/);
          if (match) {
            finalExamId = match[1];
          } else {
            finalExamId = `exam_${Date.now()}`;
          }
        }
        log(`Exam ID: ${finalExamId}`);

        // Step 6: Create directory
        logRaw(`\n── Step 6/${totalSteps}: Create Directory ──`);
        const courseExamPath = getExamPath(repoPath);
        const examDir = path.join(courseExamPath, finalExamId);
        log(`Path: ${examDir}`);

        // Check if exam already exists - never overwrite existing exams
        try {
          await fs.access(path.join(examDir, "exam.md"));
          logRaw(`\n✗ ERROR: Exam already exists!`);
          log(`Location: ${examDir}/exam.md`);
          log(`Delete the directory first if you want to replace it.`);
          controller.close();
          return;
        } catch {
          // File doesn't exist, safe to proceed
        }

        await fs.mkdir(examDir, { recursive: true });
        log(`Directory created`);

        // Step 7: Write files
        logRaw(`\n── Step 7/${totalSteps}: Write Files ──`);

        // Write exam.md
        await fs.writeFile(
          path.join(examDir, "exam.md"),
          formattedExamMd,
          "utf-8",
        );
        log(`Wrote: exam.md`);

        // Write the solutions file (following benchmark convention)
        const solutionsPath = path.join(examDir, solutionsFile.name);
        const solutionsContent = Buffer.from(await solutionsFile.arrayBuffer());
        await fs.writeFile(solutionsPath, solutionsContent);
        log(`Wrote: ${solutionsFile.name}`);

        // Handle reference files
        const referenceFiles = formData.getAll("referenceFiles") as File[];
        if (referenceFiles.length > 0) {
          for (const refFile of referenceFiles) {
            const refPath = path.join(examDir, refFile.name);
            const refContent = Buffer.from(await refFile.arrayBuffer());
            await fs.writeFile(refPath, refContent);
            log(`Wrote: ${refFile.name}`);
          }
        }

        // Step 8: Prepare dataset to validate format
        logRaw(`\n── Step 8/${totalSteps}: Prepare Dataset ──`);
        const courseExamBenchPath = getCourseExamBenchPath(repoPath);
        log(`Path: ${courseExamBenchPath}`);
        try {
          const { stdout, stderr } = await execAsync(
            "python3 prepare_dataset.py",
            { cwd: courseExamBenchPath },
          );
          if (stdout?.trim()) {
            log(stdout.trim());
          }
          if (stderr?.trim()) {
            log(stderr.trim());
          }
          log("prepare_dataset.py completed");
        } catch (error: unknown) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          log(`prepare_dataset.py failed: ${errorMsg}`);
          throw new Error(`Dataset preparation failed: ${errorMsg}`);
        }

        // GitHub integration: create branch and push commit
        if (hasGitHub) {
          // Extract exam info for branch name
          const examNameMatch = formattedExamMd.match(
            /"test_paper_name"\s*:\s*"([^"]+)"/,
          );
          const courseMatch = formattedExamMd.match(/"course"\s*:\s*"([^"]+)"/);
          const yearMatch = formattedExamMd.match(/"year"\s*:\s*(\d+)/);

          // Generate branch name from exam metadata
          let branchName = finalExamId.replace(/_/g, "-");
          if (
            !branchName ||
            branchName === `exam-${Date.now()}`.replace(/_/g, "-")
          ) {
            // Fallback: build from extracted metadata
            const coursePart = courseMatch
              ? courseMatch[1].toLowerCase().replace(/\s+/g, "")
              : "exam";
            const yearPart = yearMatch
              ? yearMatch[1]
              : new Date().getFullYear();
            const typePart = finalExamId.includes("final")
              ? "final"
              : finalExamId.includes("midterm")
                ? "midterm"
                : "exam";
            branchName = `${coursePart}-${yearPart}-${typePart}`;
          }

          // Sanitize exam title for commit message (remove special chars that break shell)
          const examTitle = (examNameMatch ? examNameMatch[1] : finalExamId)
            .replace(/[()]/g, "")
            .replace(/"/g, "'");
          const remoteUrl = `https://${githubUsername}:${githubToken}@github.com/${githubUsername}/system-intelligence-benchmark.git`;

          // Use -C flag to run git commands in the repo directory
          const git = (cmd: string) => execAsync(`git -C "${repoPath}" ${cmd}`);

          // Create a unique worktree for this parallel operation
          const worktreeDir = path.join(
            repoPath,
            ".worktrees",
            `exam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          );

          // Step 9: Create git branch
          logRaw(`\n── Step 9/${totalSteps}: Create Git Branch ──`);
          log(`Branch: ${branchName}`);
          try {
            // Fetch latest from origin
            await git(`fetch origin main`);

            // Create the branch if it doesn't exist
            try {
              await git(`branch ${branchName} origin/main`);
              log(`Branch created`);
            } catch (error: unknown) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              if (errorMsg.includes("already exists")) {
                log(`Branch already exists, reusing`);
              } else {
                throw error;
              }
            }

            // Create a worktree for isolated operations
            await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
            await git(`worktree add "${worktreeDir}" ${branchName}`);
          } catch (error: unknown) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create branch/worktree: ${errorMsg}`);
          }

          // Step 10: Commit and push
          logRaw(`\n── Step 10/${totalSteps}: Push to GitHub ──`);
          try {
            // Copy exam files to the worktree
            const worktreeExamDir = path.join(
              worktreeDir,
              "benchmarks",
              "courseexam_bench",
              "data",
              "raw",
              finalExamId,
            );
            await fs.mkdir(worktreeExamDir, { recursive: true });

            // Copy all files from examDir to worktreeExamDir
            const files = await fs.readdir(examDir);
            for (const file of files) {
              await fs.copyFile(
                path.join(examDir, file),
                path.join(worktreeExamDir, file),
              );
            }

            // Git operations in the worktree
            const wtGit = (cmd: string) =>
              execAsync(`git -C "${worktreeDir}" ${cmd}`);

            // Stage, commit, and push
            await wtGit(`add -A`);
            await wtGit(`commit -m "add ${examTitle}"`);
            log(`Committed: "add ${examTitle}"`);

            await wtGit(`push "${remoteUrl}" ${branchName}`);
            log(`Pushed to origin/${branchName}`);
          } catch (error: unknown) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            log(`Git error: ${errorMsg}`);
            throw new Error(`Failed to push to GitHub: ${errorMsg}`);
          } finally {
            // Clean up worktree
            try {
              await git(`worktree remove "${worktreeDir}" --force`);
            } catch {
              // Try manual cleanup if worktree remove fails
              try {
                await fs.rm(worktreeDir, { recursive: true, force: true });
                await git(`worktree prune`);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
        }

        // Success summary
        logRaw(`\n════════════════════════════════════`);
        logRaw(`✓ SUCCESS`);
        logRaw(`════════════════════════════════════`);
        log(`Exam ID: ${finalExamId}`);
        log(`Location: ${examDir}`);
        if (hasGitHub) {
          log(`Branch: origin/${finalExamId.replace(/_/g, "-")}`);
        }

        controller.close();
      } catch (error) {
        logRaw(`\n✗ ERROR: ${error}`);
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
