import { z } from "zod";
import {
  applySessionCookie,
  getAnonymousSession,
} from "@/lib/auth/session";
import {
  createConversation,
  listConversations,
} from "@/lib/persistence/conversations";

export const runtime = "nodejs";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await getAnonymousSession(request);
    const conversations = await listConversations(session.ownerId);
    return applySessionCookie(Response.json({ conversations }), session);
  } catch (error) {
    console.error("[ERROR] Failed to list conversations:", error);
    return Response.json(
      { error: "Could not list conversations." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await getAnonymousSession(request);
    let body: unknown;

    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch {
      return applySessionCookie(
        Response.json(
          { error: "Request body must be valid JSON." },
          { status: 400 },
        ),
        session,
      );
    }

    const parsedBody = createConversationSchema.safeParse(body);
    if (!parsedBody.success) {
      return applySessionCookie(
        Response.json(
          {
            error: "Invalid conversation request.",
            issues: parsedBody.error.issues,
          },
          { status: 400 },
        ),
        session,
      );
    }

    const conversation = await createConversation(
      session.ownerId,
      parsedBody.data.title,
    );
    return applySessionCookie(
      Response.json({ conversation }, { status: 201 }),
      session,
    );
  } catch (error) {
    console.error("[ERROR] Failed to create conversation:", error);
    return Response.json(
      { error: "Could not create conversation." },
      { status: 500 },
    );
  }
}
