import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchCandidates,
  detectSearchIntent,
  searchAllProviders,
} from "../search.ts";
import type { Skill, SkillProvider, SearchMode } from "../providers/types.ts";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "obra/superpowers@requesting-code-review",
    name: "requesting-code-review",
    author: "obra/superpowers",
    description: "Ask for a high-quality code review.",
    stars: 34_800,
    skillUrl: "https://skills.sh/obra/superpowers/requesting-code-review",
    provider: "skillssh",
    ...overrides,
  };
}

function makeProvider(searchImpl: (query: string, mode: SearchMode) => Promise<Skill[]> | Skill[]): SkillProvider {
  return {
    id: "skillssh",
    name: "skills.sh",
    requiresAuth: false,
    isAvailable: () => true,
    search: async (query, mode) => searchImpl(query, mode),
    install: async () => ({ success: true }),
  };
}

test("buildSearchCandidates keeps singular query stable", () => {
  assert.deepEqual(buildSearchCandidates("code review"), ["code review"]);
});

test("natural language query for Code Reviews includes singular fallback", () => {
  const intent = detectSearchIntent("find a skill to do Code Reviews");

  assert.ok(intent);
  assert.equal(intent?.query, "Code Reviews");
  assert.equal(intent?.mode, "keyword");
  assert.deepEqual(buildSearchCandidates(intent!.query), ["code reviews", "code review"]);
});

test("searchAllProviders falls back from plural to singular for natural language Code Reviews", async () => {
  const calls: string[] = [];
  const expected = makeSkill();

  const provider = makeProvider(async (query) => {
    calls.push(query);
    if (query === "code review") return [expected];
    return [];
  });

  const result = await searchAllProviders("Code Reviews", "keyword", [provider]);

  assert.deepEqual(calls, ["code reviews", "code review"]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0]?.id, expected.id);
  assert.equal(result.sources.skillssh, 1);
});

test("searchAllProviders ranks singular code review result above weaker plural matches", async () => {
  const calls: string[] = [];
  const expected = makeSkill();
  const weakerPlural = makeSkill({
    id: "anthropics/knowledge-work-plugins@code-review",
    name: "code-review",
    author: "anthropics/knowledge-work-plugins",
    description: "A weaker plural-only match.",
    stars: 831,
    skillUrl: "https://skills.sh/anthropics/knowledge-work-plugins/code-review",
  });

  const provider = makeProvider(async (query) => {
    calls.push(query);
    if (query === "code reviews") return [weakerPlural];
    if (query === "code review") return [expected];
    return [];
  });

  const result = await searchAllProviders("Code Reviews", "keyword", [provider]);

  assert.deepEqual(calls, ["code reviews", "code review"]);
  assert.equal(result.skills.length, 2);
  assert.equal(result.skills[0]?.id, expected.id);
  assert.equal(result.skills[1]?.id, weakerPlural.id);
  assert.equal(result.sources.skillssh, 2);
});

test("searchAllProviders finds direct code review query without extra fallback", async () => {
  const calls: string[] = [];
  const expected = makeSkill();

  const provider = makeProvider(async (query) => {
    calls.push(query);
    if (query === "code review") return [expected];
    return [];
  });

  const result = await searchAllProviders("code review", "keyword", [provider]);

  assert.deepEqual(calls, ["code review"]);
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0]?.id, expected.id);
  assert.equal(result.sources.skillssh, 1);
});

test("searchAllProviders filters out specialized SQL/Tauri skills for a generic code review query", async () => {
  const generic = makeSkill();
  const sqlSpecific = makeSkill({
    id: "github/awesome-copilot@sql-code-review",
    name: "sql-code-review",
    author: "github/awesome-copilot",
    description: "Comprehensive SQL security, performance, and quality analysis.",
    stars: 8_000,
    skillUrl: "https://skills.sh/github/awesome-copilot/sql-code-review",
  });
  const tauriSpecific = makeSkill({
    id: "acme/skills@tauri-code-review",
    name: "tauri-code-review",
    author: "acme/skills",
    description: "Review Tauri desktop app code and Rust bridge integration.",
    stars: 7_500,
    skillUrl: "https://skills.sh/acme/skills/tauri-code-review",
  });

  const provider = makeProvider(async (query) => {
    if (query === "code review") return [generic, sqlSpecific, tauriSpecific];
    return [];
  });

  const result = await searchAllProviders("code review", "keyword", [provider]);

  assert.deepEqual(
    result.skills.map((skill) => skill.id),
    [generic.id],
  );
  assert.equal(result.sources.skillssh, 3);
});

test("searchAllProviders keeps specialized results when a generic query has no generic matches", async () => {
  const sqlSpecific = makeSkill({
    id: "github/awesome-copilot@sql-code-review",
    name: "sql-code-review",
    author: "github/awesome-copilot",
    description: "Comprehensive SQL security, performance, and quality analysis.",
    stars: 8_000,
    skillUrl: "https://skills.sh/github/awesome-copilot/sql-code-review",
  });

  const provider = makeProvider(async (query) => {
    if (query === "code review") return [sqlSpecific];
    return [];
  });

  const result = await searchAllProviders("code review", "keyword", [provider]);

  assert.deepEqual(
    result.skills.map((skill) => skill.id),
    [sqlSpecific.id],
  );
});

test(
  "LIVE: skills.sh returns obra/superpowers@requesting-code-review for direct code review",
  {
    skip: process.env.LIVE_SKILLS_TEST !== "1",
  },
  async () => {
    const { skillsshProvider } = await import("../providers/skillssh.ts");
    const results = await skillsshProvider.search("code review", "keyword");

    assert.ok(results.length > 0, "expected at least one result from skills.sh");
    assert.ok(
      results.some((skill) => skill.id === "obra/superpowers@requesting-code-review"),
      "expected obra/superpowers@requesting-code-review to be present in live skills.sh results",
    );
  },
);

test(
  "LIVE: natural language Code Reviews path ranks obra/superpowers@requesting-code-review first",
  {
    skip: process.env.LIVE_SKILLS_TEST !== "1",
  },
  async () => {
    const { skillsshProvider } = await import("../providers/skillssh.ts");
    const results = await searchAllProviders("Code Reviews", "keyword", [skillsshProvider]);

    assert.ok(results.skills.length > 0, "expected at least one aggregated result");
    assert.equal(
      results.skills[0]?.id,
      "obra/superpowers@requesting-code-review",
      "expected obra/superpowers@requesting-code-review to be ranked first for Code Reviews",
    );
  },
);
