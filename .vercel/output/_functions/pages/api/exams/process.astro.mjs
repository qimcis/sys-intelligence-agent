import { pdf } from 'pdf-to-img';
import { c as checkRateLimit, a as callOpenAI, M as MODELS } from '../../../chunks/rate-limit_BV7kvadu.mjs';
import { C as COURSEEXAM_PATH, B as BENCHMARK_REPO_PATH } from '../../../chunks/config_BkSRtLkd.mjs';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
export { renderers } from '../../../renderers.mjs';

const MIN_TEXT_LENGTH = 100;
async function extractTextFromPdf(buffer) {
  try {
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error(`Failed to parse PDF: ${error}`);
  }
}
async function extractTextFromPdfWithOcr(buffer, apiKey) {
  let extractedText = "";
  try {
    extractedText = await extractTextFromPdf(buffer);
  } catch {
  }
  if (extractedText.trim().length >= MIN_TEXT_LENGTH) {
    return extractedText;
  }
  console.log("PDF appears to be image-based, using OCR...");
  const pages = [];
  let pageNum = 0;
  const pdfDocument = await pdf(buffer, { scale: 2 });
  for await (const image of pdfDocument) {
    pageNum++;
    const base64Image = image.toString("base64");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract ALL text from this image exactly as it appears. Preserve the original formatting, layout, and structure as much as possible. Include all questions, answers, headers, footers, and any other text. Output ONLY the extracted text, nothing else."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 4096
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Vision API error: ${error}`);
    }
    const result = await response.json();
    const pageText = result.choices?.[0]?.message?.content || "";
    pages.push(`--- Page ${pageNum} ---
${pageText}`);
  }
  return pages.join("\n\n");
}
async function extractTextFromFile(file, apiKey) {
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

const execAsync = promisify(exec);
const JUDGE_SYSTEM_PROMPT = `You are a meticulous judge that validates and corrects exam markdown files for the CourseExam benchmark.

Your task is to review the generated exam.md content and fix ALL issues:

VALIDATION CHECKS:
1. VERIFY score_total: Sum all "points" values. The score_total in metadata MUST equal this sum.
2. VERIFY num_questions: Count every question JSON block with "problem_id" (each sub-part like 8a, 8b counts as 1). The num_questions in metadata MUST equal this count.
3. VERIFY tags format: Every tag must match ^[a-z0-9-]+$ (lowercase, digits, hyphens only). Normalize invalid tags by lowercasing, replacing spaces/underscores/slashes with hyphens, removing other invalid characters, collapsing multiple hyphens, trimming leading/trailing hyphens, and deduping. If tags become empty, set to ["misc"].
4. VERIFY every question has a NON-EMPTY "answer" field. Never leave it blank. If the answer is missing or empty, infer it from the solutions or the question context; if still uncertain, write "Unknown" (not empty).
5. CHECK format consistency: All questions must follow the correct format.
6. FIX any JSON syntax errors.
7. ENSURE the # header matches test_paper_name in metadata.

CRITICAL CONTENT CHECKS - FIX THESE:
7. REMOVE any answers/solutions from the question text body. Questions should ONLY contain what a student sees on the exam.
8. For Freeform questions: REMOVE "choices" field - it should NOT exist. Keep "answer" field.
9. For Freeform questions: ENSURE "answer" and "llm_judge_instructions" exist.
10. For ExactMatch questions: ENSURE "choices" array and "answer" field exist.
11. REMOVE any student responses, professor comments, or solution text that got mixed into question text body.
12. FIX vague llm_judge_instructions. Replace phrases like "Grade by understanding" or "Provide scoring rubrics" with specific point allocations (e.g., "Award 2 pts for X, 1 pt for Y").
13. VERIFY llm_judge_instructions point allocations sum to the question's total points and match any rubric given in the source solutions.
14. CHECK question numbering is consistent - no gaps (e.g., Q1, Q2, Q4 missing Q3). If source has gaps, renumber sequentially.
15. VERIFY num_questions matches actual question count (count all problem_ids including sub-parts like 8a, 8b as separate questions).
16. REMOVE any skipped/excluded questions entirely (e.g., "Skipped", "Excluded", or points=0). Do NOT include them in the output.
17. UPDATE score_total and num_questions after removing any skipped/excluded questions.
18. ENSURE all "points" values are integers. If any are fractional, rescale all question points and score_total by the smallest factor to make them integers (e.g., 0.5 -> multiply all points by 2). Update any point allocations in llm_judge_instructions to use integers.

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
const PR_BODY_SYSTEM_PROMPT = `You write GitHub pull request descriptions.

Fill out the template exactly. Keep the section headings and checklist intact.
Use concise, factual sentences. Do not add extra sections or commentary.
Output ONLY the completed template.`;
const PR_TITLE_SYSTEM_PROMPT = `You generate GitHub pull request titles.

Output EXACTLY this format:
add <course> <season> <year> <exam type>

Rules:
- Use lowercase.
- Course should be a short code (e.g., comp3000, cs537).
- Season must be one of: fall, winter, spring, summer.
- Year must be 4 digits.
- Exam type must be "final", "midterm", "quiz", or "exam".
- Output ONLY the title line, no punctuation or quotes.`;
function getExamPath(repoPath) {
  if (repoPath) {
    return path.join(repoPath, "benchmarks", "courseexam_bench", "data", "raw");
  }
  return COURSEEXAM_PATH;
}
function getCourseExamBenchPath(repoPath) {
  const basePath = repoPath || BENCHMARK_REPO_PATH;
  return path.join(basePath, "benchmarks", "courseexam_bench");
}
function buildPullRequestTitleFallback(examId) {
  const tokens = examId.toLowerCase().split("_");
  const seasons = /* @__PURE__ */ new Set(["fall", "winter", "spring", "summer", "autumn"]);
  const seasonIndex = tokens.findIndex((token) => seasons.has(token));
  if (seasonIndex > 0 && seasonIndex + 2 < tokens.length) {
    const course = tokens.slice(0, seasonIndex).join(" ");
    const season = tokens[seasonIndex];
    const year = tokens[seasonIndex + 1];
    const examType = tokens.slice(seasonIndex + 2).join(" ");
    if (/^\d{4}$/.test(year) && examType) {
      return `add ${course} ${season} ${year} ${examType}`.replace(/\s+/g, " ");
    }
  }
  return `add ${examId.replace(/_/g, " ")}`.replace(/\s+/g, " ");
}
function assertIntegerPoints(examMd) {
  const jsonBlockRegex = /```json\n([\s\S]*?)\n```/g;
  const matches = examMd.matchAll(jsonBlockRegex);
  for (const match of matches) {
    const jsonText = match[1];
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, "problem_id")) {
      continue;
    }
    const points = parsed.points;
    if (typeof points === "number" && !Number.isInteger(points)) {
      const problemId = parsed.problem_id;
      throw new Error(
        `Non-integer points for problem_id ${problemId}: ${points}`
      );
    }
  }
}
function assertNonEmptyAnswers(examMd) {
  const jsonBlockRegex = /```json\n([\s\S]*?)\n```/g;
  const matches = examMd.matchAll(jsonBlockRegex);
  const missingAnswers = [];
  for (const match of matches) {
    const jsonText = match[1];
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, "problem_id")) {
      continue;
    }
    const answer = parsed.answer;
    if (typeof answer !== "string" || answer.trim().length === 0) {
      missingAnswers.push(String(parsed.problem_id ?? "?"));
    }
  }
  if (missingAnswers.length > 0) {
    throw new Error(
      `Missing or empty answers for problem_id(s): ${missingAnswers.join(", ")}`
    );
  }
}
function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) {
    return ["misc"];
  }
  const normalized = [];
  const seen = /* @__PURE__ */ new Set();
  for (const tag of rawTags) {
    if (typeof tag !== "string") {
      continue;
    }
    let cleaned = tag.toLowerCase();
    cleaned = cleaned.replace(/[\s_\/]+/g, "-");
    cleaned = cleaned.replace(/[^a-z0-9-]/g, "");
    cleaned = cleaned.replace(/-+/g, "-");
    cleaned = cleaned.replace(/^-+|-+$/g, "");
    if (!cleaned) {
      continue;
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      normalized.push(cleaned);
    }
  }
  return normalized.length > 0 ? normalized : ["misc"];
}
function normalizeExamMetadataAndTags(examMd) {
  const jsonBlockRegex = /```json\n([\s\S]*?)\n```/g;
  const matches = [...examMd.matchAll(jsonBlockRegex)];
  if (matches.length === 0) {
    return examMd;
  }
  let questionCount = 0;
  let totalPoints = 0;
  const updates = [];
  let metadata = null;
  let metadataMatch = null;
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const jsonText = match[1];
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const hasProblemId = Object.prototype.hasOwnProperty.call(
      parsed,
      "problem_id"
    );
    if (index === 0 && !hasProblemId) {
      metadata = parsed;
      metadataMatch = match;
      continue;
    }
    if (!hasProblemId) {
      continue;
    }
    questionCount += 1;
    if (typeof parsed.points === "number" && Number.isFinite(parsed.points)) {
      totalPoints += parsed.points;
    }
    const normalizedTags = normalizeTags(parsed.tags);
    const tagsChanged = JSON.stringify(normalizedTags) !== JSON.stringify(parsed.tags);
    if (tagsChanged) {
      parsed.tags = normalizedTags;
      const newBlock = `\`\`\`json
${JSON.stringify(parsed, null, 2)}
\`\`\``;
      const start = match.index ?? 0;
      updates.push({ start, end: start + match[0].length, text: newBlock });
    }
  }
  if (metadata && metadataMatch && questionCount > 0) {
    let metadataChanged = false;
    const numQuestions = metadata.num_questions;
    if (numQuestions !== questionCount) {
      metadata.num_questions = questionCount;
      metadataChanged = true;
    }
    const scoreTotalRaw = metadata.score_total;
    const scoreTotal = typeof scoreTotalRaw === "number" ? scoreTotalRaw : Number(scoreTotalRaw);
    if (!Number.isFinite(scoreTotal) || scoreTotal !== totalPoints) {
      metadata.score_total = totalPoints;
      metadataChanged = true;
    }
    if (metadataChanged) {
      const newBlock = `\`\`\`json
${JSON.stringify(metadata, null, 2)}
\`\`\``;
      const start = metadataMatch.index ?? 0;
      updates.push({
        start,
        end: start + metadataMatch[0].length,
        text: newBlock
      });
    }
  }
  if (updates.length === 0) {
    return examMd;
  }
  const sortedUpdates = updates.sort((a, b) => b.start - a.start);
  let updatedExamMd = examMd;
  for (const update of sortedUpdates) {
    updatedExamMd = updatedExamMd.slice(0, update.start) + update.text + updatedExamMd.slice(update.end);
  }
  return updatedExamMd;
}
async function createOrGetPullRequest(params) {
  const { githubUsername, githubToken, branchName, title, body } = params;
  const owner = "sys-intelligence";
  const repo = "system-intelligence-benchmark";
  const base = "main";
  const head = `${githubUsername}:${branchName}`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const listResponse = await fetch(
    `${apiBase}/pulls?state=open&base=${base}&head=${encodeURIComponent(head)}`,
    { headers }
  );
  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    throw new Error(
      `GitHub PR lookup failed: ${listResponse.status} - ${errorText}`
    );
  }
  const existing = await listResponse.json();
  if (existing.length > 0 && existing[0]?.html_url) {
    return existing[0].html_url;
  }
  const createResponse = await fetch(`${apiBase}/pulls`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title,
      head,
      base,
      body,
      draft: true,
      maintainer_can_modify: true
    })
  });
  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(
      `GitHub PR create failed: ${createResponse.status} - ${errorText}`
    );
  }
  const created = await createResponse.json();
  if (!created?.html_url) {
    throw new Error("GitHub PR create response missing html_url");
  }
  return created.html_url;
}
async function buildPullRequestTitle(params) {
  const { apiKey, examId, examTitle, course, year } = params;
  const userPrompt = `Context:
- exam_id: ${examId}
- test_paper_name: ${examTitle}
- course: ${course || "unknown"}
- year: ${year || "unknown"}

Generate the title.`;
  const title = await callOpenAI(
    [
      { role: "system", content: PR_TITLE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    apiKey,
    MODELS.judge
  );
  const cleaned = title.trim().split("\n")[0].toLowerCase();
  const isValid = /^add [a-z0-9]+ [a-z]+ \d{4} (final|midterm|quiz|exam)$/.test(
    cleaned
  );
  if (!isValid) {
    return buildPullRequestTitleFallback(examId);
  }
  return cleaned;
}
async function buildPullRequestBody(params) {
  const {
    apiKey,
    examTitle,
    examId,
    examDir,
    solutionFileName,
    referenceFileNames
  } = params;
  const template = `## Description

Brief description of what this PR does.

## Changes

- Change 1
- Change 2
- Change 3

## Testing

How was this tested?

## Checklist

- [ ] Tests pass locally
- [ ] Code follows project style guidelines
- [ ] Documentation updated (if needed)
`;
  const refList = referenceFileNames.length > 0 ? referenceFileNames.join(", ") : "None";
  const userPrompt = `Fill the template using this context:
- Exam title: ${examTitle}
- Exam ID: ${examId}
- Exam directory: ${examDir}
- Solutions file: ${solutionFileName}
- Reference files: ${refList}
- Testing performed: python3 courseexam/prepare.py

Template:
${template}
`;
  return callOpenAI(
    [
      { role: "system", content: PR_BODY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt }
    ],
    apiKey,
    MODELS.judge
  );
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
4. All "points" values must be integers. If the source uses fractional points, rescale all question points and score_total by the smallest factor to make them integers.
5. Tags MUST match ^[a-z0-9-]+$ (lowercase, digits, hyphens only). Replace spaces, underscores, or slashes with hyphens and remove other punctuation.
6. num_questions MUST equal the number of questions you output (count each sub-part like 8a, 8b as 1). Recount after writing questions and update metadata.
7. Every question MUST have a non-empty "answer" in its JSON block. Use the solutions text to fill it; never leave it blank.

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
- num_questions: Count of questions (count each sub-question like 8a, 8b as 1). Must equal the number of question JSON blocks in the output.

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
- Tags MUST match ^[a-z0-9-]+$ (e.g., "virtual-memory"). Bad: "os/161", "ll_sc". Good: "os-161", "ll-sc".
- Use "point" (singular) when points=1, "points" (plural) otherwise

MULTI-PART QUESTIONS:
- Each sub-question (e.g., 8a, 8b, 8c, 8d) becomes a SEPARATE question with its own problem_id
- CRITICAL: Each sub-question must be SELF-CONTAINED. Include ALL context (code, diagrams, shared text) needed to answer that specific part.
- Do NOT say "this scheme" or "the code above" - include the actual code/context in each sub-question
- Example: If Q8 has parts a-d each analyzing different code, each part (8a, 8b, 8c, 8d) must include its own code snippet

Output ONLY the exam.md content.`;
const POST = async ({ request }) => {
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { allowed, retryAfter } = checkRateLimit(clientIp, 6e4, 5);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfter) }
    });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      const log = (msg) => {
        controller.enqueue(encoder.encode(msg + "\n"));
      };
      try {
        const formData = await request.formData();
        const examId = formData.get("examId");
        const examName = formData.get("examName");
        const course = formData.get("course");
        const institution = formData.get("institution");
        const year = formData.get("year");
        const scoreTotal = formData.get("scoreTotal");
        const tags = formData.get("tags");
        const notes = formData.get("notes");
        const examFile = formData.get("examFile");
        const solutionsFile = formData.get("solutionsFile");
        const apiKey = formData.get("apiKey") || process.env.OPENAI_API_KEY;
        const repoPath = formData.get("repoPath");
        const githubUsername = formData.get("githubUsername");
        const githubToken = formData.get("githubToken");
        const hasGitHub = !!(githubUsername && githubToken && repoPath);
        if (!apiKey) {
          log("Error: no OpenAI API key provided");
          controller.close();
          return;
        }
        log(`Reading ${examFile.name}...`);
        const examText = await extractTextFromFile(examFile, apiKey);
        log(`  ${examText.length.toLocaleString()} chars`);
        log(`Reading ${solutionsFile.name}...`);
        const solutionsText = await extractTextFromFile(solutionsFile, apiKey);
        log(`  ${solutionsText.length.toLocaleString()} chars`);
        log(`Generating markdown...`);
        const overrides = [];
        if (examId) overrides.push(`- Exam ID: ${examId}`);
        if (examName) overrides.push(`- Exam Name: ${examName}`);
        if (course) overrides.push(`- Course: ${course}`);
        if (institution) overrides.push(`- Institution: ${institution}`);
        if (year) overrides.push(`- Year: ${year}`);
        if (scoreTotal) overrides.push(`- Total Score: ${scoreTotal}`);
        if (tags) overrides.push(`- Tags: ${tags}`);
        if (overrides.length > 0) {
          log(`  overrides: ${course || "–"} @ ${institution || "–"}`);
        }
        const overridesSection = overrides.length > 0 ? `The following metadata was explicitly provided as overrides (use these values):
${overrides.join("\n")}

For any fields NOT listed above, infer them from the exam content.` : `No metadata overrides were provided. Infer ALL metadata fields from the exam content.`;
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
            { role: "user", content: userPrompt }
          ],
          apiKey,
          MODELS.generator
        );
        log(`  ${generatedExamMd.length.toLocaleString()} chars`);
        log(`Validating...`);
        const examMd = await callOpenAI(
          [
            { role: "system", content: JUDGE_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Please validate and correct the following exam.md content:

${generatedExamMd}`
            }
          ],
          apiKey,
          MODELS.judge
        );
        log(`  ${examMd.length.toLocaleString()} chars`);
        log(`Formatting...`);
        const formattedExamMd = await callOpenAI(
          [
            { role: "system", content: FORMAT_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Please verify and correct the formatting of the following exam.md content:

${examMd}`
            }
          ],
          apiKey,
          MODELS.judge
        );
        log(`  ${formattedExamMd.length.toLocaleString()} chars`);
        const finalExamMd = normalizeExamMetadataAndTags(formattedExamMd);
        if (finalExamMd !== formattedExamMd) {
          log("  normalized tags/metadata");
        }
        assertIntegerPoints(finalExamMd);
        assertNonEmptyAnswers(finalExamMd);
        let finalExamId = examId;
        if (!finalExamId) {
          const match = finalExamMd.match(/"exam_id"\s*:\s*"([^"]+)"/);
          if (match) {
            finalExamId = match[1];
          } else {
            finalExamId = `exam_${Date.now()}`;
          }
        }
        const courseExamPath = getExamPath(repoPath);
        const examDir = path.join(courseExamPath, finalExamId);
        log(`ID: ${finalExamId}`);
        try {
          await fs.access(path.join(examDir, "exam.md"));
          log(`Error: exam already exists at ${examDir}`);
          controller.close();
          return;
        } catch {
        }
        await fs.mkdir(examDir, { recursive: true });
        log(`Writing files...`);
        await fs.writeFile(path.join(examDir, "exam.md"), finalExamMd, "utf-8");
        const fileNames = ["exam.md"];
        const solutionsPath = path.join(examDir, solutionsFile.name);
        const solutionsContent = Buffer.from(await solutionsFile.arrayBuffer());
        await fs.writeFile(solutionsPath, solutionsContent);
        fileNames.push(solutionsFile.name);
        const referenceFiles = formData.getAll("referenceFiles");
        for (const refFile of referenceFiles) {
          const refPath = path.join(examDir, refFile.name);
          const refContent = Buffer.from(await refFile.arrayBuffer());
          await fs.writeFile(refPath, refContent);
          fileNames.push(refFile.name);
        }
        log(`  ${fileNames.join(", ")}`);
        log(`Preparing dataset...`);
        const courseExamBenchPath = getCourseExamBenchPath(repoPath);
        try {
          await execAsync(
            "python3 courseexam/prepare.py",
            { cwd: courseExamBenchPath }
          );
          log("  passed");
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const execError = error;
          if (execError.stderr?.trim()) {
            log(`  ${execError.stderr.trim()}`);
          }
          throw new Error(`Dataset preparation failed: ${errorMsg}`);
        }
        log(`Validating schema...`);
        try {
          await execAsync(
            "python3 -m pytest tests/test_data_schema.py -q",
            { cwd: courseExamBenchPath }
          );
          log("  passed");
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const execError = error;
          if (execError.stderr?.trim()) {
            log(`  ${execError.stderr.trim()}`);
          }
          throw new Error(`Schema validation failed: ${errorMsg}`);
        }
        if (hasGitHub) {
          const examNameMatch = finalExamMd.match(
            /"test_paper_name"\s*:\s*"([^"]+)"/
          );
          const courseMatch = finalExamMd.match(/"course"\s*:\s*"([^"]+)"/);
          const yearMatch = finalExamMd.match(/"year"\s*:\s*(\d+)/);
          let branchName = finalExamId.replace(/_/g, "-");
          if (!branchName || branchName === `exam-${Date.now()}`.replace(/_/g, "-")) {
            const coursePart = courseMatch ? courseMatch[1].toLowerCase().replace(/\s+/g, "") : "exam";
            const yearPart = yearMatch ? yearMatch[1] : (/* @__PURE__ */ new Date()).getFullYear();
            const typePart = finalExamId.includes("final") ? "final" : finalExamId.includes("midterm") ? "midterm" : "exam";
            branchName = `${coursePart}-${yearPart}-${typePart}`;
          }
          const examTitle = (examNameMatch ? examNameMatch[1] : finalExamId).replace(/[()]/g, "").replace(/"/g, "'");
          const remoteUrl = `https://${githubUsername}:${githubToken}@github.com/${githubUsername}/system-intelligence-benchmark.git`;
          const git = (cmd) => execAsync(`git -C "${repoPath}" ${cmd}`);
          const worktreeDir = path.join(
            repoPath,
            ".worktrees",
            `exam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          );
          log(`Creating branch ${branchName}...`);
          try {
            await git(`fetch origin main`);
            try {
              await git(`branch ${branchName} origin/main`);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              if (!errorMsg.includes("already exists")) {
                throw error;
              }
            }
            await fs.mkdir(path.dirname(worktreeDir), { recursive: true });
            await git(`worktree add "${worktreeDir}" ${branchName}`);
            log(`  done`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create branch/worktree: ${errorMsg}`);
          }
          log(`Pushing to GitHub...`);
          try {
            const worktreeExamDir = path.join(
              worktreeDir,
              "benchmarks",
              "courseexam_bench",
              "data",
              "raw",
              finalExamId
            );
            await fs.mkdir(worktreeExamDir, { recursive: true });
            const files = await fs.readdir(examDir);
            for (const file of files) {
              await fs.copyFile(
                path.join(examDir, file),
                path.join(worktreeExamDir, file)
              );
            }
            const wtGit = (cmd) => execAsync(`git -C "${worktreeDir}" ${cmd}`);
            await wtGit(`add -A`);
            await wtGit(`commit -m "add ${examTitle}"`);
            await wtGit(`push "${remoteUrl}" ${branchName}`);
            log(`  pushed to origin/${branchName}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to push to GitHub: ${errorMsg}`);
          } finally {
            try {
              await git(`worktree remove "${worktreeDir}" --force`);
            } catch {
              try {
                await fs.rm(worktreeDir, { recursive: true, force: true });
                await git(`worktree prune`);
              } catch {
              }
            }
          }
          log(`Creating pull request...`);
          try {
            const prTitle = await buildPullRequestTitle({
              apiKey,
              examId: finalExamId,
              examTitle,
              course: courseMatch?.[1],
              year: yearMatch?.[1]
            });
            const prBody = await buildPullRequestBody({
              apiKey,
              examTitle,
              examId: finalExamId,
              examDir,
              solutionFileName: solutionsFile.name,
              referenceFileNames: referenceFiles.map((refFile) => refFile.name)
            });
            const prUrl = await createOrGetPullRequest({
              githubUsername,
              githubToken,
              branchName,
              title: prTitle,
              body: prBody
            });
            log(`  ${prUrl}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to create pull request: ${errorMsg}`);
          }
        }
        const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
        log(`Done in ${elapsed}s`);
        controller.close();
      } catch (error) {
        log(`
Error: ${error}`);
        controller.close();
      }
    }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked"
    }
  });
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  POST
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
