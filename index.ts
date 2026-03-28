/**
 * pi-skills-extension
 *
 * A pi extension for searching, discovering, and installing AI agent skills
 * from multiple providers: SkillsMP and skills.sh.
 *
 * Repository: https://github.com/leandr0ck/pi-find-skills
 * Providers:
 *   - SkillsMP: https://skillsmp.com (requires API key)
 *   - skills.sh: https://skills.sh (no auth required)
 *
 * Setup:
 *   export SKILLSMP_API_KEY="sk_live_your_key"  # Optional, enables SkillsMP
 *   Get your key from: https://skillsmp.com/auth/login
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { skillsmpProvider, skillsshProvider } from "./providers";
import { detectSearchIntent } from "./search";
import { handleNaturalLanguageSearch, registerCommands } from "./commands";
import { registerTool } from "./tool";
import { SearchResultsMessageDetails, renderSkillsTable } from "./ui";

// All available providers
const providers = [skillsmpProvider, skillsshProvider];

export default function skillsExtension(pi: ExtensionAPI) {
  // Register message renderer for search results
  pi.registerMessageRenderer("skills-results", (message, { expanded }, theme) => {
    const details = message.details as SearchResultsMessageDetails | undefined;
    if (!details) {
      return new Text(message.content, 0, 0);
    }

    if (details.error) {
      return new Text(theme.fg("error", details.error), 0, 0);
    }

    const title = theme.fg("success", `Results for `) + theme.fg("accent", JSON.stringify(details.query));

    let text = title;

    // Show source breakdown
    if (details.sources) {
      const parts: string[] = [];
      if (details.sources.skillsmp > 0) parts.push(`${details.sources.skillsmp} SkillsMP`);
      if (details.sources.skillssh > 0) parts.push(`${details.sources.skillssh} skills.sh`);
      if (parts.length > 0) {
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }
    }

    if (details.skills.length > 0) {
      text += "\n\n" + renderSkillsTable(details.skills, theme, expanded);
    } else {
      text += "\n\n" + theme.fg("dim", "No results found.");
    }

    if (expanded) {
      for (const skill of details.skills) {
        const sourceLabel = skill.provider === "skillsmp" ? "SkillsMP" : "skills.sh";
        text += "\n\n" + theme.fg("dim", `/skills install ${skill.id}`) + theme.fg("muted", ` (${sourceLabel})`);
      }
    }

    return new Text(text, 0, 0);
  });

  // Command context shared across handlers
  const cmdCtx = {
    providers,
    sendMessage: (msg: Parameters<typeof pi.sendMessage>[0]) => pi.sendMessage(msg),
  };

  // Handle natural language input
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") {
      return { action: "continue" } as const;
    }

    const intent = detectSearchIntent(event.text);
    if (!intent) {
      return { action: "continue" } as const;
    }

    return handleNaturalLanguageSearch(intent, ctx, cmdCtx);
  });

  // Register LLM tools
  registerTool(pi, providers);

  // Register slash commands
  registerCommands(pi, cmdCtx);
}
