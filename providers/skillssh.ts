/**
 * skills.sh Provider
 * 
 * Uses the skills.sh CLI via `npx skills find {query}`.
 * No authentication required.
 */

import type { Skill, SkillProvider, ProviderId, SearchMode } from "./types";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface SkillsShResult {
  id: string;
  name: string;
  author: string;
  description: string;
  stars?: number;
  githubUrl?: string;
}

/**
 * Parse the output from `npx skills find {query}`
 * The CLI returns JSON or text depending on flags
 */
function parseSkillsOutput(stdout: string): Skill[] {
  const skills: Skill[] = [];
  
  // Try JSON first (if --json flag is used)
  try {
    const json = JSON.parse(stdout);
    const items = Array.isArray(json) ? json : json.results || json.skills || [];
    for (const item of items) {
      if (item.id || item.name) {
        skills.push({
          id: item.id || item.name?.toLowerCase().replace(/\s+/g, "-"),
          name: item.name || item.id,
          author: item.author || item.owner || "unknown",
          description: item.description || item.summary || "",
          stars: item.stars || item.stargazers_count || 0,
          githubUrl: item.githubUrl || item.html_url || item.url,
          provider: "skillssh" as ProviderId,
        });
      }
    }
    return skills;
  } catch {
    // Not JSON, parse text output
  }
  
  // Parse text output - handle common formats
  // Format 1: numbered list with name and description
  // Format 2: table with columns
  const lines = stdout.split("\n").filter(line => line.trim());
  
  let currentSkill: Partial<Skill> | null = null;
  
  for (const line of lines) {
    // Skip headers and separators
    if (/^(#|─|═|\||\s*$)/.test(line)) continue;
    if (/^\s*(name|id|description|stars)/i.test(line)) continue;
    
    // Try numbered format: "1. skill-name - Description here"
    const numberedMatch = line.match(/^\s*(\d+)[.\)]\s*(.+?)\s*[-–—]\s*(.+)$/);
    if (numberedMatch) {
      if (currentSkill && currentSkill.id) {
        skills.push({
          id: currentSkill.id,
          name: currentSkill.name || currentSkill.id,
          author: currentSkill.author || "unknown",
          description: currentSkill.description || "",
          stars: currentSkill.stars || 0,
          githubUrl: currentSkill.githubUrl,
          provider: "skillssh" as ProviderId,
        });
      }
      currentSkill = {
        id: numberedMatch[2].trim().toLowerCase().replace(/\s+/g, "-"),
        name: numberedMatch[2].trim(),
        description: numberedMatch[3].trim(),
      };
      continue;
    }
    
    // Try bullet format: "- skill-name: Description"
    const bulletMatch = line.match(/^\s*[-•]\s*(.+?)\s*:\s*(.+)$/);
    if (bulletMatch) {
      if (currentSkill && currentSkill.id) {
        skills.push({
          id: currentSkill.id,
          name: currentSkill.name || currentSkill.id,
          author: currentSkill.author || "unknown",
          description: currentSkill.description || "",
          stars: currentSkill.stars || 0,
          githubUrl: currentSkill.githubUrl,
          provider: "skillssh" as ProviderId,
        });
      }
      currentSkill = {
        id: bulletMatch[1].trim().toLowerCase().replace(/\s+/g, "-"),
        name: bulletMatch[1].trim(),
        description: bulletMatch[2].trim(),
      };
      continue;
    }
    
    // Accumulate description for current skill
    if (currentSkill && line.trim() && !/^\s*(Install|Usage|More)/i.test(line)) {
      currentSkill.description = (currentSkill.description || "") + " " + line.trim();
    }
  }
  
  // Don't forget the last skill
  if (currentSkill && currentSkill.id) {
    skills.push({
      id: currentSkill.id,
      name: currentSkill.name || currentSkill.id,
      author: currentSkill.author || "unknown",
      description: currentSkill.description || "",
      stars: currentSkill.stars || 0,
      githubUrl: currentSkill.githubUrl,
      provider: "skillssh" as ProviderId,
    });
  }
  
  return skills;
}

export const skillsshProvider: SkillProvider = {
  id: "skillssh",
  name: "skills.sh",
  requiresAuth: false,

  isAvailable(): boolean {
    // skills.sh CLI doesn't require auth, always available
    return true;
  },

  async search(query: string, _mode: SearchMode): Promise<Skill[]> {
    try {
      // Use --json for structured output if available, otherwise fall back to text
      const { stdout } = await execAsync(`npx skills find "${query.replace(/"/g, '\\"')}" --json 2>/dev/null || npx skills find "${query.replace(/"/g, '\\"')}"`, {
        timeout: 15000,
        maxBuffer: 1024 * 1024, // 1MB buffer
      });
      
      const skills = parseSkillsOutput(stdout);
      return skills;
    } catch (error) {
      // If the command fails, try without --json
      try {
        const { stdout } = await execAsync(`npx skills find "${query.replace(/"/g, '\\"')}"`, {
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        return parseSkillsOutput(stdout);
      } catch {
        // Provider unavailable or no results
        return [];
      }
    }
  },

  async install(skill: Skill | string): Promise<{ success: boolean; error?: string }> {
    try {
      const { execFileSync } = await import("node:child_process");
      const skillId = typeof skill === "string" ? skill : skill.id;

      execFileSync("npx", ["skills", "add", skillId, "-g", "-y"], {
        stdio: "pipe",
        timeout: 60000,
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  },
};
