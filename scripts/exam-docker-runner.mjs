import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

const jobDir = requireEnv("JOB_DIR");
const repoUrl = requireEnv("REPO_URL");
const examId = requireEnv("EXAM_ID");
const branchName = requireEnv("BRANCH_NAME");
const githubUsername = requireEnv("GITHUB_USERNAME");
const githubToken = requireEnv("GITHUB_TOKEN");
const baseBranch = process.env.BASE_BRANCH || "main";
const commitTitle = process.env.COMMIT_TITLE || `add ${examId}`;

const inputDir = path.join(jobDir, "input");
const repoDir = path.join(jobDir, "repo");

console.log(`Cloning ${repoUrl}...`);
await run("git", ["clone", "--depth", "1", "--branch", baseBranch, repoUrl, repoDir]);

console.log(`Creating branch ${branchName}...`);
await run("git", ["checkout", "-b", branchName], { cwd: repoDir });

const examDir = path.join(
  repoDir,
  "benchmarks",
  "courseexam_bench",
  "data",
  "raw",
  examId,
);
await fs.mkdir(examDir, { recursive: true });

console.log("Copying files...");
const files = await fs.readdir(inputDir);
for (const file of files) {
  await fs.copyFile(path.join(inputDir, file), path.join(examDir, file));
}

const benchDir = path.join(repoDir, "benchmarks", "courseexam_bench");

console.log("Preparing dataset...");
await run("python3", ["courseexam/prepare.py"], { cwd: benchDir });

console.log("Validating schema...");
await run("python3", ["-m", "pytest", "tests/test_data_schema.py", "-q"], {
  cwd: benchDir,
});

await run("git", ["config", "user.email", `${githubUsername}@users.noreply.github.com`], {
  cwd: repoDir,
});
await run("git", ["config", "user.name", githubUsername], { cwd: repoDir });

await run("git", ["add", "-A"], { cwd: repoDir });
await run("git", ["commit", "-m", commitTitle], { cwd: repoDir });

const remoteUrl = `https://${githubUsername}:${githubToken}@github.com/${githubUsername}/system-intelligence-benchmark.git`;
await run("git", ["remote", "add", "fork", remoteUrl], { cwd: repoDir });

console.log(`Pushing to fork branch ${branchName}...`);
await run("git", ["push", "fork", branchName], { cwd: repoDir });

console.log("Done");
