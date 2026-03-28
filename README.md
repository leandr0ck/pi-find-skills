# pi-find-skills

A [pi coding agent](https://github.com/badlogic/pi-mono) extension for searching and installing skills from multiple providers: [SkillsMP](https://skillsmp.com) and [skills.sh](https://skills.sh).

> This repository is a **pi extension**, not a skill.
> Install it in `~/.pi/agent/extensions/`, and pi will load it automatically.

## What this extension does

Once loaded, it adds three integrations to pi:

1. **Natural-language search interception** via the `input` event
2. **Slash commands** for searching and installing skills from the pi UI
3. **A tool named `skills_search`** so the agent can discover skills when the user asks for them

The **skills** are what this extension searches for and installs.
This repository is the **extension**.

## Providers

This extension searches skills from two providers in parallel:

| Provider | Auth | Description |
|----------|------|-------------|
| **SkillsMP** | Required (`SKILLSMP_API_KEY`) | Premium marketplace with AI semantic search |
| **skills.sh** | None required | Open marketplace via `npx skills find` |

Results from both providers are merged, deduplicated, and ranked by relevance.

## Features

- 🔍 **Smart Search** - Prioritizes skills with the query in their name, then by stars
- 🤖 **AI Semantic Search** - Find skills using natural language queries (SkillsMP)
- 🌐 **Multi-Provider** - Searches SkillsMP and skills.sh simultaneously
- ✍️ **Natural Language Input** - Write `buscar skills para React` or `search skills for Cloudflare deploy`
- 📊 **Rich Results UI** - Navigable table with source badges (SMP/SSH)
- 📦 **Installation Flow** - Install skills directly from pi
- 🧰 **LLM Tool** - Exposes the `skills_search` tool to the agent
- 💬 **Slash Commands** - Adds `/skills`, `/skills search`, `/skills ai`, and `/skills install`

## Installation

### Option 1: Install as a global pi extension

```bash
mkdir -p ~/.pi/agent/extensions
git clone https://github.com/leandr0ck/pi-find-skills.git ~/.pi/agent/extensions/pi-find-skills
```

pi auto-discovers extensions in these locations:

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`

This repository uses the second form:

```text
~/.pi/agent/extensions/pi-find-skills/index.ts
```

### Option 2: Run it manually with `-e`

```bash
pi -e ~/.pi/agent/extensions/pi-find-skills/index.ts
```

### After installing

If pi is already running, execute:

```text
/reload
```

## Configuration

### SkillsMP API Key (Optional)

SkillsMP requires an API key. skills.sh works without configuration.

1. Go to [SkillsMP](https://skillsmp.com/auth/login)
2. Sign in
3. Generate an API key
4. Add to your shell profile:

```bash
export SKILLSMP_API_KEY="sk_live_your_key_here"
```

Then reload your shell:

```bash
source ~/.zshrc
```

## Usage in pi

### 1) Natural language

You can ask directly, without using a slash command:

```text
buscar skills para React
buscar skills para hacer deploy a Cloudflare
search skills for postgres migrations
skills para web scraping
```

The extension intercepts these prompts and handles them directly, so you get the results UI without extra assistant thinking text.

In interactive mode:
- `↑` / `↓` navigate the results
- `Enter` installs the selected skill
- `Esc` closes the picker

### 2) Slash commands

The extension registers these commands:

| Command | Description |
|---|---|
| `/skills` | Show quick help |
| `/skills search <query>` | Search skills by keyword (all providers) |
| `/skills ai <query>` | Search skills semantically (all providers) |
| `/skills install <skill-id>` | Install a skill by ID |

#### Legacy commands (backward compatibility)

| Command | Description |
|---|---|
| `/skillsmp` | Show legacy help |
| `/skillsmp search <query>` | Alias for `/skills search` |
| `/skillsmp ai <query>` | Alias for `/skills ai` |
| `/skillsmp install <id>` | Alias for `/skills install` |

#### Examples

```text
/skills
/skills search react
/skills ai how to scrape websites
/skills install svelte-writer
```

### 3) Agent tool

The extension registers these tools:

```text
skills_search(query: string, mode: "keyword" | "ai")
skillsmp_search(query: string, mode: "keyword" | "ai")  # Legacy
```

This allows the agent to search for skills when the user asks for them.

## Example output

Results are displayed in a rich table with source badges:

```
#   Name              Stars   Src   Author        Description
──────────────────────────────────────────────────────────────────
1   svelte-writer     ★342    SMP   sveltejs      Svelte 5 helpers...
2   neon-postgres     ★ 89    SSH   neon         Neon DB utilities...
```

**Source badges:**
- **SMP** = SkillsMP
- **SSH** = skills.sh

The extension **re-ranks results** to prioritize:
1. Skills with the query in their name (exact → starts with → contains)
2. Skills with matching words in description
3. Skills with more stars

## Correct mental model

### If you are a pi user

- Install **this extension** once
- Optionally configure `SKILLSMP_API_KEY` for SkillsMP access
- skills.sh works out of the box
- Use natural language or `/skills ...`
- Install the **skills** you want

### If you are documenting this project

Do not describe this repository as a pi skill.
Describe it as a **pi extension** that:

- registers commands
- registers tools
- intercepts user input through the `input` event
- connects pi with multiple skill marketplaces
- helps users discover and install skills

## Development

```text
pi-find-skills/
├── index.ts           # Entry point, wires everything together
├── providers/
│   ├── types.ts       # Shared interfaces (Skill, SkillProvider)
│   ├── skillsmp.ts    # SkillsMP provider (REST API)
│   ├── skillssh.ts    # skills.sh provider (CLI)
│   └── index.ts       # Provider exports
├── search.ts          # Search aggregation, ranking, deduplication
├── ui.ts              # Interactive picker, table rendering
├── commands.ts        # Slash command handlers
├── tool.ts            # LLM tool registration
├── README.md
├── LICENSE
└── .gitignore
```

## Security

⚠️ **Do not commit your API key**

The extension reads the key from `SKILLSMP_API_KEY`.

Recommendations:

1. Store the key only in environment variables
2. Do not hardcode it in source files
3. Add `.env` to `.gitignore` if you use one

## License

MIT
