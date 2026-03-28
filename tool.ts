/**
 * LLM Tool registration
 */

import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import type { SkillProvider, SearchMode, Skill } from "./providers/types";
import { searchAllProviders, normalizeQuery } from "./search";
import { renderSkillsTable, formatSkills, SearchResultsMessageDetails } from "./ui";

interface SearchToolDetails {
  query: string;
  requestedMode: SearchMode;
  mode: SearchMode;
  results: number;
  skills?: Skill[];
  error?: string;
  sources?: {
    skillsmp: number;
    skillssh: number;
  };
}

/**
 * Register the skills search tool
 */
export function registerTool(
  pi: {
    registerTool: (config: {
      name: string;
      label: string;
      description: string;
      promptSnippet: string;
      promptGuidelines: string[];
      parameters: ReturnType<typeof Type.Object>;
      renderCall: (args: unknown, theme: unknown) => Text;
      renderResult: (result: unknown, context: { expanded: boolean; isPartial: boolean }, theme: unknown) => Text;
      execute: (toolCallId: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
    }) => void;
  },
  providers: SkillProvider[]
): void {
  pi.registerTool({
    name: "skills_search",
    label: "Skills Search",
    description:
      "Search for AI agent skills from multiple providers (SkillsMP and skills.sh). Use when the user asks to find, search, or discover skills for a specific task.",
    promptSnippet: "Search skill marketplaces for agent skills",
    promptGuidelines: [
      "Use this tool when the user asks to find or search for skills.",
      "Present results as a numbered list with skill names, descriptions, and install commands.",
      "Include `/skills install <skill-id>` for each result.",
      "Results show the source (SkillsMP or skills.sh) for each skill.",
      "When the search is descriptive or task-oriented, prefer AI mode.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (e.g., 'react', 'web scraping', 'testing')" }),
      mode: StringEnum(["keyword", "ai"] as const, {
        description: "'keyword' for exact matches, 'ai' for semantic search",
      }),
    }),
    renderCall(args: { query: string; mode: SearchMode }, theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }) {
      let text = theme.fg("toolTitle", theme.bold("skills_search "));
      text += theme.fg("accent", JSON.stringify(args.query));
      text += theme.fg("dim", ` (${args.mode})`);
      return new Text(text, 0, 0);
    },
    renderResult(
      result: { content: Array<{ type: string; text: string }>; details?: SearchToolDetails },
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }
    ) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching skills..."), 0, 0);
      }

      const details = result.details;
      const content = result.content[0];
      const fallbackText = content?.type === "text" ? content.text : "No output";

      if (details?.error) {
        return new Text(theme.fg("error", `Search error: ${details.error}`), 0, 0);
      }

      const skills = details?.skills || [];
      if (skills.length === 0) {
        return new Text(theme.fg("dim", fallbackText), 0, 0);
      }

      let text = theme.fg("success", `${skills.length} skills`);
      if (details?.query) {
        text += theme.fg("dim", ` for `) + theme.fg("accent", JSON.stringify(details.query));
      }
      if (details?.mode) {
        text += theme.fg("dim", ` (${details.mode})`);
      }
      
      // Show source breakdown
      if (details?.sources) {
        const parts: string[] = [];
        if (details.sources.skillsmp > 0) parts.push(`${details.sources.skillsmp} from SkillsMP`);
        if (details.sources.skillssh > 0) parts.push(`${details.sources.skillssh} from skills.sh`);
        if (parts.length > 0) {
          text += theme.fg("dim", ` — ${parts.join(", ")}`);
        }
      }
      
      text += "\n\n" + renderSkillsTable(skills, theme as any, expanded);

      if (!expanded) {
        text += "\n\n" + theme.fg("dim", "Expand this tool result to see install commands and links.");
      }

      return new Text(text, 0, 0);
    },
    async execute(_toolCallId: string, params: { query: string; mode: SearchMode }) {
      const availableProviders = providers.filter(p => p.isAvailable());
      
      if (availableProviders.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                "⚠️ No skill providers available.\n\n" +
                "To use SkillsMP, set your API key:\n" +
                "  export SKILLSMP_API_KEY=\"sk_live_your_key\"\n" +
                "Get your key at: https://skillsmp.com/auth/login\n\n" +
                "skills.sh works without configuration.",
            },
          ],
        };
      }

      try {
        const result = await searchAllProviders(params.query, params.mode, providers);

        if (result.skills.length === 0) {
          return {
            content: [{ type: "text", text: `No skills found for "${params.query}".` }],
            details: {
              query: params.query,
              requestedMode: params.mode,
              mode: result.mode,
              results: 0,
              sources: result.sources,
            } as SearchToolDetails,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Found ${result.skills.length} skills for "${params.query}" using ${result.mode} search:\n\n${formatSkills(result.skills)}`,
            },
          ],
          details: {
            query: params.query,
            requestedMode: params.mode,
            mode: result.mode,
            results: result.skills.length,
            skills: result.skills,
            sources: result.sources,
          } as SearchToolDetails,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Error searching skills: ${message}` }],
          details: {
            query: params.query,
            requestedMode: params.mode,
            mode: params.mode,
            results: 0,
            error: message,
          } as SearchToolDetails,
        };
      }
    },
  });

  // Legacy tool name for backward compatibility
  pi.registerTool({
    name: "skillsmp_search",
    label: "SkillsMP Search (Legacy)",
    description:
      "[Legacy] Search for AI agent skills in the SkillsMP marketplace. Prefer skills_search for multi-provider results.",
    promptSnippet: "Search SkillsMP marketplace for agent skills",
    promptGuidelines: [
      "This is a legacy tool. Consider using skills_search for results from multiple providers.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      mode: StringEnum(["keyword", "ai"] as const, {
        description: "'keyword' for exact matches, 'ai' for semantic search",
      }),
    }),
    renderCall(args: { query: string; mode: SearchMode }, theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }) {
      let text = theme.fg("toolTitle", theme.bold("skillsmp_search "));
      text += theme.fg("accent", JSON.stringify(args.query));
      text += theme.fg("dim", ` (${args.mode})`);
      return new Text(text, 0, 0);
    },
    renderResult(
      result: { content: Array<{ type: string; text: string }>; details?: SearchToolDetails },
      { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
      theme: { fg: (color: string, text: string) => string; bold: (text: string) => string }
    ) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Searching SkillsMP..."), 0, 0);
      }

      const details = result.details;
      const content = result.content[0];
      const fallbackText = content?.type === "text" ? content.text : "No output";

      if (details?.error) {
        return new Text(theme.fg("error", `Search error: ${details.error}`), 0, 0);
      }

      const skills = details?.skills || [];
      if (skills.length === 0) {
        return new Text(theme.fg("dim", fallbackText), 0, 0);
      }

      let text = theme.fg("success", `${skills.length} skills`);
      if (details?.query) {
        text += theme.fg("dim", ` for `) + theme.fg("accent", JSON.stringify(details.query));
      }
      text += "\n\n" + renderSkillsTable(skills, theme as any, expanded);

      return new Text(text, 0, 0);
    },
    async execute(_toolCallId: string, params: { query: string; mode: SearchMode }) {
      const skillsmpProvider = providers.find(p => p.id === "skillsmp");
      
      if (!skillsmpProvider?.isAvailable()) {
        return {
          content: [
            {
              type: "text",
              text:
                "⚠️ SkillsMP API key not configured.\n\n" +
                "Get your free API key at: https://skillsmp.com/auth/login\n" +
                "Then add to your shell profile:\n" +
                '  export SKILLSMP_API_KEY="sk_live_your_key"',
            },
          ],
        };
      }

      try {
        const skills = await skillsmpProvider.search(params.query, params.mode);

        if (skills.length === 0) {
          return {
            content: [{ type: "text", text: `No skills found for "${params.query}" on SkillsMP.` }],
            details: { query: params.query, requestedMode: params.mode, mode: params.mode, results: 0, sources: { skillsmp: 0, skillssh: 0 } } as SearchToolDetails,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Found ${skills.length} skills for "${params.query}" on SkillsMP:\n\n${formatSkills(skills)}`,
            },
          ],
          details: { query: params.query, requestedMode: params.mode, mode: params.mode, results: skills.length, skills, sources: { skillsmp: skills.length, skillssh: 0 } } as SearchToolDetails,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Error searching SkillsMP: ${message}` }],
          details: { query: params.query, requestedMode: params.mode, mode: params.mode, results: 0, error: message } as SearchToolDetails,
        };
      }
    },
  });
}
