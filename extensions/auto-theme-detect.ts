/**
 * Auto Theme Detection Extension
 *
 * Detects terminal background color via OSC 11 query.
 * Uses Ghostty/terminal's reported background RGB with luminance check.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/** Send OSC 11 query and read response from stdin */
async function queryBackgroundColor(): Promise<string | null> {
	return new Promise((resolve) => {
		// OSC 11 query: ESC ] 11 ; ? BEL
		process.stdout.write("\x1b]11;?\x07");

		const onData = (data: Buffer) => {
			const str = data.toString();
			// Response format: ESC ] 11 ; rgb:RRRR/GGGG/BBBB BEL
			const match = str.match(/\x1b\]11;rgb:([0-9a-fA-F\/]+)\x07/);
			if (match) {
				process.stdin.off("data", onData);
				resolve(match[1]);
			}
		};

		process.stdin.on("data", onData);

		// Timeout after 500ms
		setTimeout(() => {
			process.stdin.off("data", onData);
			resolve(null);
		}, 500);
	});
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
		}, 3000);
	});

	pi.on("session_shutdown", () => {
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	});
}
