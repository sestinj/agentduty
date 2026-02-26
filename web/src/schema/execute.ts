import { graphql, type ExecutionResult } from "graphql";
import { schema } from "./index";

/**
 * Execute a GraphQL query against the schema.
 * Used by tests to avoid graphql module duplication issues in Vite.
 */
export async function executeGraphQL(
  source: string,
  contextValue: { userId: string | null },
): Promise<ExecutionResult> {
  return graphql({ schema, source, contextValue });
}
