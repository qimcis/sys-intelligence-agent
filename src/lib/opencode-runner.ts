import { spawn } from "child_process";
import path from "path";

export interface OpenCodeRunOptions {
  message: string;
  workingDir: string;
  model?: string;
  onOutput?: (data: string) => void;
}

export async function runOpenCode(
  options: OpenCodeRunOptions,
): Promise<string> {
  const { message, workingDir, model, onOutput } = options;

  return new Promise((resolve, reject) => {
    const args = ["run", message];

    if (model) {
      args.push("--model", model);
    }

    const proc = spawn("opencode", args, {
      cwd: workingDir,
      env: {
        ...process.env,
        // Disable interactive prompts
        CI: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let errorOutput = "";

    proc.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      onOutput?.(text);
    });

    proc.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      errorOutput += text;
      onOutput?.(text);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`OpenCode exited with code ${code}: ${errorOutput}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

// Alternative: Use OpenAI directly for simpler agentic tasks
export async function analyzeLabWithOpenAI(
  repoPath: string,
  repoUrl: string,
  courseId: string | undefined,
  courseName: string | undefined,
  institution: string | undefined,
  year: number | undefined,
  tags: string[] | undefined,
  notes: string | undefined,
  apiKey: string,
  onLog: (msg: string) => void,
): Promise<LabAnalysisResult> {
  const { callOpenAI } = await import("./openai-client");
  const fs = await import("fs/promises");

  // Read directory structure
  onLog("Analyzing repository structure...");
  const structure = await getDirectoryStructure(repoPath, 3);

  // Find key files
  onLog("Identifying key files...");
  const keyFiles = await findKeyFiles(repoPath);

  // Read key file contents
  const fileContents: Record<string, string> = {};
  for (const file of keyFiles.slice(0, 10)) {
    // Limit to 10 files
    try {
      const content = await fs.readFile(path.join(repoPath, file), "utf-8");
      if (content.length < 50000) {
        // Skip very large files
        fileContents[file] = content;
      }
    } catch {
      // Skip unreadable files
    }
  }

  onLog("Calling AI to analyze lab structure...");

  // Build metadata overrides section
  const metadataOverrides: string[] = [];
  if (courseId) metadataOverrides.push(`- Course ID: ${courseId}`);
  if (courseName) metadataOverrides.push(`- Course Name: ${courseName}`);
  if (institution) metadataOverrides.push(`- Institution: ${institution}`);
  if (year) metadataOverrides.push(`- Year: ${year}`);
  if (tags && tags.length > 0)
    metadataOverrides.push(`- Tags: ${tags.join(", ")}`);

  const metadataSection =
    metadataOverrides.length > 0
      ? `The following metadata was explicitly provided (use these values):\n${metadataOverrides.join("\n")}\n\nFor any fields NOT listed above, infer them from the repository content.`
      : `No metadata was provided. Infer ALL course metadata from the repository URL and content.`;

  const analysisPrompt = `You are analyzing a programming lab repository to create a courselab benchmark entry.

Repository URL: ${repoUrl}

Repository structure:
${structure}

Key files found:
${keyFiles.join("\n")}

File contents:
${Object.entries(fileContents)
  .map(([name, content]) => `=== ${name} ===\n${content.slice(0, 5000)}`)
  .join("\n\n")}

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

  const response = await callOpenAI(
    [
      {
        role: "system",
        content:
          "You are an expert at analyzing programming lab repositories. Output only valid JSON.",
      },
      { role: "user", content: analysisPrompt },
    ],
    apiKey,
  );

  // Parse the response
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response;
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    throw new Error(
      `Failed to parse AI response as JSON: ${e}\n\nResponse:\n${response}`,
    );
  }
}

export interface LabAnalysisResult {
  course_metadata: {
    course_id: string;
    name: string;
    institution: string;
    year: number;
  };
  tasks: Array<{
    task_id: string;
    description: string;
    artifacts: string[];
    docker_image: string;
    working_dir: string;
    evaluate_commands: string[];
    preprocess_commands?: string[];
    timeout_minutes: number;
    tags: string[];
  }>;
  task_descriptions: Record<string, string>;
}

async function getDirectoryStructure(
  dir: string,
  maxDepth: number,
  currentDepth = 0,
  prefix = "",
): Promise<string> {
  const fs = await import("fs/promises");

  if (currentDepth >= maxDepth) return "";

  let result = "";
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const filtered = entries.filter(
      (e) =>
        !e.name.startsWith(".") &&
        ![
          "node_modules",
          "vendor",
          "__pycache__",
          "target",
          "build",
          "dist",
        ].includes(e.name),
    );

    for (const entry of filtered) {
      result += `${prefix}${entry.isDirectory() ? "/" : ""}${entry.name}\n`;
      if (entry.isDirectory()) {
        result += await getDirectoryStructure(
          path.join(dir, entry.name),
          maxDepth,
          currentDepth + 1,
          prefix + "  ",
        );
      }
    }
  } catch {
    // Ignore errors
  }
  return result;
}

async function findKeyFiles(dir: string): Promise<string[]> {
  const fs = await import("fs/promises");
  const keyFiles: string[] = [];

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
    /requirements\.txt$/,
  ];

  async function walk(currentDir: string, relativePath = "") {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          [
            "node_modules",
            "vendor",
            "__pycache__",
            "target",
            "build",
            "dist",
          ].includes(entry.name)
        ) {
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
      // Ignore errors
    }
  }

  await walk(dir);
  return keyFiles;
}
