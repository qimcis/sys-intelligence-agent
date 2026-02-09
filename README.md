# System Intelligence Benchmark Contributor

## Setup

```bash
npm install
```

## Configuration

Set your OpenAI API key either:

1. **Environment variable** (recommended for CLI):
   ```bash
   export OPENAI_API_KEY=sk-your-api-key-here
   ```

2. **Via the web UI**: Enter the key in the configuration section on the home page.

For server-side exam processing with Docker, set:
- `SIB_WORKER_IMAGE` (Docker image built from `docker/worker/Dockerfile`)
- `SIB_REPO_URL` (clone URL for the base system-intelligence-benchmark repo)

## Running

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
node ./dist/server/entry.mjs
```

The server runs on `http://localhost:3000` by default.

## Vercel (UI) + Docker Host (API)

This project is intended to run the UI on Vercel and the API on a Docker-capable host.

UI (Vercel):
1. Set the Vercel project framework to Astro.
2. Keep the build command as `npm run build`.
3. Leave the output directory blank.
4. Update `vercel.json` to point `/api/*` to your API host.

API (Docker host):
1. Build the worker image: `docker build -t sib-worker -f docker/worker/Dockerfile .`
2. Set env vars: `OPENAI_API_KEY`, `SIB_WORKER_IMAGE=sib-worker`, `SIB_REPO_URL`.
3. Build and run the server: `npm run build` then `node ./dist/server/entry.mjs`.

## Features

### Add Exams

1. Navigate to `/exams`
2. Fill in exam metadata (ID, name, course, institution, year)
3. Upload the exam PDF/TXT file
4. Upload the solutions PDF/TXT file
5. Optionally upload reference materials
6. Click "Process and Add Exam"

GitHub username and token are required to create a draft pull request.

The AI will parse the exam and solutions, generating a structured `exam.md` file in the courseexam format.

### Add Labs (WIP)

1. Navigate to `/labs`
2. Enter the GitHub repository URL
3. Fill in course metadata
4. Click "Clone and Analyze Lab"

The AI agent will:
- Clone the repository
- Analyze the structure to identify tasks
- Generate config.json, task.md, compose.yaml, and evaluate.sh for each task
- Copy starter files
- Update courses.json

## Output Locations

- **Exams**: `/system-intelligence-benchmark/benchmarks/courseexam_bench/data/raw/{exam_id}/`
- **Labs**: `/system-intelligence-benchmark/benchmarks/courselab_bench/data/{course_id}/`
