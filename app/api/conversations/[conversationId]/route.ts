import { z } from "zod";
import {
  applySessionCookie,
  getAnonymousSession,
  type AnonymousSession,
} from "@/lib/auth/session";
import {
  ConversationNotFoundError,
  deleteConversation,
  getConversation,
  setConversationArchived,
} from "@/lib/persistence/conversations";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

const conversationIdSchema = z.string().uuid();
const updateConversationSchema = z.object({
  archived: z.boolean(),
});

function errorResponse(
  error: unknown,
  session: AnonymousSession,
): Response {
  if (error instanceof ConversationNotFoundError) {
    return applySessionCookie(
      Response.json({ error: error.message }, { status: 404 }),
      session,
    );
  }

  console.error("[ERROR] Conversation operation failed:", error);
  return applySessionCookie(
    Response.json(
      { error: "Could not complete the conversation operation." },
      { status: 500 },
    ),
    session,
  );
}

async function parseConversationId(
  context: RouteContext,
): Promise<string | null> {
  const { conversationId } = await context.params;
  const parsedId = conversationIdSchema.safeParse(conversationId);
  return parsedId.success ? parsedId.data : null;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const session = await getAnonymousSession(request);
  const conversationId = await parseConversationId(context);
  if (!conversationId) {
    return applySessionCookie(
      Response.json({ error: "Invalid conversation ID." }, { status: 400 }),
      session,
    );
  }

  try {
    const conversation = await getConversation(
      session.ownerId,
      conversationId,
    );
    return applySessionCookie(Response.json({ conversation }), session);
  } catch (error) {
    return errorResponse(error, session);
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const session = await getAnonymousSession(request);
  const conversationId = await parseConversationId(context);
  if (!conversationId) {
    return applySessionCookie(
      Response.json({ error: "Invalid conversation ID." }, { status: 400 }),
      session,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applySessionCookie(
      Response.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
      session,
    );
  }

  const parsedBody = updateConversationSchema.safeParse(body);
  if (!parsedBody.success) {
    return applySessionCookie(
      Response.json(
        { error: "The archived field must be a boolean." },
        { status: 400 },
      ),
      session,
    );
  }

  try {
    const conversation = await setConversationArchived(
      session.ownerId,
      conversationId,
      parsedBody.data.archived,
    );
    return applySessionCookie(Response.json({ conversation }), session);
  } catch (error) {
    return errorResponse(error, session);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const session = await getAnonymousSession(request);
  const conversationId = await parseConversationId(context);
  if (!conversationId) {
    return applySessionCookie(
      Response.json({ error: "Invalid conversation ID." }, { status: 400 }),
      session,
    );
  }

  try {
    await deleteConversation(session.ownerId, conversationId);
    return applySessionCookie(new Response(null, { status: 204 }), session);
  } catch (error) {
    return errorResponse(error, session);
  }
}
