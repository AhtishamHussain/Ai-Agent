/**
 * Windows corporate/proxy SSL often breaks outbound HTTPS ("Connection error").
 * Run Next with relaxed TLS for local cloud APIs (Groq/Gemini).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { spawn } = require("child_process");
const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/with-tls.js <command> [...args]");
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: "inherit",
  shell: true,
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
