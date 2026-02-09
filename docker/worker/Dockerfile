FROM node:20-bullseye

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --no-cache-dir pytest

WORKDIR /app

COPY scripts/exam-docker-runner.mjs /app/scripts/exam-docker-runner.mjs

ENTRYPOINT ["node", "/app/scripts/exam-docker-runner.mjs"]
