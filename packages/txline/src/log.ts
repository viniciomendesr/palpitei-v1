// Logger com ring buffer: o servidor expõe os últimos logs numa rota de
// diagnóstico, então tudo que passa por aqui fica observável sem SSH.

export type LogLevel = "info" | "warn" | "error";
export type LogLine = { ts: number; level: LogLevel; msg: string };

const MAX_LINES = 300;
const ring: LogLine[] = [];

const cores = {
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

function push(level: LogLevel, msg: string, cor: string): void {
  const line: LogLine = { ts: Date.now(), level, msg };
  ring.push(line);
  if (ring.length > MAX_LINES) ring.splice(0, ring.length - MAX_LINES);
  if (process.env.TXLINE_LOG_SILENT === "true") return;
  const hh = new Date(line.ts).toISOString().slice(11, 19);
  console.log(`${cores.gray}[${hh}]${cores.reset} ${cor}${msg}${cores.reset}`);
}

export function info(msg: string): void {
  push("info", msg, cores.gray);
}

export function warn(msg: string): void {
  push("warn", msg, cores.yellow);
}

export function error(msg: string): void {
  push("error", msg, cores.red);
}

/** Últimos logs (mais antigo primeiro), para a rota de diagnóstico. */
export function recentLogs(): LogLine[] {
  return ring.slice();
}
