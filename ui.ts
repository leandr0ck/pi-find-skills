/**
 * UI components for skill display
 * 
 * Interactive picker, table rendering, and message formatting.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text, matchesKey, Key, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Skill, SearchMode } from "./providers/types";
import { buildRecommendation } from "./search";

export interface SearchResultsMessageDetails {
  query: string;
  mode: SearchMode;
  language: "es" | "en";
  skills: Skill[];
  recommendation: string;
  error?: string;
  sources?: {
    skillsmp: number;
    skillssh: number;
  };
}

/**
 * Pad string to width
 */
function padRight(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

/**
 * Truncate cell to width with ellipsis
 */
function truncateCell(value: string, width: number): string {
  if (width <= 1) return value.slice(0, width);
  if (value.length <= width) return value;
  return `${value.slice(0, width - 1)}…`;
}

/**
 * Format a table row
 */
function formatTableRow(columns: string[], widths: number[]): string {
  return columns.map((column, index) => padRight(truncateCell(column, widths[index] || column.length), widths[index] || column.length)).join("  ");
}

/**
 * Get provider badge/label
 */
function getProviderBadge(provider: Skill["provider"]): string {
  return provider === "skillsmp" ? "SMP" : "SSH";
}

/**
 * Render skills table
 */
export function renderSkillsTable(skills: Skill[], theme: Theme, expanded: boolean): string {
  const widths = expanded ? [3, 22, 7, 5, 16, 48] : [3, 20, 7, 5, 14, 30];
  const rows = expanded ? skills : skills.slice(0, 5);

  const header = formatTableRow(["#", "Name", "Stars", "Src", "Author", "Description"], widths);
  const divider = formatTableRow(widths.map((width) => "─".repeat(width)), widths);

  const lines = [theme.fg("muted", header), theme.fg("borderMuted", divider)];

  for (const [index, skill] of rows.entries()) {
    const number = theme.fg("accent", padRight(String(index + 1), widths[0]));
    const name = theme.fg("text", padRight(truncateCell(skill.name, widths[1]), widths[1]));
    const stars = skill.stars > 0 ? skill.stars.toLocaleString() : "-";
    const starsText = theme.fg(skill.stars > 0 ? "warning" : "dim", padRight(truncateCell(`★ ${stars}`, widths[2]), widths[2]));
    const source = theme.fg(skill.provider === "skillsmp" ? "success" : "accent", padRight(getProviderBadge(skill.provider), widths[3]));
    const author = theme.fg("dim", padRight(truncateCell(skill.author, widths[4]), widths[4]));
    const description = theme.fg("muted", padRight(truncateCell(skill.description, widths[5]), widths[5]));
    lines.push([number, name, starsText, source, author, description].join("  "));
  }

  if (!expanded && skills.length > rows.length) {
    lines.push("");
    lines.push(theme.fg("dim", `Showing ${rows.length} of ${skills.length} results. Expand to see all.`));
  }

  if (expanded) {
    for (const [index, skill] of skills.entries()) {
      const sourceLabel = skill.provider === "skillsmp" ? "SkillsMP" : "skills.sh";
      lines.push("");
      lines.push(theme.fg("accent", `${index + 1}. ${skill.name}`) + " " + theme.fg("dim", `(${sourceLabel})`));
      lines.push(theme.fg("dim", `Install: /skills install ${skill.id}`));
      if (skill.githubUrl) lines.push(theme.fg("dim", `GitHub: ${skill.githubUrl}`));
      if (skill.skillUrl) lines.push(theme.fg("dim", `Marketplace: ${skill.skillUrl}`));
    }
  }

  return lines.join("\n");
}

/**
 * Format skills as plain text (for LLM output)
 */
export function formatSkills(skills: Skill[]): string {
  if (skills.length === 0) return "No skills found.";

  return skills
    .map((skill, index) => {
      const stars = skill.stars > 0 ? ` ★${skill.stars.toLocaleString()}` : "";
      const source = skill.provider === "skillsmp" ? " [SkillsMP]" : " [skills.sh]";
      return [
        `**${index + 1}. ${skill.name}**${stars}${source} _by ${skill.author}_`,
        skill.description,
        `Install: \`/skills install ${skill.id}\``,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Interactive skill picker UI
 */
export async function showInteractiveSkillPicker(
  ctx: ExtensionContext,
  query: string,
  mode: SearchMode,
  language: "es" | "en",
  skills: Skill[],
  sources?: { skillsmp: number; skillssh: number }
): Promise<Skill | null> {
  if (!ctx.hasUI) return null;

  return ctx.ui.custom<Skill | null>(
    (tui, theme, _kb, done) => {
      let selected = 0;
      let windowStart = 0;
      const windowSize = 8;
      let cachedWidth: number | undefined;
      let cachedLines: string[] | undefined;

      const ensureVisible = () => {
        if (selected < windowStart) windowStart = selected;
        if (selected >= windowStart + windowSize) windowStart = selected - windowSize + 1;
      };

      const refresh = () => {
        cachedWidth = undefined;
        cachedLines = undefined;
        tui.requestRender();
      };

      const renderRow = (skill: Skill, index: number, widths: number[], isSelected: boolean) => {
        const row = formatTableRow(
          [
            String(index + 1),
            skill.name,
            skill.stars > 0 ? `★ ${skill.stars.toLocaleString()}` : "-",
            getProviderBadge(skill.provider),
            skill.author,
          ],
          widths,
        );

        if (isSelected) {
          return theme.bg("selectedBg", theme.fg("accent", row));
        }

        return [
          theme.fg("accent", padRight(String(index + 1), widths[0])),
          theme.fg("text", padRight(truncateCell(skill.name, widths[1]), widths[1])),
          theme.fg(skill.stars > 0 ? "warning" : "dim", padRight(truncateCell(skill.stars > 0 ? `★ ${skill.stars.toLocaleString()}` : "-", widths[2]), widths[2])),
          theme.fg(skill.provider === "skillsmp" ? "success" : "accent", padRight(getProviderBadge(skill.provider), widths[3])),
          theme.fg("dim", padRight(truncateCell(skill.author, widths[4]), widths[4])),
        ].join("  ");
      };

      return {
        handleInput(data: string) {
          if (matchesKey(data, Key.up) && selected > 0) {
            selected--;
            ensureVisible();
            refresh();
            return;
          }

          if (matchesKey(data, Key.down) && selected < skills.length - 1) {
            selected++;
            ensureVisible();
            refresh();
            return;
          }

          if (matchesKey(data, Key.enter)) {
            done(skills[selected] ?? null);
            return;
          }

          if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            done(null);
          }
        },
        render(width: number): string[] {
          if (cachedLines && cachedWidth === width) return cachedLines;

          const lines: string[] = [];
          const innerWidth = Math.max(40, width - 4);
          const pad = "  ";
          const borderH = "─";
          const borderV = "│";
          const tl = "┌";
          const tr = "┐";
          const bl = "└";
          const br = "┘";
          const ml = "├";
          const mr = "┤";

          const addBorder = (line: string) => {
            const content = truncateToWidth(line, innerWidth);
            const padded = content + " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
            lines.push(theme.fg("border", borderV) + pad + padded + pad + theme.fg("border", borderV));
          };

          const addEmpty = () => addBorder("");

          const addSeparator = () => {
            lines.push(theme.fg("border", ml + borderH.repeat(width - 2) + mr));
          };

          const widths = innerWidth >= 120
            ? [3, 26, 8, 5, 22]
            : [3, 20, 8, 5, 16];
          const title = language === "es"
            ? `Skills para ${query}`
            : `Skills for ${query}`;
          const recommendation = buildRecommendation(query, skills, language);
          const visible = skills.slice(windowStart, windowStart + windowSize);
          const selectedSkill = skills[selected];

          lines.push(theme.fg("border", tl + borderH.repeat(width - 2) + tr));

          addEmpty();
          addBorder(theme.fg("accent", theme.bold(title)) + theme.fg("dim", ` (${mode})`));
          
          // Show source counts
          if (sources) {
            const sourceParts: string[] = [];
            if (sources.skillsmp > 0) sourceParts.push(`SkillsMP: ${sources.skillsmp}`);
            if (sources.skillssh > 0) sourceParts.push(`skills.sh: ${sources.skillssh}`);
            if (sourceParts.length > 0) {
              addBorder(theme.fg("dim", sourceParts.join(" | ")));
            }
          }
          
          addEmpty();
          addBorder(theme.fg("muted", formatTableRow(["#", "Name", "Stars", "Src", "Author"], widths)));
          addBorder(theme.fg("borderMuted", formatTableRow(widths.map((w) => borderH.repeat(w)), widths)));

          for (const [offset, skill] of visible.entries()) {
            const index = windowStart + offset;
            addBorder(renderRow(skill, index, widths, index === selected));
          }

          if (skills.length > windowSize) {
            addEmpty();
            addBorder(theme.fg("dim", `${windowStart + 1}-${Math.min(windowStart + windowSize, skills.length)} / ${skills.length}`));
          }

          if (selectedSkill) {
            addSeparator();
            addEmpty();
            const sourceLabel = selectedSkill.provider === "skillsmp" ? "SkillsMP" : "skills.sh";
            addBorder(theme.fg("accent", theme.bold(selectedSkill.name)) + (selectedSkill.stars > 0 ? theme.fg("warning", `  ★ ${selectedSkill.stars.toLocaleString()}`) : "") + theme.fg("dim", ` (${sourceLabel})`));
            addBorder(theme.fg("dim", `by ${selectedSkill.author}`));
            addEmpty();
            addBorder(theme.fg("muted", truncateToWidth(selectedSkill.description, innerWidth)));
            addEmpty();
            addBorder(
              selectedSkill.githubUrl
                ? theme.fg("dim", "GitHub: ") + theme.fg("muted", selectedSkill.githubUrl)
                : ""
            );
          }

          addEmpty();
          addBorder(theme.fg("accent", recommendation));
          addEmpty();

          if (selectedSkill) {
            addBorder(theme.fg("dim", language === "es"
              ? "Enter instala • Esc cierra"
              : "Enter installs • Esc closes"));
          }

          addEmpty();
          lines.push(theme.fg("border", bl + borderH.repeat(width - 2) + br));

          cachedWidth = width;
          cachedLines = lines;
          return lines;
        },
        invalidate() {
          cachedWidth = undefined;
          cachedLines = undefined;
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "92%",
        maxHeight: "80%",
        anchor: "center",
        margin: 1,
      },
    },
  );
}
