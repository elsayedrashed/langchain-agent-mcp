import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  fetchAndValidate,
  formatError,
  isDirectExecution,
  textResult,
} from "./shared";

const SERVER_NAME = "jokes-mcp-server";
const SERVER_VERSION = "1.0.0";
const CHUCK_NORRIS_API = "https://api.chucknorris.io/jokes";

const jokeSchema = z.object({
  value: z.string().min(1),
});

const categoriesSchema = z.array(z.string());

const examplesResource = `
# Chuck Norris MCP Server Examples

## Tools

- **get-chuck-joke()**: Fetch a random joke.
- **get-chuck-joke-category({ category })**: Fetch a random joke from a category.
- **list-joke-categories()**: List all available joke categories.

## Prompt

- **summarize-joke({ joke })**: Summarize a joke into a shorter sentence.

## Examples

\`\`\`
get-chuck-joke()
\`\`\`

\`\`\`
list-joke-categories()
\`\`\`

\`\`\`
get-chuck-joke-category({ category: "science" })
\`\`\`

\`\`\`
summarize-joke({ joke: "Chuck Norris counted to infinity. Twice." })
\`\`\`
`;

function registerTools(server: McpServer): void {
  server.tool(
    "get-chuck-joke",
    "Fetch a random Chuck Norris joke",
    {},
    async () => {
      try {
        const joke = await fetchAndValidate(
          `${CHUCK_NORRIS_API}/random`,
          jokeSchema,
          "Chuck Norris API",
        );
        return textResult(joke.value);
      } catch (error) {
        return textResult(`Error fetching joke: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "get-chuck-joke-category",
    "Fetch a random Chuck Norris joke from a given category",
    {
      category: z.string().trim().min(1).describe("The joke category to fetch"),
    },
    async ({ category }) => {
      try {
        const url = new URL(`${CHUCK_NORRIS_API}/random`);
        url.searchParams.set("category", category);
        const joke = await fetchAndValidate(
          url,
          jokeSchema,
          "Chuck Norris API",
        );
        return textResult(joke.value);
      } catch (error) {
        return textResult(
          `Error fetching joke for category "${category}": ${formatError(error)}`,
        );
      }
    },
  );

  server.tool(
    "list-joke-categories",
    "Get a list of available Chuck Norris joke categories",
    {},
    async () => {
      try {
        const categories = await fetchAndValidate(
          `${CHUCK_NORRIS_API}/categories`,
          categoriesSchema,
          "Chuck Norris API",
        );
        return textResult(categories.join(", "));
      } catch (error) {
        return textResult(`Error fetching categories: ${formatError(error)}`);
      }
    },
  );
}

function registerPrompt(server: McpServer): void {
  server.prompt(
    "summarize-joke",
    "Summarize a Chuck Norris joke into a short sentence",
    {
      joke: z.string().trim().min(1).describe("The joke to summarize"),
    },
    async ({ joke }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You can use the get-chuck-joke or get-chuck-joke-category tools to fetch jokes. Here is a joke to summarize:\n"${joke}"`,
          },
        },
      ],
    }),
  );
}

function registerResources(server: McpServer): void {
  server.resource("examples", "examples://chuck-norris", async (uri) => ({
    contents: [{ uri: uri.href, text: examplesResource }],
  }));
}

export function createJokesMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server);
  registerPrompt(server);
  registerResources(server);
  return server;
}

async function main(): Promise<void> {
  const server = createJokesMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Jokes MCP Server running on stdio");
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Fatal error starting Jokes MCP Server:", error);
    process.exitCode = 1;
  });
}
