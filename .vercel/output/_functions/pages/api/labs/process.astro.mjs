import { a as COURSELAB_PATH } from '../../../chunks/config_BkSRtLkd.mjs';
import { M as MODELS, c as checkRateLimit } from '../../../chunks/rate-limit_BV7kvadu.mjs';
import path from 'path';
import simpleGit from 'simple-git';
import fs from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
export { renderers } from '../../../renderers.mjs';

async function analyzeLabWithOpenAI(repoPath, repoUrl, courseId, courseName, institution, year, tags, notes, apiKey, onLog) {
  const { callOpenAI: callOpenAI2 } = await import('../../../chunks/rate-limit_BV7kvadu.mjs').then(n => n.o);
  const fs = await import('fs/promises');
  onLog("Analyzing repository structure...");
  const structure = await getDirectoryStructure(repoPath, 3);
  onLog("Identifying key files...");
  const keyFiles = await findKeyFiles(repoPath);
  const fileContents = {};
  for (const file of keyFiles.slice(0, 10)) {
    try {
      const content = await fs.readFile(path.join(repoPath, file), "utf-8");
      if (content.length < 5e4) {
        fileContents[file] = content;
      }
    } catch {
    }
  }
  onLog("Calling AI to analyze lab structure...");
  const metadataOverrides = [];
  if (courseId) metadataOverrides.push(`- Course ID: ${courseId}`);
  if (courseName) metadataOverrides.push(`- Course Name: ${courseName}`);
  if (institution) metadataOverrides.push(`- Institution: ${institution}`);
  if (year) metadataOverrides.push(`- Year: ${year}`);
  if (tags && tags.length > 0)
    metadataOverrides.push(`- Tags: ${tags.join(", ")}`);
  const metadataSection = metadataOverrides.length > 0 ? `The following metadata was explicitly provided (use these values):
${metadataOverrides.join("\n")}

For any fields NOT listed above, infer them from the repository content.` : `No metadata was provided. Infer ALL course metadata from the repository URL and content.`;
  const analysisPrompt = `You are analyzing a programming lab repository to create a courselab benchmark entry.

Repository URL: ${repoUrl}

Repository structure:
${structure}

Key files found:
${keyFiles.join("\n")}

File contents:
${Object.entries(fileContents).map(([name, content]) => `=== ${name} ===
${content.slice(0, 5e3)}`).join("\n\n")}

${metadataSection}

Additional notes: ${notes || "None"}

Your task is to analyze this lab and generate the necessary files for the courselab benchmark format:

1. FIRST, infer course metadata from the repository:
   - course_id: Generate from course code and year (e.g., "mit_6_5840_2024"). Use lowercase with underscores.
   - name: Human-readable course name (e.g., "MIT 6.5840: Distributed Systems")
   - institution: Identify the university from repo URL, README, or content (e.g., "MIT", "Stanford", "CMU")
   - year: Extract from repo name, README, or dates in content

2. Identify distinct tasks/assignments in the repository
3. For each task, determine:
   - Task ID (lowercase, underscores, e.g., "task_1_mapreduce")
   - What files students need to modify (artifacts)
   - How to run tests/evaluation
   - What Docker image to use
   - Any preprocessing needed

Output a JSON object with this structure:
{
  "course_metadata": {
    "course_id": "mit_6_5840_2024",
    "name": "MIT 6.5840: Distributed Systems",
    "institution": "MIT",
    "year": 2024
  },
  "tasks": [
    {
      "task_id": "task_1_mapreduce",
      "description": "Brief description of the task",
      "artifacts": ["src/mr/coordinator.go", "src/mr/worker.go"],
      "docker_image": "golang:1.21-bookworm",
      "working_dir": "/workspace",
      "evaluate_commands": ["go test -v ./..."],
      "preprocess_commands": ["optional setup commands"],
      "timeout_minutes": 30,
      "tags": ["distributed-systems", "mapreduce"]
    }
  ],
  "task_descriptions": {
    "task_1_mapreduce": "Full markdown description of the task for task.md"
  }
}

Be thorough in identifying all tasks. Look for:
- Test files that indicate separate assignments
- README sections describing different parts
- Multiple main entry points
- Makefile targets

Output ONLY valid JSON, no other text.`;
  onLog(`  -> Using generator model: ${MODELS.generator}`);
  const generatedResponse = await callOpenAI2(
    [
      {
        role: "system",
        content: "You are an expert at analyzing programming lab repositories. Output only valid JSON."
      },
      { role: "user", content: analysisPrompt }
    ],
    apiKey,
    MODELS.generator
  );
  onLog(`  -> Validating with judge model: ${MODELS.judge}`);
  const judgePrompt = `You are a meticulous judge that validates and corrects lab analysis JSON for the courselab benchmark.

Review the following JSON output and fix any issues:
1. Ensure course_metadata has all required fields (course_id, name, institution, year)
2. Ensure each task has valid task_id, artifacts, docker_image, evaluate_commands
3. Fix any JSON syntax errors
4. Ensure task_ids are lowercase with underscores
5. Verify artifacts paths look reasonable

If you find errors, output the CORRECTED JSON.
If everything is correct, output the original JSON unchanged.

Output ONLY valid JSON, no explanations.

JSON to validate:
${generatedResponse}`;
  const response = await callOpenAI2(
    [
      {
        role: "system",
        content: "You are an expert JSON validator. Output only valid JSON."
      },
      { role: "user", content: judgePrompt }
    ],
    apiKey,
    MODELS.judge
  );
  try {
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    throw new Error(
      `Failed to parse AI response as JSON: ${e}

Response:
${response}`
    );
  }
}
async function getDirectoryStructure(dir, maxDepth, currentDepth = 0, prefix = "") {
  const fs = await import('fs/promises');
  if (currentDepth >= maxDepth) return "";
  let result = "";
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const filtered = entries.filter(
      (e) => !e.name.startsWith(".") && ![
        "node_modules",
        "vendor",
        "__pycache__",
        "target",
        "build",
        "dist"
      ].includes(e.name)
    );
    for (const entry of filtered) {
      result += `${prefix}${entry.isDirectory() ? "/" : ""}${entry.name}
`;
      if (entry.isDirectory()) {
        result += await getDirectoryStructure(
          path.join(dir, entry.name),
          maxDepth,
          currentDepth + 1,
          prefix + "  "
        );
      }
    }
  } catch {
  }
  return result;
}
async function findKeyFiles(dir) {
  const fs = await import('fs/promises');
  const keyFiles = [];
  const keyPatterns = [
    /readme\.md$/i,
    /makefile$/i,
    /dockerfile$/i,
    /docker-compose\.ya?ml$/i,
    /compose\.ya?ml$/i,
    /_test\.go$/,
    /test_.*\.py$/,
    /.*_test\.py$/,
    /test\..*$/,
    /main\.(go|py|c|cpp|rs|java)$/,
    /setup\.py$/,
    /pyproject\.toml$/,
    /go\.mod$/,
    /cargo\.toml$/i,
    /package\.json$/,
    /requirements\.txt$/
  ];
  async function walk(currentDir, relativePath = "") {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || [
          "node_modules",
          "vendor",
          "__pycache__",
          "target",
          "build",
          "dist"
        ].includes(entry.name)) {
          continue;
        }
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.join(relativePath, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, relPath);
        } else {
          if (keyPatterns.some((p) => p.test(entry.name))) {
            keyFiles.push(relPath);
          }
        }
      }
    } catch {
    }
  }
  await walk(dir);
  return keyFiles;
}

