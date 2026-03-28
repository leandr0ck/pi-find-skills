/**
 * SkillsMP Extension for pi
 *
 * Search, discover, and install AI agent skills from SkillsMP marketplace.
 *
 * Repository: https://github.com/leandr0ck/pi-skillsmp
 * Marketplace: https://skillsmp.com
 *
 * Setup:
 *   export SKILLSMP_API_KEY="sk_live_your_key"
 *   Get your key from: https://skillsmp.com/auth/login
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import https from "node:https";

// API configuration
const API_BASE = "skillsmp.com";

// Types
interface Skill {
  id: string;
  name: string;
  author: string;
  description: string;
  stars: number;
  githubUrl?: string;
  skillUrl?: string;
}

// Get API key with helpful error message
function getApiKey(): string {
  const key = process.env.SKILLSMP_API_KEY;
  if (!key) {
    throw new Error(
      "SKILLSMP_API_KEY not set.\n\n" +
        "Get your free API key at: https://skillsmp.com/auth/login\n" +
        "Then add to your shell profile:\n" +
        '  export SKILLSMP_API_KEY="sk_live_your_key"'
    );
  }
  return key;
}

// Check if API key is configured
function hasApiKey(): boolean {
  return !!process.env.SKILLSMP_API_KEY;
}

// Make API request
async function apiRequest(endpoint: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const querystring = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();

    const path = `/api/v1/${endpoint}${querystring ? "?" + querystring : ""}`;

    const options = {
      hostname: API_BASE,
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: "application/json",
        "User-Agent": "pi-skillsmp-extension/1.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            const errorMsg =
              json.error?.message || json.error?.code || `HTTP ${res.statusCode}`;
            reject(new Error(`SkillsMP API error: ${errorMsg}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error("Invalid JSON response from SkillsMP API"));
        }
      });
    });

    req.on("error", (err) => reject(new Error(`Network error: ${err.message}`)));
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Request timeout (30s)"));
    });
    req.end();
  });
}

// Search skills by keyword
async function searchSkills(query: string, limit = 10): Promise<Skill[]> {
  const response = (await apiRequest("skills/search", { q: query, limit })) as {
    data?: { skills?: Skill[] };
  };
  return response.data?.skills || [];
}

// AI semantic search
async function aiSearchSkills(query: string): Promise<Skill[]> {
  const response = (await apiRequest("skills/ai-search", { q: query })) as {
    data?: { data?: Array<{ skill?: Skill }> };
  };
  const results = response.data?.data || [];
  return results.map((r) => r.skill).filter((s): s is Skill => s !== undefined && !!s.id);
}

// Format skills as markdown
function formatSkills(skills: Skill[]): string {
  if (skills.length === 0) return "No skills found.";

  return skills
    .map((s, i) => {
      const stars = s.stars > 0 ? ` ★${s.stars.toLocaleString()}` : "";
      return (
        `**${i + 1}. ${s.name}**${stars} _by ${s.author}_\n` +
        `${s.description}\n` +
        "`npx skills add " +
        s.id +
        "`"
      );
    })
    .join("\n\n");
}

// Install a skill
async function installSkill(skillId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { execSync } = await import("node:child_process");
    execSync(`npx skills add ${skillId} -g -y`, { stdio: "pipe", timeout: 60000 });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

// Extension entry point
export default function skillsmpExtension(pi: ExtensionAPI) {
  // ============================================================
  // Tool: skillsmp_search (LLM can call this directly)
  // ============================================================
  pi.registerTool({
    name: "skillsmp_search",
    label: "SkillsMP Search",
    description:
      "Search for AI agent skills in the SkillsMP marketplace. Use when the user asks to find, search, or discover skills for a specific task.",
    promptSnippet: "Search SkillsMP marketplace for agent skills",
    promptGuidelines: [
      "Use this tool when the user asks to find or search for skills",
      "Present results as a numbered list with skill names and descriptions",
      "Include the install command for each skill",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (e.g., 'react', 'web scraping', 'testing')" }),
      mode: StringEnum(["keyword", "ai"] as const, {
        description: "'keyword' for exact matches, 'ai' for semantic search",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      // Check for API key first
      if (!hasApiKey()) {
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
        const skills = params.mode === "ai" ? await aiSearchSkills(params.query) : await searchSkills(params.query);

        if (skills.length === 0) {
          return {
            content: [{ type: "text", text: `No skills found for "${params.query}". Try a different query or use AI search mode.` }],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Found ${skills.length} skills for "${params.query}":\n\n${formatSkills(skills)}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
          content: [{ type: "text", text: `Error searching skills: ${message}` }],
        };
      }
    },
  });

  // ============================================================
  // Command: /skillsmp search <query>
  // ============================================================
  pi.registerCommand("skillsmp search", {
    description: "Search SkillsMP marketplace for skills",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /skillsmp search <query>", "error");
        return;
      }

      if (!hasApiKey()) {
        ctx.ui.notify("SKILLSMP_API_KEY not set. Get your key at skillsmp.com", "error");
        return;
      }

      ctx.ui.setStatus("skillsmp", "Searching...");

      try {
        const skills = await searchSkills(query);
        ctx.ui.setStatus("skillsmp", "");

        if (skills.length === 0) {
          ctx.ui.notify(`No skills found for "${query}"`, "info");
          return;
        }

        // Show results in a selector
        const items = skills.map((s) => {
          const stars = s.stars > 0 ? ` ★${s.stars.toLocaleString()}` : "";
          return `${s.name}${stars} (${s.author})`;
        });

        const selected = await ctx.ui.select(`Found ${skills.length} skills`, items);

        if (selected !== null) {
          const index = items.indexOf(selected);
          const skill = skills[index];

          const install = await ctx.ui.confirm(
            `Install ${skill.name}?`,
            `${skill.description}\n\nAuthor: ${skill.author}\nGitHub: ${skill.githubUrl || "N/A"}`
          );

          if (install) {
            ctx.ui.setStatus("skillsmp", `Installing ${skill.name}...`);
            const result = await installSkill(skill.id);
            ctx.ui.setStatus("skillsmp", "");

            if (result.success) {
              ctx.ui.notify(`✓ Installed ${skill.name}`, "success");
            } else {
              ctx.ui.notify(`Failed to install: ${result.error}`, "error");
            }
          }
        }
      } catch (err) {
        ctx.ui.setStatus("skillsmp", "");
        const message = err instanceof Error ? err.message : "Unknown error";
        ctx.ui.notify(`Error: ${message}`, "error");
      }
    },
  });

  // ============================================================
  // Command: /skillsmp ai <query>
  // ============================================================
  pi.registerCommand("skillsmp ai", {
    description: "AI semantic search on SkillsMP",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /skillsmp ai <query>", "error");
        return;
      }

      if (!hasApiKey()) {
        ctx.ui.notify("SKILLSMP_API_KEY not set. Get your key at skillsmp.com", "error");
        return;
      }

      ctx.ui.setStatus("skillsmp", "AI searching...");

      try {
        const skills = await aiSearchSkills(query);
        ctx.ui.setStatus("skillsmp", "");

        if (skills.length === 0) {
          ctx.ui.notify(`No skills found for "${query}"`, "info");
          return;
        }

        const items = skills.map((s) => {
          const stars = s.stars > 0 ? ` ★${s.stars.toLocaleString()}` : "";
          return `${s.name}${stars} (${s.author})`;
        });

        const selected = await ctx.ui.select(`AI found ${skills.length} skills`, items);

        if (selected !== null) {
          const index = items.indexOf(selected);
          const skill = skills[index];

          const install = await ctx.ui.confirm(`Install ${skill.name}?`, skill.description);

          if (install) {
            ctx.ui.setStatus("skillsmp", `Installing ${skill.name}...`);
            const result = await installSkill(skill.id);
            ctx.ui.setStatus("skillsmp", "");

            if (result.success) {
              ctx.ui.notify(`✓ Installed ${skill.name}`, "success");
            } else {
              ctx.ui.notify(`Failed to install: ${result.error}`, "error");
            }
          }
        }
      } catch (err) {
        ctx.ui.setStatus("skillsmp", "");
        const message = err instanceof Error ? err.message : "Unknown error";
        ctx.ui.notify(`Error: ${message}`, "error");
      }
    },
  });

  // ============================================================
  // Command: /skillsmp install <id>
  // ============================================================
  pi.registerCommand("skillsmp install", {
    description: "Install a skill from SkillsMP by ID",
    handler: async (args, ctx) => {
      const skillId = args.trim();
      if (!skillId) {
        ctx.ui.notify("Usage: /skillsmp install <skill-id>", "error");
        return;
      }

      ctx.ui.setStatus("skillsmp", "Installing...");

      const result = await installSkill(skillId);
      ctx.ui.setStatus("skillsmp", "");

      if (result.success) {
        ctx.ui.notify("✓ Skill installed", "success");
      } else {
        ctx.ui.notify(`Failed to install: ${result.error}`, "error");
      }
    },
  });

  // ============================================================
  // Command: /skillsmp (help)
  // ============================================================
  pi.registerCommand("skillsmp", {
    description: "SkillsMP marketplace - search and install agent skills",
    handler: async (_args, ctx) => {
      const commands = [
        "/skillsmp search <query> - Search skills by keywords",
        "/skillsmp ai <query> - AI semantic search",
        "/skillsmp install <id> - Install a skill by ID",
      ];

      const selected = await ctx.ui.select("SkillsMP Commands", commands);
      if (selected) {
        ctx.ui.notify(`Try: ${selected}`, "info");
      }
    },
  });
}
