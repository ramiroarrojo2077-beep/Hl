/** Desarrollo: levanta el servidor de la API y Vite en paralelo. */
import { spawn } from "node:child_process";

const procs = [
  spawn(process.execPath, ["--env-file-if-exists=.env", "--watch", "server/index.ts"], { stdio: "inherit" }),
  spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite"], { stdio: "inherit", shell: process.platform === "win32" }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => code && stop());
