/**
 * Auto Theme Detection Extension
 *
 * Detects terminal background color via OSC 11 query.
 * Uses a separate /dev/tty fd to avoid interfering with pi's TUI stdin/stdout.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { open, type FileHandle } from "node:fs/promises";

/** Send OSC 11 query and read response via a separate /dev/tty fd
 *  so we don't interfere with the TUI's stdin/stdout handling. */
async function queryBackgroundColor(): Promise<string | null> {
	let fh: FileHandle | null = null;

	try {
		fh = await open("/dev/tty", "r+");
	} catch {
		return null;
	}

	try {
		// Write OSC 11 query: ESC ] 11 ; ? BEL
		await fh.write("\x1b]11;?\x07");

		// Read response with timeout
		const buf = Buffer.alloc(256);
		let accumulated = "";

		const result = await Promise.race([
			(async () => {
				// Poll for response
				for (let i = 0; i < 10; i++) {
					try {
						const { bytesRead } = await fh!.read(buf, 0, buf.length, null);
						if (bytesRead > 0) {
							accumulated += buf.subarray(0, bytesRead).toString();
							// Response format: ESC ] 11 ; rgb:RRRR/GGGG/BBBB BEL
							const match = accumulated.match(/\x1b\]11;rgb:([0-9a-fA-F\/]+)\x07/);
							if (match) return match[1];
						}
					} catch {
						break;
					}
					await new Promise((r) => setTimeout(r, 50));
				}
				return null;
			})(),
			new Promise<null>((r) => setTimeout(() => r(null), 500)),
		]);

		return result;
	} catch {
		return null;
	} finally {
		await fh.close().catch(() => {});
	}
}

/** Parse rgb:RRRR/GGGG/BBBB to normalized RGB */
function parseColor(colorStr: string): { r: number; g: number; b: number } | null {
	const parts = colorStr.split("/");
	if (parts.length !== 3) return null;

	const vals = parts.map((p) => parseInt(p, 16));
	if (vals.some((v) => isNaN(v))) return null;

	// Normalize based on bit depth (usually 16-bit per channel in OSC responses)
	const max = vals.some((v) => v > 255) ? 65535 : 255;
	return {
		r: vals[0] / max,
		g: vals[1] / max,
		b: vals[2] / max,
	};
}

/** ITU-R BT.601 luminance */
function isLight(r: number, g: number, b: number): boolean {
	return 0.299 * r + 0.587 * g + 0.114 * b > 0.5;
}

async function detectTheme(): Promise<"dark" | "light"> {
	const colorStr = await queryBackgroundColor();
	if (!colorStr) return "dark";

	const rgb = parseColor(colorStr);
	if (!rgb) return "dark";

	return isLight(rgb.r, rgb.g, rgb.b) ? "light" : "dark";
}

export default function (pi: ExtensionAPI) {
	let intervalId: ReturnType<typeof setInterval> | null = null;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const theme = await detectTheme();
		ctx.ui.setTheme(theme);

		intervalId = setInterval(async () => {
			const next = await detectTheme();
			if (next !== ctx.ui.theme.mode) {
				ctx.ui.setTheme(next);
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
