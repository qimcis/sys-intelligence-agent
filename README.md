# System Intelligence Benchmark Contributor

A web interface for adding exams and labs to the System Intelligence Benchmark repository.

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

## Running

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm run start
```

The server runs on `http://localhost:3000` by default.

## Features

### Add Exams

1. Navigate to `/exams`
2. Fill in exam metadata (ID, name, course, institution, year)
3. Upload the exam PDF/TXT file
4. Upload the solutions PDF/TXT file
5. Optionally upload reference materials
6. Click "Process and Add Exam"

The AI will parse the exam and solutions, generating a structured `exam.md` file in the courseexam format.

### Add Labs

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

- **Exams**: `/home/qi/system-intelligence-benchmark/benchmarks/courseexam_bench/data/raw/{exam_id}/`
- **Labs**: `/home/qi/system-intelligence-benchmark/benchmarks/courselab_bench/data/{course_id}/`

## After Adding Content

1. Review the generated files
2. Test lab evaluation scripts if applicable
3. For exams, run `python prepare_dataset.py` in the courseexam_bench directory
4. Commit changes to the repository
