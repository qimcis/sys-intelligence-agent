import type { APIRoute } from "astro";
import { extractTextFromFile } from "../../../lib/pdf-utils";
import { callOpenAI, MODELS } from "../../../lib/openai-client";
import { COURSEEXAM_PATH } from "../../../lib/config";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const JUDGE_SYSTEM_PROMPT = `You are a meticulous judge that validates and corrects exam markdown files for the CourseExam benchmark.

Your task is to review the generated exam.md content and fix any issues:

1. VERIFY score_total: Sum up all the "points" values from each question's JSON block. The score_total in the metadata MUST equal this sum.
2. VERIFY num_questions: Count the actual number of questions. The num_questions in metadata MUST match.
3. CHECK format consistency: Ensure all questions follow the correct format.
4. FIX any JSON syntax errors in the metadata or question blocks.
5. ENSURE the # header matches test_paper_name in metadata.

If you find errors, output the CORRECTED exam.md content.
If everything is correct, output the original content unchanged.

Output ONLY the exam.md content, no explanations or commentary.`;

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
- exam_id: Generate from course code, semester, year, and exam type. Use lowercase with underscores.
  CRITICAL: The exam type MUST be correct - look for "midterm", "mid-term", "mid", "final", "quiz", "exam" in the document title/header.
  - If the document says "Midterm", "Mid-term", "Mid", or "Middle" → use "midterm" in the exam_id
  - If the document says "Final" → use "final" in the exam_id
  - NEVER confuse midterm with final! Read the actual document title carefully.
  Examples: "cs537_fall_2021_midterm", "cs537_spring_2018_final", "cs162_fall_2023_quiz1"
  DO NOT use "final" if the exam says "midterm" or vice versa! This is a critical error.
