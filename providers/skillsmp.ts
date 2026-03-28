/**
 * SkillsMP Provider
 * 
 * Uses SkillsMP REST API with API key authentication.
 * Supports both keyword and AI semantic search.
 */

import type { Skill, SkillProvider, ProviderId, SearchMode } from "./types";
import https from "node:https";

const API_BASE = "skillsmp.com";

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

function hasApiKey(): boolean {
  return !!process.env.SKILLSMP_API_KEY;
}

async function apiRequest(endpoint: string, params: Record<string, string | number | undefined>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const querystring = new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)])
    ).toString();

    const path = `/api/v1/${endpoint}${querystring ? `?${querystring}` : ""}`;

    const options = {
      hostname: API_BASE,
      path,
      method: "GET",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: "application/json",
        "User-Agent": "pi-skills-extension/2.0",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            const errorMsg = json.error?.message || json.error?.code || `HTTP ${res.statusCode}`;
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

async function searchSkills(query: string, limit = 10): Promise<Skill[]> {
  const response = (await apiRequest("skills/search", { q: query, limit: Math.min(limit * 2, 20) })) as {
    data?: { skills?: Array<Omit<Skill, "provider">> };
  };
  const rawSkills = response.data?.skills || [];
  return rawSkills.map(skill => ({ ...skill, provider: "skillsmp" as ProviderId }));
}

async function aiSearchSkills(query: string): Promise<Skill[]> {
  const response = (await apiRequest("skills/ai-search", { q: query })) as {
    data?: { data?: Array<{ skill?: Omit<Skill, "provider"> }> };
  };
  const results = response.data?.data || [];
  return results
    .map((result) => result.skill)
    .filter((skill): skill is Omit<Skill, "provider"> => !!skill?.id)
    .map(skill => ({ ...skill, provider: "skillsmp" as ProviderId }));
}

async function getSkillById(skillId: string): Promise<Skill | null> {
  try {
    const response = (await apiRequest(`skills/${skillId}`, {})) as {
      data?: { skill?: Omit<Skill, "provider"> };
    };
    const skill = response.data?.skill;
    return skill ? { ...skill, provider: "skillsmp" } : null;
  } catch {
    return null;
  }
}

function extractGithubSource(skill: Skill): string | null {
  if (!skill.githubUrl) return null;
  const match = skill.githubUrl.match(/github\.com\/([^/]+\/[^/\.\s]+)/);
  return match ? match[1] : null;
}

export const skillsmpProvider: SkillProvider = {
  id: "skillsmp",
  name: "SkillsMP",
  requiresAuth: true,

  isAvailable(): boolean {
    return hasApiKey();
  },

  async search(query: string, mode: SearchMode): Promise<Skill[]> {
    if (mode === "ai") {
      return aiSearchSkills(query);
    }
    return searchSkills(query);
  },

  async install(skillOrId: Skill | string): Promise<{ success: boolean; error?: string }> {
    try {
      const { execFileSync } = await import("node:child_process");

      let skill: Skill | null = null;
      if (typeof skillOrId === "string") {
        skill = await getSkillById(skillOrId);
      } else {
        skill = skillOrId;
      }

      const source = skill ? extractGithubSource(skill) : null;
      const installId = source ?? (typeof skillOrId === "string" ? skillOrId : skillOrId.id);

      execFileSync("npx", ["skills", "add", installId, "-g", "-y"], {
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

export { hasApiKey, getApiKey };
