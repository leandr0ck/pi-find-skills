/**
 * Search aggregation and ranking logic
 *
 * Combines results from multiple providers, deduplicates, and sorts by popularity.
 */

import type { Skill, SkillProvider, SearchMode, SearchResult } from "./providers/types";

/**
 * Normalize query string
 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/^[:\-–—\s]+/, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

/**
 * Choose search mode based on query characteristics
 */
export function chooseSearchMode(query: string): SearchMode {
  // Always prefer keyword search - AI search has quality issues
  // AI search only for very descriptive, sentence-like queries
  const words = query.trim().split(/\s+/);
  if (words.length >= 4) return "ai";
  return "keyword";
}

/**
 * Strip accents from string
 */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Build search candidates from a query (variations to try)
 */
export function buildSearchCandidates(query: string): string[] {
  const normalized = normalizeQuery(query).toLowerCase();
  const ascii = stripAccents(normalized);
  const candidates: string[] = [];
  const add = (value: string) => {
    const candidate = normalizeQuery(value.toLowerCase());
    if (!candidate) return;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };

  add(normalized);

  const knownPhrases = [
    "react native",
    "react",
    "next.js",
    "nextjs",
    "cloudflare workers",
    "cloudflare pages",
    "cloudflare",
    "sveltekit",
    "svelte",
    "vue",
    "nuxt",
    "postgres",
    "postgresql",
    "neon",
    "tailwind",
    "typescript",
    "supabase",
    "graphql",
    "docker",
    "kubernetes",
  ];

  for (const phrase of knownPhrases) {
    if (ascii.includes(stripAccents(phrase))) add(phrase);
  }

  const stopwords = new Set([
    "build", "building", "develop", "developing", "applications", "application", "app", "apps", "with", "for", "using", "the", "a", "an", "and", "to", "in",
  ]);

  const tokens = ascii
    .split(/[^a-z0-9.+#-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopwords.has(token));

  if (tokens.length > 0) add(tokens.join(" "));
  if (tokens.length > 1) add(tokens.slice(0, 2).join(" "));
  if (tokens.length > 2) add(tokens.slice(0, 3).join(" "));

  return candidates;
}

/**
 * Get a comparable popularity score across providers.
 *
 * For SkillsMP this is the GitHub stars count.
 * For skills.sh we currently map installs into `stars`, so the same field can be
 * used as a single popularity metric for ordering.
 */
export function getSkillPopularity(skill: Skill): number {
  return skill.stars;
}

/**
 * Sort skills by popularity.
 */
export function rankSkills(skills: Skill[], _query: string): Skill[] {
  return [...skills].sort((a, b) => {
    const popularityDiff = getSkillPopularity(b) - getSkillPopularity(a);
    if (popularityDiff !== 0) return popularityDiff;

    return a.name.localeCompare(b.name);
  });
}

/**
 * Deduplicate skills by name (case-insensitive)
 * When duplicates exist, keep the one with more stars or more metadata
 */
export function deduplicateSkills(skills: Skill[]): Skill[] {
  const seen = new Map<string, Skill>();
  
  for (const skill of skills) {
    const key = skill.name.toLowerCase().trim();
    const existing = seen.get(key);
    
    if (!existing) {
      seen.set(key, skill);
    } else {
      // Keep the one with more stars or more complete metadata
      const existingScore = existing.stars + (existing.githubUrl ? 10 : 0) + (existing.description.length > 50 ? 5 : 0);
      const newScore = skill.stars + (skill.githubUrl ? 10 : 0) + (skill.description.length > 50 ? 5 : 0);
      
      if (newScore > existingScore) {
        seen.set(key, skill);
      }
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Search all available providers in parallel
 */
export async function searchAllProviders(
  query: string,
  mode: SearchMode,
  providers: SkillProvider[],
): Promise<SearchResult> {
  const candidates = buildSearchCandidates(query);
  const availableProviders = providers.filter(p => p.isAvailable());
  
  // Run all providers in parallel for each candidate
  const results = await Promise.allSettled(
    availableProviders.map(async (provider) => {
      // Try candidates in order until we get results
      for (const candidate of candidates) {
        try {
          const skills = await provider.search(candidate, mode);
          if (skills.length > 0) {
            return { provider: provider.id, skills };
          }
        } catch {
          // Try next candidate
        }
      }
      return { provider: provider.id, skills: [] };
    })
  );
  
  // Collect all skills with provider attribution
  const allSkills: Skill[] = [];
  const sources = { skillsmp: 0, skillssh: 0 };
  
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { provider, skills } = result.value;
      allSkills.push(...skills);
      sources[provider] = skills.length;
    }
  }
  
  // Deduplicate and rank
  const deduped = deduplicateSkills(allSkills);
  const ranked = rankSkills(deduped, query);
  
  return {
    skills: ranked,
    sources,
    mode,
  };
}

/**
 * Detect search intent from natural language
 */
export function detectSearchIntent(text: string): { query: string; mode: SearchMode } | null {
  const input = text.trim();
  if (!input) return null;

  const patterns = [
    // English
    /^(?:find|search|look\s+for|discover)\s+(?:skills?)\s+(?:for|about)\s+(.+)$/i,
    /^(?:skills?)\s+(?:for|about)\s+(.+)$/i,

    // Spanish
    /^(?:buscar|busca|encontrar|encuentra|descubrir|descubre)\s+(?:skills?|habilidades?)\s+(?:para|sobre|de)\s+(.+)$/i,
    /^(?:skills?|habilidades?)\s+(?:para|sobre|de)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    const query = normalizeQuery(match?.[1] ?? "");
    if (query) {
      return {
        query,
        mode: chooseSearchMode(query),
      };
    }
  }

  return null;
}
