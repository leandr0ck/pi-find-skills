/**
 * Search aggregation and ranking logic
 * 
 * Combines results from multiple providers, deduplicates, and re-ranks.
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
export function buildSearchCandidates(query: string, language: "es" | "en"): string[] {
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

  const stopwords = new Set(
    language === "es"
      ? [
          "desarrollar", "desarrollo", "aplicaciones", "aplicacion", "crear", "hacer", "con", "para", "de", "del", "la", "el", "los", "las", "una", "un", "y", "en", "usar", "que",
        ]
      : [
          "build", "building", "develop", "developing", "applications", "application", "app", "apps", "with", "for", "using", "the", "a", "an", "and", "to", "in",
        ],
  );

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
 * Score skill relevance to query
 */
export function scoreSkillRelevance(skill: Skill, query: string): number {
  const normalizedQuery = query.toLowerCase().trim();
  const skillName = skill.name.toLowerCase();
  const skillDesc = skill.description.toLowerCase();
  
  // Exact name match - highest priority
  if (skillName === normalizedQuery) return 1000000 + skill.stars;
  
  // Name starts with query - high priority
  if (skillName.startsWith(normalizedQuery)) return 500000 + skill.stars;
  
  // Name contains query - good priority
  if (skillName.includes(normalizedQuery)) return 100000 + skill.stars;
  
  // Description contains query as a word (not just substring)
  const queryWords = normalizedQuery.split(/\s+/);
  const descWords = new Set(skillDesc.split(/\s+/));
  const matchingWords = queryWords.filter(w => descWords.has(w) || 
    Array.from(descWords).some(dw => dw.startsWith(w))
  ).length;
  
  // Partial match in description - lower priority, still factor in stars
  if (matchingWords > 0) {
    return (matchingWords * 1000) + skill.stars;
  }
  
  // Fallback: just use stars
  return skill.stars;
}

/**
 * Rank skills by relevance
 */
export function rankSkills(skills: Skill[], query: string): Skill[] {
  return [...skills]
    .map(skill => ({ skill, score: scoreSkillRelevance(skill, query) }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.skill);
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
  language: "es" | "en" = "en",
): Promise<SearchResult> {
  const candidates = buildSearchCandidates(query, language);
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
 * Build recommendation text based on top result
 */
export function buildRecommendation(query: string, skills: Skill[], language: "es" | "en"): string {
  const top = skills[0];
  if (!top) {
    return language === "es"
      ? `No encontré una recomendación clara para ${JSON.stringify(query)}.`
      : `I couldn't find a clear recommendation for ${JSON.stringify(query)}.`;
  }

  const sourceLabel = top.provider === "skillsmp" ? "SkillsMP" : "skills.sh";
  const why = top.name.toLowerCase().includes(query.toLowerCase())
    ? language === "es"
      ? "porque coincide directamente con la búsqueda"
      : "because it directly matches your search"
    : top.stars > 0
      ? language === "es"
        ? `porque además tiene ${top.stars.toLocaleString()} stars`
        : `because it also has ${top.stars.toLocaleString()} stars`
      : language === "es"
        ? "porque parece el resultado más cercano"
        : "because it looks like the closest match";

  return language === "es"
    ? `Recomendación: empieza con ${top.name} (${sourceLabel}) — ${why}. Instálala con /skills install ${top.id}`
    : `Recommendation: start with ${top.name} (${sourceLabel}) — ${why}. Install it with /skills install ${top.id}`;
}

/**
 * Detect language from input text
 */
export function detectLanguage(text: string): "es" | "en" {
  return /\b(buscar|busca|habilidades|para|hacer|desplegar|encuentra|muestrame|muéstrame|desarrollar|aplicaciones)\b/i.test(text)
    ? "es"
    : "en";
}

/**
 * Detect search intent from natural language
 */
export function detectSearchIntent(text: string): { query: string; mode: SearchMode } | null {
  const input = text.trim();
  if (!input) return null;

  const patterns = [
    /^(?:buscar|busca|búscame|buscame|encontrar|encuentra|mostrar|muéstrame|muestrame)\s+(?:skills?|habilidades?)\s+(?:para|de|sobre)\s+(.+)$/i,
    /^(?:find|search|look\s+for|discover)\s+(?:skills?)\s+(?:for|about)\s+(.+)$/i,
    /^(?:skills?|habilidades?)\s+(?:para|for|de|about)\s+(.+)$/i,
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
