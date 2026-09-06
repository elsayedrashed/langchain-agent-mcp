import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  fetchAndValidate,
  formatError,
  isDirectExecution,
  textResult,
} from "./shared";

const SERVER_NAME = "exchange-rates-mcp-server";
const SERVER_VERSION = "1.0.0";
const FRANKFURTER_API = "https://api.frankfurter.dev/v1";
const MAX_TIMESERIES_DAYS = 366;

const currencyCodeSchema = z
  .string()
  .trim()
  .length(3)
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Currency must be a three-letter ISO 4217 code.");

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Date is invalid.");

const currenciesResponseSchema = z.record(currencyCodeSchema, z.string());

const ratesResponseSchema = z.object({
  amount: z.number(),
  base: currencyCodeSchema,
  date: dateSchema,
  rates: z.record(currencyCodeSchema, z.number()),
});

const timeseriesResponseSchema = z.object({
  amount: z.number(),
  base: currencyCodeSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  rates: z.record(
    dateSchema,
    z.record(currencyCodeSchema, z.number()),
  ),
});

type RatesResponse = z.infer<typeof ratesResponseSchema>;
type TimeseriesResponse = z.infer<typeof timeseriesResponseSchema>;

const rateProvenance = {
  rateType: "ECB reference rate (mid-market)",
  source: "European Central Bank via Frankfurter",
} as const;

function ratesEndpoint(date?: string): URL {
  return new URL(`${FRANKFURTER_API}/${date ?? "latest"}`);
}

async function getRates(input: {
  base: string;
  symbols?: string[];
  date?: string;
}): Promise<RatesResponse> {
  const requestedSymbols = input.symbols
    ? [...new Set(input.symbols)]
    : undefined;
  const upstreamSymbols = requestedSymbols?.filter(
    (symbol) => symbol !== input.base,
  );
  const url = ratesEndpoint(input.date);
  url.searchParams.set("base", input.base);
  if (upstreamSymbols?.length) {
    url.searchParams.set("symbols", upstreamSymbols.join(","));
  }

  const response = await fetchAndValidate(
    url,
    ratesResponseSchema,
    "Frankfurter exchange-rate API",
  );

  const rates = requestedSymbols
    ? Object.fromEntries(
        requestedSymbols.flatMap((symbol) => {
          if (symbol === input.base) return [[symbol, 1]];
          const rate = response.rates[symbol];
          return rate === undefined ? [] : [[symbol, rate]];
        }),
      )
    : { ...response.rates, [input.base]: 1 };

  return { ...response, rates };
}

function dateDifferenceInDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000);
}

async function getTimeseries(input: {
  base: string;
  quote: string;
  startDate: string;
  endDate: string;
}): Promise<TimeseriesResponse> {
  const dayCount = dateDifferenceInDays(input.startDate, input.endDate);
  if (dayCount < 0) {
    throw new Error("The end date must not be earlier than the start date.");
  }
  if (dayCount > MAX_TIMESERIES_DAYS) {
    throw new Error(
      `Historical ranges are limited to ${MAX_TIMESERIES_DAYS} days per request.`,
    );
  }

  const url = new URL(
    `${FRANKFURTER_API}/${input.startDate}..${input.endDate}`,
  );
  url.searchParams.set("base", input.base);
  if (input.quote !== input.base) {
    url.searchParams.set("symbols", input.quote);
  }

  const response = await fetchAndValidate(
    url,
    timeseriesResponseSchema,
    "Frankfurter exchange-rate API",
  );

  if (input.quote === input.base) {
    response.rates = Object.fromEntries(
      Object.keys(response.rates).map((date) => [date, { [input.quote]: 1 }]),
    );
  }
  return response;
}

