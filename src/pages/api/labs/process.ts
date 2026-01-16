import type { APIRoute } from 'astro';
import { COURSELAB_PATH, COURSELAB_COURSES_JSON } from '../../../lib/config';
import { analyzeLabWithOpenAI, type LabAnalysisResult } from '../../../lib/opencode-runner';
import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

function getLabPath(repoPath?: string): string {
  if (repoPath) {
    return path.join(repoPath, 'benchmarks', 'courselab_bench', 'data');
  }
  return COURSELAB_PATH;
}

function getCoursesJsonPath(repoPath?: string): string {
  return path.join(getLabPath(repoPath), 'courses.json');
}

interface LabRequest {
  repoUrl: string;
  branch?: string;
  courseId: string;
  courseName: string;
  institution: string;
  year: number;
  tags: string[];
  notes: string;
  apiKey?: string;
  repoPath?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const log = (msg: string) => {
        controller.enqueue(encoder.encode(msg + '\n'));
      };
      
      let tempDir: string | null = null;
      
      try {
        const data = await request.json() as LabRequest;
        const { repoUrl, branch, courseId, courseName, institution, year, tags, notes, repoPath } = data;
        const apiKey = data.apiKey || process.env.OPENAI_API_KEY;
        const courseLabPath = getLabPath(repoPath);
        const coursesJsonPath = getCoursesJsonPath(repoPath);
        
        if (!apiKey) {
          log('ERROR: No OpenAI API key provided. Set OPENAI_API_KEY environment variable or enter it in the UI.');
          controller.close();
          return;
        }
        
        // Create temp directory
        tempDir = path.join(os.tmpdir(), `lab-${courseId}-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });
        
        log(`[1/6] Cloning repository: ${repoUrl}`);
        log(`  -> Target: ${tempDir}`);
        
        const git = simpleGit();
        const cloneOptions = ['--depth', '1'];
        if (branch) {
          cloneOptions.push('--branch', branch);
        }
        
        await git.clone(repoUrl, tempDir, cloneOptions);
        log(`  -> Clone complete`);
        
        log(`[2/6] Analyzing repository with AI agent...`);
        
        const analysis = await analyzeLabWithOpenAI(
          tempDir,
          courseId,
          courseName,
          institution,
          year,
          tags,
          notes,
          apiKey,
          log
        );
        
        log(`  -> Found ${analysis.tasks.length} task(s)`);
        
        log(`[3/6] Creating course directory structure...`);
        log(`  -> Using repo path: ${courseLabPath}`);
        const courseDir = path.join(courseLabPath, courseId);
        await fs.mkdir(courseDir, { recursive: true });
        
        log(`[4/6] Generating task files...`);
        
        for (const task of analysis.tasks) {
          const taskDir = path.join(courseDir, task.task_id);
          await fs.mkdir(taskDir, { recursive: true });
          log(`  -> Creating ${task.task_id}/`);
          
          // config.json
          const config = {
            instance_id: `${courseId}__${task.task_id}`,
            course_id: courseId,
            timeout_minutes: task.timeout_minutes,
            tags: task.tags,
            artifacts: task.artifacts
          };
          await fs.writeFile(
            path.join(taskDir, 'config.json'),
            JSON.stringify(config, null, 2)
          );
          log(`     - config.json`);
          
          // task.md
          const taskMd = analysis.task_descriptions[task.task_id] || 
            `# ${task.task_id}\n\n${task.description}`;
          await fs.writeFile(path.join(taskDir, 'task.md'), taskMd);
          log(`     - task.md`);
          
          // compose.yaml
          const compose = generateComposeYaml(task);
          await fs.writeFile(path.join(taskDir, 'compose.yaml'), compose);
          log(`     - compose.yaml`);
          
          // evaluate.sh
          const evaluateSh = generateEvaluateScript(task);
          await fs.writeFile(path.join(taskDir, 'evaluate.sh'), evaluateSh);
          await fs.chmod(path.join(taskDir, 'evaluate.sh'), 0o755);
          log(`     - evaluate.sh`);
          
          // preprocess.sh (if needed)
          if (task.preprocess_commands && task.preprocess_commands.length > 0) {
            const preprocessSh = generatePreprocessScript(task);
            await fs.writeFile(path.join(taskDir, 'preprocess.sh'), preprocessSh);
            await fs.chmod(path.join(taskDir, 'preprocess.sh'), 0o755);
            log(`     - preprocess.sh`);
          }
          
          // Copy starter files from cloned repo
          log(`     - Copying starter files...`);
          await copyStarterFiles(tempDir, taskDir, task.artifacts);
        }
        
        log(`[5/6] Updating courses.json...`);
        await updateCoursesJson(courseId, courseName, institution, year, analysis.tasks.length, coursesJsonPath);
        
        log(`[6/6] Cleaning up temporary files...`);
        await fs.rm(tempDir, { recursive: true, force: true });
        tempDir = null;
        
        log(`\n=== SUCCESS ===`);
        log(`Lab added to: ${courseDir}`);
        log(`Tasks created: ${analysis.tasks.map(t => t.task_id).join(', ')}`);
        log(`\nNext steps:`);
        log(`1. Review the generated files in ${courseDir}`);
        log(`2. Test the evaluation scripts`);
        log(`3. Adjust Docker images and commands as needed`);
        log(`4. Commit your changes to the repository`);
        
        controller.close();
      } catch (error) {
        log(`\nERROR: ${error}`);
        
        // Cleanup on error
        if (tempDir) {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
        
        controller.close();
      }
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    }
  });
};