const execAsync = promisify(exec);
function getLabPath(repoPath) {
  if (repoPath) {
    return path.join(repoPath, "benchmarks", "courselab_bench", "data");
  }
  return COURSELAB_PATH;
}
function getCoursesJsonPath(repoPath) {
  return path.join(getLabPath(repoPath), "courses.json");
}
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
      const log = (msg) => {
        controller.enqueue(encoder.encode(msg + "\n"));
      };
      let tempDir = null;
      try {
        const data = await request.json();
        const {
          repoUrl,
          branch,
          notes,
          repoPath,
          githubUsername,
          githubToken
        } = data;
        let { courseId, courseName, institution, year, tags } = data;
        const apiKey = data.apiKey || process.env.OPENAI_API_KEY;
        const courseLabPath = getLabPath(repoPath);
        const coursesJsonPath = getCoursesJsonPath(repoPath);
        const hasGitHub = !!(githubUsername && githubToken && repoPath);
        const totalSteps = hasGitHub ? 8 : 6;
        if (!apiKey) {
          log(
            "ERROR: No OpenAI API key provided. Set OPENAI_API_KEY environment variable or enter it in the UI."
          );
          controller.close();
          return;
        }
        const tempId = courseId || `lab_${Date.now()}`;
        tempDir = path.join(os.tmpdir(), `lab-${tempId}`);
        await fs.mkdir(tempDir, { recursive: true });
        log(`[1/${totalSteps}] Cloning repository: ${repoUrl}`);
        log(`  -> Target: ${tempDir}`);
        const git = simpleGit();
        const cloneOptions = ["--depth", "1"];
        if (branch) {
          cloneOptions.push("--branch", branch);
        }
        await git.clone(repoUrl, tempDir, cloneOptions);
        log(`  -> Clone complete`);
        log(`[2/${totalSteps}] Analyzing repository with AI agent...`);
        const analysis = await analyzeLabWithOpenAI(
          tempDir,
          repoUrl,
          courseId,
          courseName,
          institution,
          year,
          tags,
          notes,
          apiKey,
          log
        );
        courseId = courseId || analysis.course_metadata.course_id;
        courseName = courseName || analysis.course_metadata.name;
        institution = institution || analysis.course_metadata.institution;
        year = year || analysis.course_metadata.year;
        log(`  -> Course ID: ${courseId}`);
        log(`  -> Course Name: ${courseName}`);
        log(`  -> Institution: ${institution}`);
        log(`  -> Year: ${year}`);
        log(`  -> Found ${analysis.tasks.length} task(s)`);
        log(`[3/${totalSteps}] Creating course directory structure...`);
        log(`  -> Using repo path: ${courseLabPath}`);
        const courseDir = path.join(courseLabPath, courseId);
        await fs.mkdir(courseDir, { recursive: true });
        log(`[4/${totalSteps}] Generating task files...`);
        for (const task of analysis.tasks) {
          const taskDir = path.join(courseDir, task.task_id);
          await fs.mkdir(taskDir, { recursive: true });
          log(`  -> Creating ${task.task_id}/`);
          const config = {
            instance_id: `${courseId}__${task.task_id}`,
            course_id: courseId,
            timeout_minutes: task.timeout_minutes,
            tags: task.tags,
            artifacts: task.artifacts
          };
          await fs.writeFile(
            path.join(taskDir, "config.json"),
            JSON.stringify(config, null, 2)
          );
          log(`     - config.json`);
          const taskMd = analysis.task_descriptions[task.task_id] || `# ${task.task_id}

${task.description}`;
          await fs.writeFile(path.join(taskDir, "task.md"), taskMd);
          log(`     - task.md`);
          const compose = generateComposeYaml(task);
          await fs.writeFile(path.join(taskDir, "compose.yaml"), compose);
          log(`     - compose.yaml`);
          const evaluateSh = generateEvaluateScript(task);
          await fs.writeFile(path.join(taskDir, "evaluate.sh"), evaluateSh);
          await fs.chmod(path.join(taskDir, "evaluate.sh"), 493);
          log(`     - evaluate.sh`);
          if (task.preprocess_commands && task.preprocess_commands.length > 0) {
            const preprocessSh = generatePreprocessScript(task);
            await fs.writeFile(
              path.join(taskDir, "preprocess.sh"),
              preprocessSh
            );
            await fs.chmod(path.join(taskDir, "preprocess.sh"), 493);
            log(`     - preprocess.sh`);
          }
          log(`     - Copying starter files...`);
          await copyStarterFiles(tempDir, taskDir, task.artifacts);
        }
        log(`[5/${totalSteps}] Updating courses.json...`);
        await updateCoursesJson(
          courseId,
          courseName,
          institution,
          year,
          analysis.tasks.length,
          coursesJsonPath
        );
        log(`[6/${totalSteps}] Cleaning up temporary files...`);
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = null;
        if (hasGitHub) {
          const coursePart = courseId.toLowerCase().replace(/\s+/g, "-");
          const yearPart = year || (/* @__PURE__ */ new Date()).getFullYear();
          const branchName = `${coursePart}-${yearPart}-lab`;
          const labTitle = courseName || courseId;
          const remoteUrl = `https://${githubUsername}:${githubToken}@github.com/${githubUsername}/system-intelligence-benchmark.git`;
          log(`[7/${totalSteps}] Creating git branch: ${branchName}`);
          try {
            process.chdir(repoPath);
            await execAsync(`git fetch origin main`);
            await execAsync(`git checkout -b ${branchName} origin/main`);
            log(`  -> Branch created: ${branchName}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            if (errorMsg.includes("already exists")) {
              await execAsync(`git checkout ${branchName}`);
              log(`  -> Branch already exists, checked out: ${branchName}`);
            } else {
              throw error;
            }
          }
          log(`[8/${totalSteps}] Committing and pushing to GitHub...`);
          try {
            await execAsync(`git add "${courseDir}"`);
            await execAsync(`git add "${coursesJsonPath}"`);
            await execAsync(`git commit -m "add \\"${labTitle}\\" lab"`);
            log(`  -> Committed: add "${labTitle}" lab`);
            await execAsync(`git push "${remoteUrl}" ${branchName}`);
            log(`  -> Pushed to origin/${branchName}`);
            await execAsync(`git checkout main`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log(`  -> Git error: ${errorMsg}`);
            try {
              await execAsync(`git checkout main`);
            } catch {
            }
            throw new Error(`Failed to push to GitHub: ${errorMsg}`);
          }
        }
        log(`
=== SUCCESS ===`);
        log(`Lab added to: ${courseDir}`);
        log(
          `Tasks created: ${analysis.tasks.map((t) => t.task_id).join(", ")}`
        );
        if (hasGitHub) {
          log(`
GitHub: Changes pushed to branch, ready for PR`);
        }
        log(`
Next steps:`);
        log(`1. Review the generated files in ${courseDir}`);
        log(`2. Test the evaluation scripts`);
        log(`3. Adjust Docker images and commands as needed`);
        if (!hasGitHub) {
          log(`4. Commit your changes to the repository`);
        }
        controller.close();
      } catch (error) {
        log(`
ERROR: ${error}`);
        if (tempDir) {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {
          }
        }
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
function generateComposeYaml(task) {
  const image = task.docker_image || "python:3.11-slim";
  const memLimit = image.includes("go") ? "2gb" : "512mb";
  const cpus = image.includes("go") ? "2.0" : "1.0";
  return `services:
  default:
    image: ${image}
    init: true
    command: tail -f /dev/null
    working_dir: ${task.working_dir || "/workspace"}
    network_mode: bridge
    cpus: '${cpus}'
    mem_limit: ${memLimit}
`;
}
function generateEvaluateScript(task) {
  const commands = task.evaluate_commands.length > 0 ? task.evaluate_commands : ['echo "No evaluation commands specified"', "exit 1"];
  return `#!/bin/bash
set -e

echo "=== Evaluating ${task.task_id} ==="

cd ${task.working_dir || "/workspace"}

${commands.map((cmd) => {
    if (cmd.includes("test") || cmd.includes("go ") || cmd.includes("pytest")) {
      return `timeout ${(task.timeout_minutes || 30) * 60} ${cmd}`;
    }
    return cmd;
  }).join("\n")}

echo "PASS: All tests passed"
exit 0
`;
}
function generatePreprocessScript(task) {
  const commands = task.preprocess_commands || [];
  return `#!/bin/bash
set -e

echo "=== Preprocessing ${task.task_id} ==="

${commands.join("\n")}

echo "Preprocessing complete"
`;
}
async function copyStarterFiles(sourceDir, taskDir, artifacts) {
  const starterDir = path.join(taskDir, "starter");
  await fs.mkdir(starterDir, { recursive: true });
  const excludePatterns = [
    ".git",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    "vendor",
    "target",
    "build",
    "dist",
    ".idea",
    ".vscode"
  ];
  async function copyDir(src, dest) {
    try {
      const entries = await fs.readdir(src, { withFileTypes: true });
      await fs.mkdir(dest, { recursive: true });
      for (const entry of entries) {
        if (excludePatterns.includes(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await copyDir(srcPath, destPath);
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    } catch {
    }
  }
  await copyDir(sourceDir, starterDir);
}
async function updateCoursesJson(courseId, courseName, institution, year, numTasks, coursesJsonPath) {
  let coursesData = { courses: [] };
  try {
    const existing = await fs.readFile(coursesJsonPath, "utf-8");
    coursesData = JSON.parse(existing);
  } catch {
  }
  const existingIndex = coursesData.courses.findIndex(
    (c) => c.course_id === courseId
  );
  const courseEntry = {
    course_id: courseId,
    name: courseName,
    institution,
    year,
    num_tasks: numTasks
  };
  if (existingIndex >= 0) {
    coursesData.courses[existingIndex] = courseEntry;
  } else {
    coursesData.courses.push(courseEntry);
  }
  await fs.writeFile(coursesJsonPath, JSON.stringify(coursesData, null, 2));
}

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  POST
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
