/**
 * Slash command handlers
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Skill, SkillProvider, SearchMode } from "./providers/types";
import { searchAllProviders, normalizeQuery, detectLanguage, buildRecommendation } from "./search";
import { showInteractiveSkillPicker, SearchResultsMessageDetails } from "./ui";

interface CommandContext {
  providers: SkillProvider[];
  sendMessage: (message: { customType: string; content: string; display: boolean; details?: unknown }) => void;
}

/**
 * Run search command (shared by /skills search and /skills ai)
 */
export async function runSearchCommand(
  args: string,
  preferredMode: SearchMode,
  ctx: ExtensionContext,
  cmdCtx: CommandContext
): Promise<void> {
  const query = normalizeQuery(args);
  if (!query) {
    ctx.ui.notify(
      preferredMode === "ai" ? "Usage: /skills ai <query>" : "Usage: /skills search <query>",
      "error"
    );
    return;
  }

  const availableProviders = cmdCtx.providers.filter(p => p.isAvailable());
  if (availableProviders.length === 0) {
    ctx.ui.notify("No skill providers available. Set SKILLSMP_API_KEY for SkillsMP.", "error");
    return;
  }

  ctx.ui.setStatus("skills", preferredMode === "ai" ? "AI searching skills..." : "Searching skills...");

  try {
    const result = await searchAllProviders(query, preferredMode, cmdCtx.providers, "en");
    ctx.ui.setStatus("skills", undefined);

    if (result.skills.length === 0) {
      ctx.ui.notify(`No skills found for "${query}"`, "info");
      return;
    }

    const picked = await showInteractiveSkillPicker(ctx, query, result.mode, "en", result.skills, result.sources);
    if (!picked) return;

    // Find the right provider for installation
    const provider = cmdCtx.providers.find(p => p.id === picked.provider);
    if (!provider) {
      ctx.ui.notify(`Provider ${picked.provider} not found`, "error");
      return;
    }

    ctx.ui.setStatus("skills", `Installing ${picked.name}...`);
    const installResult = await provider.install(picked);
    ctx.ui.setStatus("skills", undefined);

    if (installResult.success) {
      ctx.ui.notify(`✓ Installed ${picked.name}`, "success");
    } else {
      ctx.ui.notify(`Failed to install: ${installResult.error}`, "error");
    }
  } catch (err) {
    ctx.ui.setStatus("skills", undefined);
    const message = err instanceof Error ? err.message : "Unknown error";
    ctx.ui.notify(`Error: ${message}`, "error");
  }
}

/**
 * Handle natural language input (from input event)
 */
export async function handleNaturalLanguageSearch(
  intent: { query: string; mode: SearchMode },
  ctx: ExtensionContext,
  cmdCtx: CommandContext,
  language: "es" | "en"
): Promise<{ action: "handled" | "continue" }> {
  const availableProviders = cmdCtx.providers.filter(p => p.isAvailable());
  if (availableProviders.length === 0) {
    ctx.ui.notify("No skill providers available. Set SKILLSMP_API_KEY for SkillsMP.", "error");
    return { action: "handled" };
  }

  ctx.ui.setStatus("skills", language === "es" ? "Buscando skills..." : "Searching skills...");

  try {
    const result = await searchAllProviders(intent.query, intent.mode, cmdCtx.providers, language);
    ctx.ui.setStatus("skills", undefined);

    if (result.skills.length === 0) {
      cmdCtx.sendMessage({
        customType: "skills-results",
        content: language === "es" ? "No se encontraron skills." : "No skills found.",
        display: true,
        details: {
          query: intent.query,
          mode: result.mode,
          language,
          skills: [],
          sources: result.sources,
          recommendation: language === "es"
            ? `Prueba con otra búsqueda más específica para ${JSON.stringify(intent.query)}.`
            : `Try a more specific search for ${JSON.stringify(intent.query)}.`,
        } as SearchResultsMessageDetails,
      });
      return { action: "handled" };
    }

    if (ctx.hasUI) {
      const picked = await showInteractiveSkillPicker(ctx, intent.query, result.mode, language, result.skills, result.sources);
      if (picked) {
        const provider = cmdCtx.providers.find(p => p.id === picked.provider);
        if (provider) {
          ctx.ui.setStatus("skills", language === "es" ? `Instalando ${picked.name}...` : `Installing ${picked.name}...`);
          const installResult = await provider.install(picked);
          ctx.ui.setStatus("skills", undefined);

          if (installResult.success) {
            ctx.ui.notify(
              language === "es" ? `✓ ${picked.name} instalada` : `✓ Installed ${picked.name}`,
              "success"
            );
          } else {
            ctx.ui.notify(
              language === "es" ? `No se pudo instalar: ${installResult.error}` : `Failed to install: ${installResult.error}`,
              "error"
            );
          }
        }
      }
      return { action: "handled" };
    }

    cmdCtx.sendMessage({
      customType: "skills-results",
      content: language === "es" ? "Resultados de búsqueda" : "Search results",
      display: true,
      details: {
        query: intent.query,
        mode: result.mode,
        language,
        skills: result.skills,
        sources: result.sources,
        recommendation: buildRecommendation(intent.query, result.skills, language),
      } as SearchResultsMessageDetails,
    });

    return { action: "handled" };
  } catch (err) {
    ctx.ui.setStatus("skills", undefined);
    const message = err instanceof Error ? err.message : "Unknown error";
    cmdCtx.sendMessage({
      customType: "skills-results",
      content: message,
      display: true,
      details: {
        query: intent.query,
        mode: intent.mode,
        language,
        skills: [],
        sources: { skillsmp: 0, skillssh: 0 },
        recommendation: "",
        error: language === "es" ? `Error buscando skills: ${message}` : `Error searching skills: ${message}`,
      } as SearchResultsMessageDetails,
    });
    return { action: "handled" };
  }
}

