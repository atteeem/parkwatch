// DEVELOPMENT ONLY: start the web app in BACKEND mode against the local mock
// backend (scripts/mock-supabase-backend.mjs on port 54399). Uses a public
// placeholder anon key; never put a real key or a service-role key here.
import { spawn } from "node:child_process";

const port = process.env.WEB_PORT ?? "8082";
const env = {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: process.env.MOCK_BACKEND_URL ?? "http://localhost:54399",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "mock-anon",
};
const child = spawn("npx", ["expo", "start", "--web", "--port", port], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
