import { graphql, type ExecutionResult } from "graphql";
import { schema } from "./index";

export async function executeGraphQL(
  source: string,
  contextValue: { userId: string | null },
): Promise<ExecutionResult> {
  return graphql({ schema, source, contextValue });
}
