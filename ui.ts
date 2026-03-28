/**
 * UI components for skill display
 *
 * Interactive picker and message formatting built on pi-tui components.
 */

import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Box,
  Container,
  type Component,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import type { Skill, SearchMode } from "./providers/types";

export interface SearchResultsMessageDetails {
  query: string;
  mode: SearchMode;
  skills: Skill[];
  error?: string;
  sources?: {
    skillsmp: number;
    skillssh: number;
  };
}

class BorderedPanel implements Component {
  constructor(
    private readonly child: Component,
    private readonly color: (text: string) => string,
    private readonly paddingX = 1,
    private readonly paddingY = 0,
  ) {}

  render(width: number): string[] {
    const panelWidth = Math.max(4, width);
    const innerWidth = Math.max(1, panelWidth - 2);
    const contentWidth = Math.max(1, innerWidth - this.paddingX * 2);
    const childLines = this.child.render(contentWidth);
    const lines: string[] = [];

    lines.push(this.color(`┌${"─".repeat(innerWidth)}┐`));

    const emptyLine = this.color("│") + " ".repeat(innerWidth) + this.color("│");
    for (let i = 0; i < this.paddingY; i++) lines.push(emptyLine);

    for (const childLine of childLines) {
      const line = truncateToWidth(childLine, contentWidth, "");
      const lineWidth = visibleWidth(line);
      const rightPad = Math.max(0, contentWidth - lineWidth);
      lines.push(
        this.color("│") +
          " ".repeat(this.paddingX) +
          line +
          " ".repeat(rightPad + this.paddingX) +
          this.color("│"),
      );
    }

    for (let i = 0; i < this.paddingY; i++) lines.push(emptyLine);

    lines.push(this.color(`└${"─".repeat(innerWidth)}┘`));
    return lines;
  }

