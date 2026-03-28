/**
 * Shared types and interfaces for skill providers
 */

export type SearchMode = "keyword" | "ai";
export type ProviderId = "skillsmp" | "skillssh";

export interface Skill {
  id: string;
  name: string;
  author: string;
  description: string;
  stars: number;
  githubUrl?: string;
  skillUrl?: string;
  provider: ProviderId;
}

export interface SkillProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly requiresAuth: boolean;
  isAvailable(): boolean;
  search(query: string, mode: SearchMode): Promise<Skill[]>;
  install(skill: Skill): Promise<{ success: boolean; error?: string }>;
}

export interface SearchIntent {
  query: string;
  mode: SearchMode;
}

export interface SearchResult {
  skills: Skill[];
  sources: {
    skillsmp: number;
    skillssh: number;
  };
  mode: SearchMode;
}
