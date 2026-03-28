/**
 * skills.sh Provider
 * 
 * Uses the skills.sh CLI via `npx skills find {query}`.
 * No authentication required.
 */

import type { Skill, SkillProvider, ProviderId, SearchMode } from "./types";
import { exec } from "node:child_process";
import { get as httpsGet } from "node:https";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface SkillsShResult {
  id?: string;
  name?: string;
  author?: string;
  owner?: string;
  description?: string;
  summary?: string;
  stars?: number;
  stargazers_count?: number;
  githubUrl?: string;
  html_url?: string;
  url?: string;
  skillUrl?: string;
  installs?: number | string;
  installCount?: number | string;
  repo?: string;
}

const ANSI_ESCAPE_REGEX = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;
const descriptionCache = new Map<string, Promise<string | null>>();

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripHtml(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSkillUrl(identifier: string): string | undefined {
  const [repo, skillName] = identifier.split("@");
  if (!repo || !skillName) return undefined;
  return `https://skills.sh/${repo.trim()}/${skillName.trim()}`;
}

function hasPlaceholderDescription(description: string): boolean {
  const normalized = description.trim().toLowerCase();
  return !normalized || normalized.startsWith("skills.sh skill from ");
}

function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      {
        headers: {
          "user-agent": "pi-find-skills/1.0",
          accept: "text/html,application/xhtml+xml",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          res.resume();
          resolve(fetchText(new URL(location, url).toString(), timeoutMs));
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(body));
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("Request timed out"));
    });
    req.on("error", reject);
  });
}

function extractDescriptionFromHtml(html: string): string | null {
  const paragraphs = Array.from(html.matchAll(/<p>([\s\S]*?)<\/p>/gi))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean);

  const description = paragraphs.find((paragraph) => {
    const normalized = paragraph.toLowerCase();
    return (
      paragraph.length >= 24 &&
      !normalized.includes("discover and install skills for ai agents") &&
      !/^install the\s+.+\s+skill\s+for\s+/i.test(paragraph)
    );
  });

  return description || null;
}

async function fetchSkillDescription(skill: Skill): Promise<string | null> {
  const skillUrl = skill.skillUrl || buildSkillUrl(skill.id);
  if (!skillUrl) return null;

  const cached = descriptionCache.get(skillUrl);
  if (cached) return cached;

  const request = fetchText(skillUrl)
    .then((html) => extractDescriptionFromHtml(html))
    .catch(() => null);

  descriptionCache.set(skillUrl, request);
  return request;
}

async function enrichSkillDescriptions(skills: Skill[]): Promise<Skill[]> {
  const pending = skills.filter((skill) => hasPlaceholderDescription(skill.description));
  if (pending.length === 0) return skills;

  const workers = Array.from({ length: Math.min(4, pending.length) }, async (_unused, workerIndex) => {
    for (let index = workerIndex; index < pending.length; index += 4) {
      const skill = pending[index];
      if (!skill) continue;
      const description = await fetchSkillDescription(skill);
      if (description) {
        skill.description = description;
      }
    }
  });

  await Promise.all(workers);
  return skills;
}

function parseCompactNumber(value: string): number {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!match) return Number.parseInt(normalized.replace(/[^\d]/g, ""), 10) || 0;

  const amount = Number.parseFloat(match[1]);
  const suffix = match[2];
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(amount * multiplier);
}

function buildSkillFromIdentifier(identifier: string, installs = 0, skillUrl?: string): Skill {
  const [repo = identifier, rawName = identifier] = identifier.split("@");
  const name = rawName.trim() || identifier;
  const author = repo.trim() || "unknown";

  return {
    id: identifier.trim(),
    name,
    author,
    description: `skills.sh skill from ${author}`,
    stars: installs,
    githubUrl: author.includes("/") ? `https://github.com/${author}` : undefined,
    skillUrl: skillUrl || buildSkillUrl(identifier),
    provider: "skillssh" as ProviderId,
  };
}