  invalidate(): void {
    this.child.invalidate();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getProviderBadge(provider: Skill["provider"]): string {
  return provider === "skillsmp" ? "SMP" : "SSH";
}

function getProviderLabel(provider: Skill["provider"]): string {
  return provider === "skillsmp" ? "SkillsMP" : "skills.sh";
}

function formatStars(stars: number): string {
  return stars > 0 ? `★ ${stars.toLocaleString()}` : "—";
}

function normalizeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function truncatePlain(text: string, width: number): string {
  return truncateToWidth(normalizeInline(text), Math.max(1, width), "…");
}

function padPlain(text: string, width: number, align: "left" | "right" = "left"): string {
  const truncated = truncatePlain(text, width);
  const padding = Math.max(0, width - visibleWidth(truncated));
  return align === "right" ? " ".repeat(padding) + truncated : truncated + " ".repeat(padding);
}

function makeSeparator(widths: number[], left: string, mid: string, right: string): string {
  return left + widths.map((width) => "─".repeat(width + 2)).join(mid) + right;
}

function makePlainRow(cells: string[]): string {
  return `│ ${cells.join(" │ ")} │`;
}

function styleSourceCell(skill: Skill, text: string, theme: Theme): string {
  return theme.fg(skill.provider === "skillsmp" ? "success" : "accent", text);
}

function styleStarsCell(skill: Skill, text: string, theme: Theme): string {
  return skill.stars > 0 ? theme.fg("warning", text) : theme.fg("dim", text);
}

function styleTableRow(cells: string[], skill: Skill, theme: Theme): string {
  return (
    "│ " +
    [
      theme.fg("accent", cells[0]),
      theme.fg("text", cells[1]),
      styleSourceCell(skill, cells[2], theme),
      styleStarsCell(skill, cells[3], theme),
      theme.fg("dim", cells[4]),
    ].join(" │ ") +
    " │"
  );
}

function makeSingleCellRow(text: string, width: number, color: (text: string) => string): string {
  return `│ ${color(padPlain(text, width))} │`;
}

function styleHeaderText(text: string, theme: Theme): string {
  return theme.fg("text", theme.bold(text));
}

function buildListDescription(skill: Skill): string {
  return [
    padPlain(getProviderBadge(skill.provider), 3),
    padPlain(formatStars(skill.stars), 16, "right"),
    truncatePlain(skill.author, 16),
  ].join("  ");
}

// ─── Message renderer helpers ────────────────────────────────────────────────

/**
 * Render skills as a compact table + detail lines (used in message renderer).
 */
export function renderSkillsTable(skills: Skill[], theme: Theme, expanded: boolean): string {
  const rows = expanded ? skills : skills.slice(0, 5);
  if (rows.length === 0) return theme.fg("muted", "No skills found.");

  const widths = [
    3,
    Math.min(26, Math.max(18, ...rows.map((skill) => visibleWidth(normalizeInline(skill.name))))),
    3,
    24,
    Math.min(16, Math.max(10, ...rows.map((skill) => visibleWidth(normalizeInline(skill.author))))),
  ];

  const lines: string[] = [];
  const top = theme.fg("borderMuted", makeSeparator(widths, "┌", "┬", "┐"));
  const mid = theme.fg("borderMuted", makeSeparator(widths, "├", "┼", "┤"));
  const bottom = theme.fg("borderMuted", makeSeparator(widths, "└", "┴", "┘"));
  const detailWidth = visibleWidth(makePlainRow(widths.map((width) => " ".repeat(width)))) - 4;

  lines.push(top);
  lines.push(
    styleHeaderText(
      makePlainRow([
        padPlain("#", widths[0], "right"),
        padPlain("Skill", widths[1]),
        padPlain("Src", widths[2]),
        padPlain("Popularity", widths[3], "right"),
        padPlain("Author", widths[4]),
      ]),
      theme,
    ),
  );
  lines.push(mid);

  rows.forEach((skill, index) => {
    const rowCells = [
      padPlain(String(index + 1), widths[0], "right"),
      padPlain(skill.name, widths[1]),
      padPlain(getProviderBadge(skill.provider), widths[2]),
      padPlain(formatStars(skill.stars), widths[3], "right"),
      padPlain(skill.author, widths[4]),
    ];

    lines.push(styleTableRow(rowCells, skill, theme));
    lines.push(
      makeSingleCellRow(`Description: ${skill.description}`, detailWidth, (text) => theme.fg("muted", text)),
    );
    lines.push(
      makeSingleCellRow(`Install: /skills install ${skill.id}`, detailWidth, (text) => theme.fg("dim", text)),
    );

    if (index < rows.length - 1) lines.push(mid);
  });

  lines.push(bottom);

  if (!expanded && skills.length > rows.length) {
    lines.push(theme.fg("dim", `Showing ${rows.length} of ${skills.length} results. Expand to see all.`));
  }

  return lines.join("\n");
}

/**
 * Format skills as plain text (for LLM output).
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

// ─── Interactive picker ──────────────────────────────────────────────────────

/**
 * Interactive skill picker overlay.
 *
 * Uses SelectList + a custom bordered panel.
 * Shows a more ordered list plus a live detail panel below.
 */
export async function showInteractiveSkillPicker(
  ctx: ExtensionContext,
  query: string,
  mode: SearchMode,
  skills: Skill[],
  sources?: { skillsmp: number; skillssh: number },
): Promise<Skill | null> {
  if (!ctx.hasUI || skills.length === 0) return null;

  return ctx.ui.custom<Skill | null>(
    (tui, theme, _kb, done) => {
      const primaryColumnWidth = 40;

      const items: SelectItem[] = skills.map((skill, index) => ({
        value: skill.id,
        label: `${String(index + 1).padStart(2, " ")}. ${skill.name}`,
        description: buildListDescription(skill),
      }));

      let currentSkill: Skill = skills[0]!;

      const titleText = new Text("", 0, 0);
      const sourceText = new Text("", 0, 0);
      const legendText = new Text("", 0, 0);
      const detailTitleText = new Text("", 0, 0);
      const detailText = new Text("", 0, 0);
      const helpText = new Text("", 0, 0);

      const updateStaticText = () => {
        const titleLabel = `Skills for "${query}"`;
        titleText.setText(theme.fg("accent", theme.bold(titleLabel)) + theme.fg("dim", ` · ${mode}`));

        const sourceParts: string[] = [];
        if (sources?.skillsmp) sourceParts.push(`SkillsMP: ${sources.skillsmp}`);
        if (sources?.skillssh) sourceParts.push(`skills.sh: ${sources.skillssh}`);
        sourceText.setText(sourceParts.length > 0 ? theme.fg("dim", sourceParts.join(" · ")) : "");

        const legendLeft = padPlain("Skill", primaryColumnWidth);
        const legendRight = [
          padPlain("Src", 3),
          padPlain("Popularity", 16, "right"),
          padPlain("Author", 16),
        ].join("  ");
        legendText.setText(styleHeaderText(`${legendLeft}  ${legendRight}`, theme));

        detailTitleText.setText(
          theme.fg("accent", theme.bold("Details")),
        );

        const helpLine = "↑↓ navigate • enter install • esc close";
        helpText.setText(theme.fg("dim", helpLine));
      };

      const updateDetail = (skill: Skill) => {
        currentSkill = skill;

        const meta = [
          getProviderBadge(skill.provider),
          skill.author,
          formatStars(skill.stars),
        ].filter(Boolean).join(" · ");

        const detailLines = [
          theme.fg("text", theme.bold(skill.name)) + " " + theme.fg("dim", meta),
          theme.fg("muted", normalizeInline(skill.description)),
        ];

        detailText.setText(detailLines.join("\n"));
      };

      updateStaticText();
      updateDetail(currentSkill);

      const selectList = new SelectList(
        items,
        Math.min(items.length, 10),
        {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        },
        {
          minPrimaryColumnWidth: primaryColumnWidth,
          maxPrimaryColumnWidth: primaryColumnWidth,
          truncatePrimary: ({ text, maxWidth }) => truncateToWidth(text, maxWidth, "…"),
        },
      );

      selectList.onSelectionChange = (item) => {
        const skill = skills.find((entry) => entry.id === item.value);
        if (skill) {
          updateDetail(skill);
          tui.requestRender();
        }
      };

      selectList.onSelect = (item) => {
        const skill = skills.find((entry) => entry.id === item.value);
        done(skill ?? null);
      };

      selectList.onCancel = () => done(null);

      const content = new Container();
      content.addChild(titleText);
      content.addChild(sourceText);
      content.addChild(new Spacer(1));
      content.addChild(legendText);
      content.addChild(new DynamicBorder((s: string) => theme.fg("borderMuted", s)));
      content.addChild(selectList);
      content.addChild(new Spacer(1));
      content.addChild(new DynamicBorder((s: string) => theme.fg("borderMuted", s)));
      content.addChild(detailTitleText);
      content.addChild(detailText);
      content.addChild(new Spacer(1));
      content.addChild(helpText);

      const paddedContent = new Box(1, 1);
      paddedContent.addChild(content);

      const panel = new BorderedPanel(
        paddedContent,
        (s: string) => theme.fg("borderAccent", s),
        1,
        0,
      );

      return {
        render: (width) => panel.render(width),
        invalidate: () => {
          panel.invalidate();
          updateStaticText();
          updateDetail(currentSkill);
        },
        handleInput: (data) => {
          selectList.handleInput(data);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "94%",
        maxHeight: "84%",
        anchor: "center",
        margin: 1,
      },
    },
  );
}
