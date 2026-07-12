import type { Plugin } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { MetasearchService, type SearchType } from './service.js';

const PLUGIN_MARKER = 'opencode-metasearch2';
const FORK_REPO = 'https://github.com/Ron-RONZZ-org/metasearch2';

const WEB_SEARCH_GUIDANCE = `<WEB_SEARCH_TOOL>
You have a \`web_search\` tool that searches the web using a local metasearch engine.

| Tool | Use when |
|------|----------|
| \`web_search\` | Searching the web for current information, news, documentation, or any query that benefits from aggregating Google, Bing, Brave, and other engines |

**Arguments:**
- \`query\` (string, required) — The search query
- \`type\` ("all" | "images", default "all") — \`"all"\` for web results, \`"images"\` for image search

**Response format:** Raw JSON array. Each tab has \`search_results\` (for web) or \`image_results\` (for images). Results include \`result\`, \`engines\` (which search engines found it), and \`score\`.

No API keys required. Runs a local meta-search engine.
</WEB_SEARCH_TOOL>`;

const WEB_SEARCH_UNAVAILABLE_GUIDANCE = `<WEB_SEARCH_TOOL>
## web_search tool — NOT AVAILABLE

The metasearch2 binary was not found. To fix this:

1. **Pre-built binary** (recommended): Reinstall the plugin:
   \`\`\`
   npm install opencode-metasearch2
   \`\`\`
   This installs a pre-built binary for your platform — no Rust toolchain needed.

2. **Build from source**: Install Rust, then build the patched fork:
   \`\`\`
   cargo install --git ${FORK_REPO} metasearch
   \`\`\`

3. **Set METASEARCH_BIN** to the path of an existing metasearch2 binary.

After installing, restart opencode.
</WEB_SEARCH_TOOL>`;

const plugin: Plugin = async () => {
  const service = new MetasearchService();
  let started = false;

  try {
    await service.start();
    started = true;
  } catch {
    // Service failed to start — guidance hooks below will still inform the
    // LLM about the web_search capability (marked unavailable), so it can
    // help the user install or troubleshoot.
  }

  return {
    // -----------------------------------------------------------------------
    // Guidance hook 1: system prompt note
    // -----------------------------------------------------------------------
    config: async (config) => {
      config.instructions = config.instructions ?? [];
      const hasMarker = config.instructions.some(
        (item) => typeof item === 'string' && item.includes(PLUGIN_MARKER),
      );
      if (!hasMarker) {
        config.instructions.push(
          started
            ? `${PLUGIN_MARKER}: web_search tool available — use for general-purpose web search`
            : `${PLUGIN_MARKER}: web_search tool NOT available (binary not found). Install with: \`cargo install --git ${FORK_REPO} metasearch\` and restart opencode.`,
        );
      }
    },

    // -----------------------------------------------------------------------
    // Guidance hook 2: inject tool table into first user message
    // (only when service is running — unavailable case covered by config +
    // compacting hooks)
    // -----------------------------------------------------------------------
    'experimental.chat.messages.transform': started
      ? async (_input, output) => {
          if (!output.messages.length) return;

          const firstUser = output.messages.find((m) => m.info.role === 'user');
          if (!firstUser?.parts.length) return;
          if (firstUser.parts.some((p) => p.type === 'text' && p.text.includes('<WEB_SEARCH_TOOL>'))) {
            return; // already injected — idempotency guard
          }

          const ref = firstUser.parts[0];
          firstUser.parts.unshift({ ...ref, type: 'text', text: WEB_SEARCH_GUIDANCE });
        }
      : async () => {
          // noop — system prompt + compacting already convey unavailability
        },

    // -----------------------------------------------------------------------
    // Guidance hook 3: re-inject on compaction
    // -----------------------------------------------------------------------
    'experimental.session.compacting': async (_input, output) => {
      output.context.push(
        started
          ? `
## Web Search (${PLUGIN_MARKER})
You have \`web_search\` tool for general-purpose web search.
Arguments: query (string, required), type ("all" | "images", default "all").
Runs a local metasearch engine — no API key needed.
`
          : `
## Web Search (${PLUGIN_MARKER})
\`web_search\` tool is NOT available (binary not found).
Install the patched fork: \`cargo install --git ${FORK_REPO} metasearch\`
Or reinstall the plugin for a pre-built binary: \`npm install opencode-metasearch2\`
`,
      );
    },

    // -----------------------------------------------------------------------
    // Tool registration (only when service is running)
    // -----------------------------------------------------------------------
    ...(started && {
      tool: {
        web_search: tool({
          description:
            'Search the web using a local metasearch engine that aggregates results from Google, Bing, Brave, and others. ' +
            'Returns raw JSON with search results, featured snippets, direct answers, and infoboxes. ' +
            'Set type to "images" for image search.',
          args: {
            query: tool.schema.string().describe('The search query'),
            type: tool.schema
              .enum(['all', 'images'])
              .default('all')
              .describe('Search type: "all" for web results, "images" for image search'),
          },
          async execute(args) {
            return service.search(args.query, args.type as SearchType);
          },
        }),
      },
    }),
  };
};

export default plugin;
