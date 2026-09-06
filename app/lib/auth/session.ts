import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_COOKIE_NAME = "astra_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const LOCAL_SECRET_PATH = path.join(process.cwd(), ".data", "session-secret");
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let secretPromise: Promise<string> | undefined;

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function validateSecret(secret: string): string {
  if (secret.length < 32) {
    throw new Error("Session secret must contain at least 32 characters.");
  }
  return secret;
}

async function loadLocalSecret(): Promise<string> {
  try {
    return validateSecret((await readFile(LOCAL_SECRET_PATH, "utf8")).trim());
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(path.dirname(LOCAL_SECRET_PATH), { recursive: true });
  const generatedSecret = randomBytes(48).toString("base64url");

  try {
    await writeFile(LOCAL_SECRET_PATH, generatedSecret, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return validateSecret(generatedSecret);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
    return validateSecret((await readFile(LOCAL_SECRET_PATH, "utf8")).trim());
  }
}

async function getSessionSecret(): Promise<string> {
  if (process.env.SESSION_SECRET) {
    return validateSecret(process.env.SESSION_SECRET);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }

  secretPromise ??= loadLocalSecret();
  return secretPromise;
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const cookie of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");
    if (cookieName === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return undefined;
}

function verifySessionCookie(
  cookieValue: string | undefined,
  secret: string,
): string | undefined {
  if (!cookieValue) return undefined;

  const [ownerId, issuedAtValue, suppliedSignature, extra] =
    cookieValue.split(".");
  if (
    !ownerId ||
    !UUID_PATTERN.test(ownerId) ||
    !issuedAtValue ||
    !suppliedSignature ||
    extra
  ) {
    return undefined;
  }

  const issuedAt = Number(issuedAtValue);
  const ageSeconds = Math.floor(Date.now() / 1000) - issuedAt;
  if (
    !Number.isSafeInteger(issuedAt) ||
    ageSeconds < 0 ||
    ageSeconds > SESSION_MAX_AGE_SECONDS
  ) {
    return undefined;
  }

  const payload = `${ownerId}.${issuedAtValue}`;
  const expectedSignature = signPayload(payload, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const suppliedBuffer = Buffer.from(suppliedSignature);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return undefined;
  }

  return ownerId;
}

function serializeSessionCookie(ownerId: string, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${ownerId}.${issuedAt}`;
  const value = `${payload}.${signPayload(payload, secret)}`;
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export type AnonymousSession = {
  ownerId: string;
  setCookie?: string;
};

export async function getAnonymousSession(
  request: Request,
): Promise<AnonymousSession> {
  const secret = await getSessionSecret();
  const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
  const existingOwnerId = verifySessionCookie(cookieValue, secret);

  if (existingOwnerId) {
    return { ownerId: existingOwnerId };
  }

  const ownerId = randomUUID();
  return {
    ownerId,
    setCookie: serializeSessionCookie(ownerId, secret),
  };
}

export function applySessionCookie(
  response: Response,
  session: AnonymousSession,
): Response {
  if (session.setCookie) {
    response.headers.append("set-cookie", session.setCookie);
  }
  return response;
}
