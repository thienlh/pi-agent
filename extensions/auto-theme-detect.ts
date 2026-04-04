/**
 * Auto Theme Detection Extension
 *
 * Detects terminal background color via OSC 11 query.
 * Uses an isolated child process to avoid TTY fd race with pi's TUI.
 *
 * Requirements: Node.js 24 LTS or later.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";

/** Runs in a spawned child process — CJS only, no imports, no TS-only syntax. */
// @ts-nocheck
function workerMain() {
  const fs = require("fs");
  let fd: number;
  try {
    fd = fs.openSync("/dev/tty", "r+");
  } catch {
    process.exit(1);
  }

  fs.writeSync(fd, Buffer.from("\x1b]11;?\x07"));

  let accumulated = "";
  const buf = Buffer.alloc(256);
  let attempts = 0;

  const check = () => {
    try {
      const bytesRead = fs.readSync(fd, buf, 0, 256, null);
      if (bytesRead > 0) {
        accumulated += buf.subarray(0, bytesRead).toString();
        const match = accumulated.match(/\x1b\]11;rgb:([0-9a-fA-F\/]+)\x07/);
        if (match) {
          fs.closeSync(fd);
          process.stdout.write(match[1]);
          process.exit(0);
        }
      }
    } catch {}

    if (++attempts < 10) setTimeout(check, 50);
    else {
      fs.closeSync(fd);
      process.exit(1);
    }
  };

  check();
}

/** Spawn a child process to query background color via OSC 11.
 *  The child gets its own independent TTY fd, avoiding race with pi's TUI. */
async function queryBackgroundColor(): Promise<string | null> {
  return new Promise((resolve) => {
    // stdio: [stdin, stdout, stderr] — ignore stdin/stderr, pipe stdout for the color result
    const child = spawn(
      process.execPath,
      ["-e", `(${workerMain.toString()})()`],
      {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      },
    );

    let output = "";
    child.stdout?.on("data", (data: Buffer) => (output += data.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 && output ? output : null));
  });
}

/** Parse rgb:RRRR/GGGG/BBBB to normalized RGB */
function parseColor(color: string): { r: number; g: number; b: number } | null {
  const parts = color.split("/");
  if (parts.length !== 3) return null;

  const vals = parts.map((p) => parseInt(p, 16));
  if (vals.some((v) => isNaN(v))) return null;

  // Normalize based on hex digit count, not value magnitude.
  // OSC 11 responses can be 8-bit (ff), 12-bit (fff), or 16-bit (ffff).
  const digits = parts[0].length;
  const max = (1 << (digits * 4)) - 1; // 2 digits→255, 3→4095, 4→65535
  return {
    r: vals[0] / max,
    g: vals[1] / max,
    b: vals[2] / max,
  };
}

/** ITU-R BT.601 luminance
 *  https://www.itu.int/rec/R-REC-BT.601/
 */
function isLight(r: number, g: number, b: number): boolean {
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5;
}

async function detectThemeMode(): Promise<"dark" | "light" | null> {
  const colorStr = await queryBackgroundColor();
  if (!colorStr) return null;

  const rgb = parseColor(colorStr);
  if (!rgb) return null;

  return isLight(rgb.r, rgb.g, rgb.b) ? "light" : "dark";
}

export default function (pi: ExtensionAPI) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const currentMode = ctx.ui.theme.mode;
    const detectedMode = await detectThemeMode();
    if (detectedMode && detectedMode !== currentMode)
      ctx.ui.setTheme(detectedMode);

    intervalId = setInterval(async () => {
      const nextMode = await detectThemeMode();
      if (nextMode && nextMode !== ctx.ui.theme.mode) {
        ctx.ui.setTheme(nextMode);
      }
    }, 5000);
  });

  pi.on("session_shutdown", () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}
