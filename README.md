# pi-skillsmp

[SkillsMP](https://skillsmp.com) extension for [pi coding agent](https://github.com/badlogic/pi-coding-agent).

Search, discover, and install AI agent skills from the SkillsMP marketplace directly within pi.

## Features

- 🔍 **Keyword Search** - Find skills by specific terms
- 🤖 **AI Semantic Search** - Natural language queries powered by Cloudflare AI
- 📦 **Easy Installation** - Install skills with one click via `npx skills add`
- 🤖 **LLM Tool** - The agent can search for skills autonomously

## Installation

### Option 1: Clone to extensions directory

```bash
cd ~/.pi/agent/extensions
git clone https://github.com/leandr0ck/pi-skillsmp.git skillsmp
```

### Option 2: Manual install

```bash
mkdir -p ~/.pi/agent/extensions/skillsmp
# Download index.ts to that directory
```

## Configuration

### 1. Get your API Key

1. Go to [SkillsMP](https://skillsmp.com/auth/login)
2. Sign in and generate an API key

### 2. Set the environment variable

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export SKILLSMP_API_KEY="sk_live_your_key_here"
```

Then reload:

```bash
source ~/.zshrc  # or ~/.bashrc
```

## Usage

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/skillsmp` | Show available commands |
| `/skillsmp search <query>` | Search skills by keywords |
| `/skillsmp ai <query>` | AI semantic search |
| `/skillsmp install <id>` | Install a skill by ID |

#### Examples

```
/skillsmp search react
/skillsmp ai "how to scrape websites"
/skillsmp install cockroachdb-cockroach-pkg-ui-claude-skills-redux-to-swr-skill-md
```

### LLM Tool

The extension registers a tool that the agent can call directly:

```
skillsmp_search(query: "react", mode: "keyword" | "ai")
```

Just ask naturally:

```
"busca una skill para react"
"find a skill for web scraping"
"necesito una skill para testing"
```

## Output Format

```
1. **skill-name** ★123 by author
   Description of the skill...
   `npx skills add skill-id-here`
```

## API Rate Limits

- 500 requests per day per API key
- Resets at midnight UTC

## Security

⚠️ **Never commit your API key to version control**

This extension reads the API key from the `SKILLSMP_API_KEY` environment variable. Make sure to:

1. Keep your key in environment variables only
2. Add `.env` files to `.gitignore`
3. Use different keys for development/production if needed

## Development

```
pi-skillsmp/
├── index.ts     # Extension code
├── README.md    # Documentation
├── LICENSE      # MIT License
└── .gitignore
```

## License

MIT
