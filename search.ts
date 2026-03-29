/**
 * Search aggregation and ranking logic
 *
 * Combines results from multiple providers, deduplicates, and sorts by popularity.
 */

import type { Skill, SkillProvider, SearchMode, SearchResult } from "./providers/types";
import { enrichSkillDescriptions } from "./providers/skillssh.js";

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
const KNOWN_TECHNOLOGY_TERMS = [
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
  "mysql",
  "sqlite",
  "sql",
  "sql server",
  "oracle",
  "tauri",
  "neon",
  "tailwind",
  "typescript",
  "javascript",
  "node",
  "nodejs",
  "deno",
  "bun",
  "python",
  "django",
  "flask",
  "fastapi",
  "ruby",
  "rails",
  "php",
  "laravel",
  "java",
  "spring",
  "kotlin",
  "swift",
  "rust",
  "go",
  "golang",
  "c#",
  "c++",
  "dotnet",
  ".net",
  "ios",
  "android",
  "supabase",
  "graphql",
  "docker",
  "kubernetes",
  "terraform",
  "aws",
  "gcp",
  "azure",
  "redis",
  "mongodb",
  "prisma",
  "drizzle",
  "sqlalchemy",
];

const KNOWN_TECHNOLOGY_TOKEN_SET = new Set(
  KNOWN_TECHNOLOGY_TERMS.flatMap((term) => term.split(/\s+/)).map((term) => stripAccents(term.replace(/[^a-z0-9+#.-]+/gi, "").toLowerCase())).filter(Boolean),
);

function tokenize(value: string): string[] {
  return stripAccents(normalizeQuery(value).toLowerCase())
    .split(/[^a-z0-9.+#-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function extractTechnologyTerms(value: string): Set<string> {
  const normalized = stripAccents(normalizeQuery(value).toLowerCase());
  const found = new Set<string>();

  for (const phrase of KNOWN_TECHNOLOGY_TERMS) {
    if (normalized.includes(stripAccents(phrase))) {
      found.add(phrase);
    }
  }

  for (const token of tokenize(value)) {
    if (KNOWN_TECHNOLOGY_TOKEN_SET.has(token)) {
      found.add(token);
    }
  }

  return found;
}

function isGenericSearchQuery(query: string): boolean {
  return extractTechnologyTerms(query).size === 0;
}

function filterSpecializedResultsForGenericQuery(skills: Skill[], query: string): Skill[] {
  if (skills.length === 0 || !isGenericSearchQuery(query)) return skills;

  const queryTechTerms = extractTechnologyTerms(query);
  const genericMatches = skills.filter((skill) => {
    const skillTechTerms = extractTechnologyTerms(`${skill.name} ${skill.description}`);
    for (const term of skillTechTerms) {
      if (!queryTechTerms.has(term)) {
        return false;
      }
    }
    return true;
  });

  return genericMatches.length > 0 ? genericMatches : skills;
}

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
    ...KNOWN_TECHNOLOGY_TERMS,
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

  // Also try singular forms (e.g. "code reviews" → "code review")
  const singularTokens = tokens.map((t) => {
    if (t.endsWith("ies") && t.length > 4) return t.slice(0, -3) + "y";
    if (t.endsWith("es") && t.length > 4) return t.slice(0, -2);
    if (t.endsWith("s") && t.length > 3) return t.slice(0, -1);
    return t;
  });
  const singularQuery = singularTokens.join(" ");
  if (singularQuery !== tokens.join(" ")) add(singularQuery);

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
  
  // Run all providers in parallel, aggregating results from all candidates.
  // This is important because different inflections can return very different
  // quality results (e.g. "code reviews" vs "code review").
  const results = await Promise.allSettled(
    availableProviders.map(async (provider) => {
      // Run all candidates in parallel — each involves a CLI process + HTTP
      // enrichment, so sequential execution multiplies latency by N candidates.
      const candidateResults = await Promise.allSettled(
        candidates.map((candidate) => provider.search(candidate, mode)),
      );

      const providerSkills: Skill[] = [];
      for (const result of candidateResults) {
        if (result.status === "fulfilled" && result.value.length > 0) {
          providerSkills.push(...result.value);
        }
      }

      return {
        provider: provider.id,
        skills: deduplicateSkills(providerSkills),
      };
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
  
  // Deduplicate, rank, and filter to the relevant set before enriching
  // descriptions — so HTTP fetches only run on skills that will actually
  // be shown to the user, not on every candidate's full result set.
  const deduped = deduplicateSkills(allSkills);
  const ranked = rankSkills(deduped, query);
  const filtered = filterSpecializedResultsForGenericQuery(ranked, query);
  const enriched = await enrichSkillDescriptions(filtered);

  return {
    skills: enriched,
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
    // English — "find/search/discover (a/some) skill(s) for/about/to do/to/that X"
    /^(?:find|search|look\s+for|discover)\s+(?:me\s+)?(?:a\s+|some\s+)?(?:skills?)\s+(?:for|about|to\s+do|to|that)\s+(.+)$/i,
    // "skills for/about/to X"
    /^(?:skills?)\s+(?:for|about|to\s+do|to)\s+(.+)$/i,
    // "I need/want (a) skill for/to/to do X"
    /^(?:i\s+)?(?:need|want|am\s+looking\s+for|looking\s+for)\s+(?:a\s+|some\s+)?(?:skills?)\s+(?:for|about|to\s+do|to|that)\s+(.+)$/i,
    // "find me a skill to do X" / "give me a skill for X"
    /^(?:find|give|show)\s+me\s+(?:a\s+|some\s+)?(?:skills?)\s+(?:for|about|to\s+do|to|that)\s+(.+)$/i,
    // "is there a skill for X" / "any skill for X"
    /^(?:is\s+there\s+(?:a\s+)?|any\s+)(?:skills?)\s+(?:for|about|to\s+do|to|that)\s+(.+)$/i,

    // Spanish — "buscar/encontrar/descubrir (un) skill/habilidad para/sobre/de/que X"
    /^(?:buscar|busca|encontrar|encuentra|descubrir|descubre)\s+(?:un\s+|una\s+|algunos?\s+)?(?:skills?|habilidades?)\s+(?:para|sobre|de|que)\s+(.+)$/i,
    /^(?:skills?|habilidades?)\s+(?:para|sobre|de)\s+(.+)$/i,
    // "necesito/quiero un skill para X"
    /^(?:necesito|quiero|busco)\s+(?:un\s+|una\s+)?(?:skill|habilidad)\s+(?:para|que|de|sobre)\s+(.+)$/i,
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
