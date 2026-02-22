import { createYoga } from "graphql-yoga";
import { schema } from "@/schema";
import { authenticateRequest } from "@/auth/api-keys";
import type { Context } from "@/schema/builder";

const yoga = createYoga<{ request: Request }>({
  schema,
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  maskedErrors: false,
  context: async ({ request }): Promise<Context> => {
    const auth = await authenticateRequest(request);
    return { userId: auth?.userId ?? null };
  },
});

export async function GET(request: Request) {
  return yoga.handle(request);
}

export async function POST(request: Request) {
  return yoga.handle(request);
}