- test_paper_name: Create a human-readable title from the exam header/title (should match the # header)
- course: Extract the course code/number from the exam (e.g., "CS 537", "Operating Systems")
- institution: Look for university name in headers, footers, or letterhead (use abbreviation like "UW-Madison", "MIT", "UIUC")
- year: Extract from date on exam or filename
- score_total: You MUST actually calculate this by summing all question points. Do NOT assume 100 or any other common value. Add up each question's points to get the true total.
- num_questions: Count the total number of questions

FORMAT SPECIFICATION:

1. Start with a markdown header using the exam title:
# {Exam Title}

2. Immediately follow with a JSON metadata block inside a code fence:
\`\`\`json
{
  "exam_id": "cs537_fall_2021_final",
  "test_paper_name": "CS 537 Fall 2021 Final",
  "course": "Operating Systems",
  "institution": "University of Wisconsin-Madison",
  "year": 2021,
  "score_total": 100,
  "num_questions": 55
}
\`\`\`

3. Then for each question, use this format (separated by ---):

---


## Question {number} [{points} point(s)]

{Question text - convert any images to text descriptions if possible, otherwise note "[Figure excluded]"}

For multiple choice, list options as:
A) Option text
B) Option text
C) Option text
D) Option text

Your answer should be one letter only (A, B, C, D, or E).

\`\`\`json
{
  "problem_id": "{number}",
  "points": {points},
  "type": "ExactMatch" or "Freeform",
  "tags": ["tag1", "tag2"],
  "choices": ["option A text", "option B text", "option C text", "option D text"],
  "answer": "B"
}
\`\`\`

IMPORTANT RULES:
- The # header title and test_paper_name in metadata should match
- For multiple choice questions, use type "ExactMatch" and include "choices" array. Answer should be the letter (A, B, C, D, E).
- For True/False, use type "ExactMatch" with choices ["True", "False"]. Answer should be "A" for True, "B" for False.
- For free-form/explanation questions, use type "Freeform" and include "llm_judge_instructions" with a detailed rubric.
- For questions that reference materials (MPs, labs, etc.), add "reference_materials": ["MP1.md"] to indicate dependencies.
- For multi-part questions (e.g., 12-13), you can combine them with a multi-part answer format.
- Tags should be lowercase with hyphens (e.g., "operating-systems", "virtual-memory").
- If a question relies on a figure/image that cannot be described in text, exclude it and update score_total accordingly.
- CRITICAL: The sum of all question points MUST equal score_total in the metadata. Actually add up the points - do not guess or assume 100.
- Use "point" (singular) when points=1, "points" (plural) otherwise.

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
        const githubUsername = formData.get("githubUsername") as string;
        const githubToken = formData.get("githubToken") as string;

        const hasGitHub = !!(githubUsername && githubToken && repoPath);
        const totalSteps = hasGitHub ? 8 : 6;

        if (!apiKey) {
          log(
            "ERROR: No OpenAI API key provided. Set OPENAI_API_KEY environment variable or enter it in the UI.",
          );
          controller.close();
          return;
        }

        log(
          `[1/${totalSteps}] Extracting text from exam file: ${examFile.name}`,
        );
        const examText = await extractTextFromFile(examFile, apiKey);
        log(`  -> Extracted ${examText.length} characters`);

        log(
          `[2/${totalSteps}] Extracting text from solutions file: ${solutionsFile.name}`,
        );
        const solutionsText = await extractTextFromFile(solutionsFile, apiKey);
        log(`  -> Extracted ${solutionsText.length} characters`);

        log(
          `[3/${totalSteps}] Generating structured exam.md (${MODELS.generator})...`,
        );

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

        log(`  -> Generated ${generatedExamMd.length} characters`);

        log(
          `[4/${totalSteps}] Validating and correcting with judge model (${MODELS.judge})...`,
        );

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

        log(`  -> Validated exam.md (${examMd.length} characters)`);

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
        log(`[5/${totalSteps}] Creating exam directory: ${finalExamId}`);
        log(`  -> Using repo path: ${courseExamPath}`);
        const examDir = path.join(courseExamPath, finalExamId);

        // Check if exam already exists - never overwrite existing exams
        try {
          await fs.access(path.join(examDir, "exam.md"));
          log(`\nERROR: Exam already exists at ${examDir}/exam.md`);
          log(
            `Refusing to overwrite existing exam. If you want to replace it, delete the directory first.`,
          );
          controller.close();
          return;
        } catch {
          // File doesn't exist, safe to proceed
        }

        await fs.mkdir(examDir, { recursive: true });

        log(`[6/${totalSteps}] Writing files to ${examDir}/`);

        // Write exam.md
        await fs.writeFile(path.join(examDir, "exam.md"), examMd, "utf-8");
        log(`  -> exam.md`);

        // Write the solutions file (following benchmark convention)
        const solutionsPath = path.join(examDir, solutionsFile.name);
        const solutionsContent = Buffer.from(await solutionsFile.arrayBuffer());
        await fs.writeFile(solutionsPath, solutionsContent);
        log(`  -> ${solutionsFile.name}`);

        // Handle reference files
        const referenceFiles = formData.getAll("referenceFiles") as File[];
        if (referenceFiles.length > 0) {
          for (const refFile of referenceFiles) {
            const refPath = path.join(examDir, refFile.name);
            const refContent = Buffer.from(await refFile.arrayBuffer());
            await fs.writeFile(refPath, refContent);
            log(`  -> ${refFile.name}`);
          }
        }

        // GitHub integration: create branch and push commit
        if (hasGitHub) {
          // Extract exam info for branch name
          const examNameMatch = examMd.match(
            /"test_paper_name"\s*:\s*"([^"]+)"/,
          );
          const courseMatch = examMd.match(/"course"\s*:\s*"([^"]+)"/);
          const yearMatch = examMd.match(/"year"\s*:\s*(\d+)/);

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

          log(`[7/${totalSteps}] Creating git branch: ${branchName}`);
          try {
            // Fetch latest from origin
            await git(`fetch origin main`);

            // Create the branch if it doesn't exist
            try {
              await git(`branch ${branchName} origin/main`);
              log(`  -> Branch created: ${branchName}`);
            } catch (error: unknown) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              if (errorMsg.includes("already exists")) {
                log(`  -> Branch already exists: ${branchName}`);
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

          log(`[8/${totalSteps}] Committing and pushing to GitHub...`);
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
            log(`  -> Committed: add ${examTitle}`);

            await wtGit(`push "${remoteUrl}" ${branchName}`);
            log(`  -> Pushed to origin/${branchName}`);
          } catch (error: unknown) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            log(`  -> Git error: ${errorMsg}`);
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

        log(`\n=== SUCCESS ===`);
        log(`Exam added to: ${examDir}`);
        if (hasGitHub) {
          log(`\nGitHub: Changes pushed to branch, ready for PR`);
        }
        log(`\nNext steps:`);
        log(`1. Review the generated exam.md file`);
        log(
          `2. Run 'python prepare_dataset.py' in the courseexam_bench directory to regenerate the dataset`,
        );
        if (!hasGitHub) {
          log(`3. Commit your changes to the repository`);
        }

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