/**
 * Register slash commands
 */
export function registerCommands(
  pi: { registerCommand: (name: string, config: { description: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => void },
  cmdCtx: CommandContext
): void {
  pi.registerCommand("skills search", {
    description: "Search skills by keyword (all providers)",
    handler: async (args, ctx) => {
      await runSearchCommand(args, "keyword", ctx, cmdCtx);
    },
  });

  pi.registerCommand("skills ai", {
    description: "AI semantic search for skills (all providers)",
    handler: async (args, ctx) => {
      await runSearchCommand(args, "ai", ctx, cmdCtx);
    },
  });

  pi.registerCommand("skills install", {
    description: "Install a skill by ID",
    handler: async (args, ctx) => {
      const skillId = normalizeQuery(args);
      if (!skillId) {
        ctx.ui.notify("Usage: /skills install <skill-id>", "error");
        return;
      }

      // Try to find skill in any provider
      ctx.ui.setStatus("skills", "Installing...");
      
      // Try skills.sh first (no auth required), then SkillsMP
      let installResult = { success: false, error: "No provider available" };
      
      for (const provider of cmdCtx.providers) {
        if (provider.isAvailable()) {
          installResult = await provider.install(skillId);
          if (installResult.success) break;
        }
      }
      
      ctx.ui.setStatus("skills", undefined);

      if (installResult.success) {
        ctx.ui.notify("✓ Skill installed", "success");
      } else {
        ctx.ui.notify(`Failed to install: ${installResult.error}`, "error");
      }
    },
  });

  pi.registerCommand("skills", {
    description: "Skills marketplace - search and install agent skills from multiple providers",
    handler: async (_args, ctx) => {
      const commands = [
        "/skills search <query> - Search skills by keywords (all providers)",
        "/skills ai <query> - AI semantic search (all providers)",
        "/skills install <id> - Install a skill by ID",
        'Natural language: "buscar skills para React"',
        'Natural language: "search skills for Cloudflare deploy"',
        "",
        "Providers:",
        "  • SkillsMP (skillsmp.com) - requires SKILLSMP_API_KEY",
        "  • skills.sh (skills.sh) - no configuration required",
      ];

      const selected = await ctx.ui.select("Skills Commands", commands);
      if (selected) {
        ctx.ui.notify(`Try: ${selected}`, "info");
      }
    },
  });

  // Backward compatibility aliases
  pi.registerCommand("skillsmp search", {
    description: "[Legacy] Search SkillsMP marketplace for skills",
    handler: async (args, ctx) => {
      await runSearchCommand(args, "keyword", ctx, cmdCtx);
    },
  });

  pi.registerCommand("skillsmp ai", {
    description: "[Legacy] AI semantic search on SkillsMP",
    handler: async (args, ctx) => {
      await runSearchCommand(args, "ai", ctx, cmdCtx);
    },
  });

  pi.registerCommand("skillsmp install", {
    description: "[Legacy] Install a skill from SkillsMP by ID",
    handler: async (args, ctx) => {
      const skillId = normalizeQuery(args);
      if (!skillId) {
        ctx.ui.notify("Usage: /skillsmp install <skill-id>", "error");
        return;
      }

      ctx.ui.setStatus("skills", "Installing...");
      const provider = cmdCtx.providers.find(p => p.id === "skillsmp");
      const result = provider ? await provider.install(skillId) : { success: false, error: "Provider not available" };
      ctx.ui.setStatus("skills", undefined);

      if (result.success) {
        ctx.ui.notify("✓ Skill installed", "success");
      } else {
        ctx.ui.notify(`Failed to install: ${result.error}`, "error");
      }
    },
  });

  pi.registerCommand("skillsmp", {
    description: "[Legacy] SkillsMP marketplace commands",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Tip: Use /skills instead of /skillsmp for multi-provider search", "info");
      const commands = [
        "/skills search <query> - Search all providers",
        "/skills ai <query> - AI search all providers",
        "/skills install <id> - Install a skill",
      ];
      const selected = await ctx.ui.select("Skills Commands (use /skills)", commands);
      if (selected) {
        ctx.ui.notify(`Try: ${selected}`, "info");
      }
    },
  });
}
