import { spawn } from "child_process";

export async function runDockerJob(params: {
  image: string;
  jobDir: string;
  env: Record<string, string>;
  log: (msg: string) => void;
  redact?: string[];
}): Promise<void> {
  if (process.env.VERCEL) {
    throw new Error(
      "Docker is not available in Vercel serverless functions. Run this service on a VM or container host with Docker.",
    );
  }

  const { image, jobDir, env, log } = params;
  const redactions = (params.redact ?? []).filter((value) => value.length > 0);
  const args = ["run", "--rm", "-v", `${jobDir}:/job`];

  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(image);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    const pipe = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) {
          let sanitized = line;
          for (const value of redactions) {
            sanitized = sanitized.split(value).join("***");
          }
          log(sanitized);
        }
      }
    };

    child.stdout?.on("data", pipe);
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
      pipe(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const suffix = stderr.trim().length > 0 ? `: ${stderr.trim()}` : "";
        reject(new Error(`Docker job failed with exit code ${code}${suffix}`));
      }
    });
  });
}