function registerTools(server: McpServer): void {
  server.tool(
    "fx_list_currencies",
    "List currencies supported by the ECB exchange-rate dataset with ISO 4217 codes and names.",
    {},
    async () => {
      try {
        const currencies = await fetchAndValidate(
          `${FRANKFURTER_API}/currencies`,
          currenciesResponseSchema,
          "Frankfurter exchange-rate API",
        );
        return textResult(
          JSON.stringify(
            Object.entries(currencies)
              .map(([code, name]) => ({ code, name }))
              .sort((left, right) => left.code.localeCompare(right.code)),
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(`Error listing currencies: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "fx_get_rates",
    "Get the latest or historical ECB exchange-rate snapshot for a base currency, optionally filtered by quote currencies.",
    {
      base: currencyCodeSchema.describe("Base currency code, such as EUR"),
      symbols: z
        .array(currencyCodeSchema)
        .min(1)
        .max(20)
        .optional()
        .describe("Optional quote currency codes"),
      date: dateSchema
        .optional()
        .describe("Optional historical date in YYYY-MM-DD format"),
    },
    async ({ base, symbols, date }) => {
      try {
        const response = await getRates({ base, symbols, date });
        return textResult(
          JSON.stringify(
            {
              base: response.base,
              rateDate: response.date,
              requestedDate: date ?? null,
              dateSnapped: date !== undefined && response.date !== date,
              rates: response.rates,
              ...rateProvenance,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(`Error fetching exchange rates: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "fx_get_rate",
    "Get one latest or historical ECB exchange rate for a currency pair.",
    {
      base: currencyCodeSchema.describe("Base currency code"),
      quote: currencyCodeSchema.describe("Quote currency code"),
      date: dateSchema
        .optional()
        .describe("Optional historical date in YYYY-MM-DD format"),
    },
    async ({ base, quote, date }) => {
      try {
        const response = await getRates({
          base,
          symbols: [quote],
          date,
        });
        const rate = response.rates[quote];
        if (rate === undefined) {
          throw new Error(`No ${base}/${quote} rate was returned.`);
        }
        return textResult(
          JSON.stringify(
            {
              base,
              quote,
              rate,
              rateDate: response.date,
              requestedDate: date ?? null,
              dateSnapped: date !== undefined && response.date !== date,
              ...rateProvenance,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(`Error fetching exchange rate: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "fx_convert_currency",
    "Convert an amount between ECB-supported currencies using the latest or a historical reference rate.",
    {
      amount: z.number().finite().nonnegative().max(1_000_000_000_000),
      from: currencyCodeSchema.describe("Source currency code"),
      to: currencyCodeSchema.describe("Target currency code"),
      date: dateSchema
        .optional()
        .describe("Optional historical date in YYYY-MM-DD format"),
    },
    async ({ amount, from, to, date }) => {
      try {
        const response = await getRates({
          base: from,
          symbols: [to],
          date,
        });
        const rate = response.rates[to];
        if (rate === undefined) {
          throw new Error(`No ${from}/${to} rate was returned.`);
        }
        return textResult(
          JSON.stringify(
            {
              baseAmount: amount,
              baseCurrency: from,
              quoteAmount: Number((amount * rate).toFixed(6)),
              quoteCurrency: to,
              rate,
              rateDate: response.date,
              requestedDate: date ?? null,
              dateSnapped: date !== undefined && response.date !== date,
              ...rateProvenance,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(`Error converting currency: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "fx_get_timeseries",
    `Get ECB business-day exchange rates for one currency pair over a historical range of at most ${MAX_TIMESERIES_DAYS} days.`,
    {
      base: currencyCodeSchema.describe("Base currency code"),
      quote: currencyCodeSchema.describe("Quote currency code"),
      start_date: dateSchema.describe("Inclusive start date in YYYY-MM-DD"),
      end_date: dateSchema.describe("Inclusive end date in YYYY-MM-DD"),
    },
    async ({ base, quote, start_date, end_date }) => {
      try {
        const response = await getTimeseries({
          base,
          quote,
          startDate: start_date,
          endDate: end_date,
        });
        const rates = Object.fromEntries(
          Object.entries(response.rates).flatMap(([date, values]) => {
            const rate = values[quote];
            return rate === undefined ? [] : [[date, rate]];
          }),
        );
        return textResult(
          JSON.stringify(
            {
              base,
              quote,
              requestedStartDate: start_date,
              requestedEndDate: end_date,
              actualStartDate: response.start_date,
              actualEndDate: response.end_date,
              rateCount: Object.keys(rates).length,
              rates,
              ...rateProvenance,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(
          `Error fetching historical exchange rates: ${formatError(error)}`,
        );
      }
    },
  );
}

export function createExchangeRatesMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server);
  return server;
}

async function main(): Promise<void> {
  const server = createExchangeRatesMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Exchange Rates MCP Server running on stdio");
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Fatal error starting Exchange Rates MCP Server:", error);
    process.exitCode = 1;
  });
}