function generateComposeYaml(task: LabAnalysisResult['tasks'][0]): string {
  const image = task.docker_image || 'python:3.11-slim';
  const memLimit = image.includes('go') ? '2gb' : '512mb';
  const cpus = image.includes('go') ? '2.0' : '1.0';
  
  return `services:
  default:
    image: ${image}
    init: true
    command: tail -f /dev/null
    working_dir: ${task.working_dir || '/workspace'}
    network_mode: bridge
    cpus: '${cpus}'
    mem_limit: ${memLimit}
`;
}

function generateEvaluateScript(task: LabAnalysisResult['tasks'][0]): string {
  const commands = task.evaluate_commands.length > 0 
    ? task.evaluate_commands 
    : ['echo "No evaluation commands specified"', 'exit 1'];
  
  return `#!/bin/bash
set -e

echo "=== Evaluating ${task.task_id} ==="

cd ${task.working_dir || '/workspace'}

${commands.map(cmd => {
  // Add timeout wrapper for long-running commands
  if (cmd.includes('test') || cmd.includes('go ') || cmd.includes('pytest')) {
    return `timeout ${(task.timeout_minutes || 30) * 60} ${cmd}`;
  }
  return cmd;
}).join('\n')}

echo "PASS: All tests passed"
exit 0
`;
}

function generatePreprocessScript(task: LabAnalysisResult['tasks'][0]): string {
  const commands = task.preprocess_commands || [];
  
  return `#!/bin/bash
set -e

echo "=== Preprocessing ${task.task_id} ==="

${commands.join('\n')}

echo "Preprocessing complete"
`;
}

async function copyStarterFiles(
  sourceDir: string, 
  taskDir: string, 
  artifacts: string[]
): Promise<void> {
  const starterDir = path.join(taskDir, 'starter');
  await fs.mkdir(starterDir, { recursive: true });
  
  // Copy the entire source directory structure, excluding common non-essential files
  const excludePatterns = [
    '.git',
    'node_modules',
    '__pycache__',
    '.pytest_cache',
    'vendor',
    'target',
    'build',
    'dist',
    '.idea',
    '.vscode'
  ];
  
  async function copyDir(src: string, dest: string) {
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
      // Ignore copy errors for individual files
    }
  }
  
  await copyDir(sourceDir, starterDir);
}

async function updateCoursesJson(
  courseId: string,
  courseName: string,
  institution: string,
  year: number,
  numTasks: number,
  coursesJsonPath: string
): Promise<void> {
  let coursesData: { courses: Array<{
    course_id: string;
    name: string;
    institution: string;
    year: number;
    num_tasks: number;
  }> } = { courses: [] };

  try {
    const existing = await fs.readFile(coursesJsonPath, 'utf-8');
    coursesData = JSON.parse(existing);
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  // Check if course already exists
  const existingIndex = coursesData.courses.findIndex(c => c.course_id === courseId);

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
