import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  fetchAndValidate,
  formatError,
  isDirectExecution,
  textResult,
} from "./shared";

const SERVER_NAME = "weather-mcp-server";
const SERVER_VERSION = "1.0.0";
const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

const locationSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
});

const geocodingResponseSchema = z.object({
  results: z.array(locationSchema).optional(),
});

const currentWeatherSchema = z.object({
  time: z.string(),
  temperature_2m: z.number().nullable(),
  apparent_temperature: z.number().nullable(),
  relative_humidity_2m: z.number().nullable(),
  precipitation: z.number().nullable(),
  weather_code: z.number().int().nullable(),
  cloud_cover: z.number().nullable(),
  wind_speed_10m: z.number().nullable(),
});

const forecastResponseSchema = z.object({
  timezone: z.string(),
  timezone_abbreviation: z.string().optional(),
  current: currentWeatherSchema,
  current_units: z.record(z.string(), z.string()),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().int().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    sunrise: z.array(z.string()),
    sunset: z.array(z.string()),
  }),
  daily_units: z.record(z.string(), z.string()),
});

type Location = z.infer<typeof locationSchema>;
type ForecastResponse = z.infer<typeof forecastResponseSchema>;

const locationInput = {
  city: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("City name, such as Sydney, London, or Tokyo"),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .optional()
    .describe("Optional ISO 3166-1 alpha-2 country code, such as AU or US"),
};

const weatherDescriptions: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeather(code: number | null): string {
  return code === null
    ? "Unknown"
    : (weatherDescriptions[code] ?? `Weather code ${code}`);
}

function formatLocation(location: Location): string {
  return [location.name, location.admin1, location.country]
    .filter(Boolean)
    .join(", ");
}

async function resolveLocation(
  city: string,
  countryCode?: string,
): Promise<Location> {
  const url = new URL(GEOCODING_API);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  if (countryCode) url.searchParams.set("countryCode", countryCode);

  const response = await fetchAndValidate(
    url,
    geocodingResponseSchema,
    "Open-Meteo geocoding API",
  );
  const location = response.results?.[0];
  if (!location) {
    throw new Error(`No weather location found for "${city}".`);
  }
  return location;
}

async function fetchWeather(
  location: Location,
  forecastDays: number,
): Promise<ForecastResponse> {
  const url = new URL(FORECAST_API);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "wind_speed_10m",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "sunrise",
      "sunset",
    ].join(","),
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", String(forecastDays));

  return fetchAndValidate(url, forecastResponseSchema, "Open-Meteo forecast API");
}

function currentWeatherResult(
  location: Location,
  weather: ForecastResponse,
) {
  const units = weather.current_units;
  return {
    location: formatLocation(location),
    coordinates: {
      latitude: location.latitude,
      longitude: location.longitude,
    },
    timezone: weather.timezone,
    observedAt: weather.current.time,
    conditions: describeWeather(weather.current.weather_code),
    temperature: `${weather.current.temperature_2m} ${units.temperature_2m ?? ""}`.trim(),
    feelsLike: `${weather.current.apparent_temperature} ${units.apparent_temperature ?? ""}`.trim(),
    humidity: `${weather.current.relative_humidity_2m} ${units.relative_humidity_2m ?? ""}`.trim(),
    precipitation: `${weather.current.precipitation} ${units.precipitation ?? ""}`.trim(),
    cloudCover: `${weather.current.cloud_cover} ${units.cloud_cover ?? ""}`.trim(),
    windSpeed: `${weather.current.wind_speed_10m} ${units.wind_speed_10m ?? ""}`.trim(),
  };
}

function dailyForecastResult(weather: ForecastResponse) {
  return weather.daily.time.map((date, index) => ({
    date,
    conditions: describeWeather(weather.daily.weather_code[index] ?? null),
    temperatureMax: weather.daily.temperature_2m_max[index] ?? null,
    temperatureMin: weather.daily.temperature_2m_min[index] ?? null,
    temperatureUnit: weather.daily_units.temperature_2m_max,
    precipitationProbability:
      weather.daily.precipitation_probability_max[index] ?? null,
    precipitationProbabilityUnit:
      weather.daily_units.precipitation_probability_max,
    sunrise: weather.daily.sunrise[index],
    sunset: weather.daily.sunset[index],
  }));
}

function registerTools(server: McpServer): void {
  server.tool(
    "get-current-weather",
    "Get current weather for a city worldwide. Ask the user for their city if they have not provided one.",
    locationInput,
    async ({ city, countryCode }) => {
      try {
        const location = await resolveLocation(city, countryCode);
        const weather = await fetchWeather(location, 1);
        return textResult(
          JSON.stringify(currentWeatherResult(location, weather), null, 2),
        );
      } catch (error) {
        return textResult(`Error fetching weather: ${formatError(error)}`);
      }
    },
  );

  server.tool(
    "get-weather-forecast",
    "Get a daily weather forecast for a city worldwide. Ask the user for their city if they have not provided one.",
    {
      ...locationInput,
      forecastDays: z
        .number()
        .int()
        .min(1)
        .max(7)
        .default(5)
        .describe("Number of forecast days from 1 to 7"),
    },
    async ({ city, countryCode, forecastDays }) => {
      try {
        const location = await resolveLocation(city, countryCode);
        const weather = await fetchWeather(location, forecastDays);
        return textResult(
          JSON.stringify(
            {
              location: formatLocation(location),
              timezone: weather.timezone,
              forecast: dailyForecastResult(weather),
            },
            null,
            2,
          ),
        );
      } catch (error) {
        return textResult(`Error fetching forecast: ${formatError(error)}`);
      }
    },
  );
}

export function createWeatherMcpServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerTools(server);
  return server;
}

async function main(): Promise<void> {
  const server = createWeatherMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Weather MCP Server running on stdio");
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error("Fatal error starting Weather MCP Server:", error);
    process.exitCode = 1;
  });
}
