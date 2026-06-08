import { execSync } from "child_process";
import path from "path";

const brokerUrl = process.env.PACT_BROKER_BASE_URL;
if (!brokerUrl) {
  console.log("PACT_BROKER_BASE_URL not set — skipping pact publish.");
  process.exit(0);
}

const pactsDir = path.resolve(__dirname, "pacts");
const version = process.env.CONSUMER_VERSION ?? (tryExec("git rev-parse --short HEAD") || "1.0.0");
const user = process.env.PACT_BROKER_USERNAME;
const password = process.env.PACT_BROKER_PASSWORD;

function tryExec(cmd: string): string {
  try { return execSync(cmd, { stdio: ["pipe", "pipe", "ignore"] }).toString().trim(); }
  catch { return ""; }
}

const branch = process.env.GIT_BRANCH ?? (tryExec("git rev-parse --abbrev-ref HEAD") || "main");
const repoUrl = process.env.REPOSITORY_URL ?? tryExec("git remote get-url origin");
const authFlags = user && password ? `--broker-username=${user} --broker-password=${password}` : "";

const cmd = [
  "./node_modules/.bin/pact-broker publish",
  pactsDir,
  `--broker-base-url=${brokerUrl}`,
  `--consumer-app-version=${version}`,
  `--branch=${branch}`,
  repoUrl ? `--tag=${branch}` : "",
  authFlags,
].filter(Boolean).join(" ");

console.log(`Publishing pacts to ${brokerUrl} (version ${version})...`);
execSync(cmd, { stdio: "inherit", cwd: __dirname });
console.log("Pacts published successfully.");
