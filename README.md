# pi-find-skills

A [pi coding agent](https://github.com/badlogic/pi-mono) extension for searching and installing skills from multiple providers: [SkillsMP](https://skillsmp.com) and [skills.sh](https://skills.sh).

![pi-find-skills screenshot](./Screenshot.png)


## Features

- ✍️ **Natural Language Input** - Write  `search skills for Cloudflare deploy` or `search skills for React`
- 🌐 **Multi-Provider** - Searches SkillsMP and skills.sh simultaneously
- 🔍 **Popularity Sorting** - Orders results simply by stars or installs
- 📊 **Rich Results UI** - Navigable table with source badges (SMP/SSH)
- 📦 **Installation Flow** - Install skills directly from pi
- 🧰 **LLM Tool** - Exposes the `skills_search` tool to the agent
- 💬 **Slash Commands** - Adds `/skills`, `/skills search`, `/skills ai`, and `/skills install`


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

Results from both providers are merged, deduplicated, and sorted by popularity (stars or installs).


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
## License

MIT
