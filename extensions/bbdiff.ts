/**
 * BBEdit Diff Extension
 *
 * /bbdiff command opens BBEdit's Git Working Copy Status view
 * for the current working directory.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("bbdiff", {
		description: "Open BBEdit Git Working Copy Status view",
		handler: async (_args, ctx) => {
			// Escape path for AppleScript
			const escapePath = (s: string) => s.replace(/"/g, '\\"');

			// Use AppleScript to: 1) open current folder in BBEdit, 2) show Git status
			// Git is menu 12 in BBEdit's menu bar
			const appleScript = `tell application "BBEdit"
	if not running then
		launch
		delay 0.5
	end if
	activate
	-- Open the current folder as a project
	open POSIX file "${escapePath(ctx.cwd)}"
end tell

delay 0.5

tell application "System Events"
	tell process "BBEdit"
		click menu item "Show Working Copy Status…" of menu 12 of menu bar 1
	end tell
end tell`;

			const result = await pi.exec("osascript", ["-e", appleScript], { cwd: ctx.cwd });

			if (result.code !== 0) {
				ctx.ui.notify(`Failed to open BBEdit Git view: ${result.stderr}`, "error");
			}
		},
	});
}