/**
 * Parse the output from `npx skills find {query}`.
 * The current CLI may return either JSON or ANSI-colored text.
 */
function parseSkillsOutput(stdout: string): Skill[] {
  const cleaned = stripAnsi(stdout);
  const skills: Skill[] = [];

  // Try JSON first (if the CLI supports it)
  try {
    const json = JSON.parse(cleaned);
    const items = Array.isArray(json) ? json : json.results || json.skills || [];
    for (const item of items as SkillsShResult[]) {
      const identifier = item.id || item.name;
      if (!identifier) continue;

      const installs = typeof item.installs === "string"
        ? parseCompactNumber(item.installs)
        : typeof item.installCount === "string"
          ? parseCompactNumber(item.installCount)
          : Number(item.installs ?? item.installCount ?? item.stars ?? item.stargazers_count ?? 0);

      const skill = buildSkillFromIdentifier(identifier, installs, item.skillUrl || item.url);
      skill.name = item.name || skill.name;
      skill.author = item.author || item.owner || item.repo || skill.author;
      skill.description = item.description || item.summary || skill.description;
      skill.githubUrl = item.githubUrl || item.html_url || skill.githubUrl;
      skills.push(skill);
    }
    return skills;
  } catch {
    // Fall through to text parsing
  }

  const lines = cleaned.split("\n").map(line => line.trim()).filter(Boolean);
  let pendingSkill: Skill | null = null;

  for (const line of lines) {
    if (/^(Install with|No skills found for )/i.test(line)) continue;
    if (/^[█╔╗╚╝═║]+$/.test(line)) continue;

    const urlMatch = line.match(/^(?:└\s*)?(https?:\/\/\S+)$/);
    if (urlMatch && pendingSkill) {
      pendingSkill.skillUrl = urlMatch[1];
      skills.push(pendingSkill);
      pendingSkill = null;
      continue;
    }

    const resultMatch = line.match(/^([^\s]+@[^\s]+)\s+([\d.]+[KMB]?)\s+installs?$/i);
    if (resultMatch) {
      if (pendingSkill) {
        skills.push(pendingSkill);
      }
      pendingSkill = buildSkillFromIdentifier(resultMatch[1], parseCompactNumber(resultMatch[2]));
      continue;
    }

    // Older/fallback formats
    const numberedMatch = line.match(/^\s*(\d+)[.\)]\s*(.+?)\s*[-–—]\s*(.+)$/);
    if (numberedMatch) {
      if (pendingSkill) skills.push(pendingSkill);
      pendingSkill = buildSkillFromIdentifier(numberedMatch[2].trim());
      pendingSkill.description = numberedMatch[3].trim() || pendingSkill.description;
      continue;
    }

    const bulletMatch = line.match(/^\s*[-•]\s*(.+?)\s*:\s*(.+)$/);
    if (bulletMatch) {
      if (pendingSkill) skills.push(pendingSkill);
      pendingSkill = buildSkillFromIdentifier(bulletMatch[1].trim());
      pendingSkill.description = bulletMatch[2].trim() || pendingSkill.description;
      continue;
    }

    if (pendingSkill && !/^\s*(Usage|More)\b/i.test(line)) {
      pendingSkill.description = `${pendingSkill.description} ${line}`.trim();
    }
  }

  if (pendingSkill) {
    skills.push(pendingSkill);
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
    const escapedQuery = query.replace(/"/g, '\\"');

    try {
      // The plain CLI output currently returns the most complete search results.
      const { stdout } = await execAsync(`npx -y skills find "${escapedQuery}"`, {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });

      const skills = await enrichSkillDescriptions(parseSkillsOutput(stdout));
      if (skills.length > 0) return skills;
    } catch {
      // Fall through to the JSON attempt below.
    }

    try {
      const { stdout } = await execAsync(`npx -y skills find "${escapedQuery}" --json`, {
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      return enrichSkillDescriptions(parseSkillsOutput(stdout));
    } catch {
      // Provider unavailable or no results
      return [];
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
