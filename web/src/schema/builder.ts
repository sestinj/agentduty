import SchemaBuilder from "@pothos/core";

export interface Context {
  userId: string | null;
}

const builder = new SchemaBuilder<{
  Context: Context;
}>({});

builder.queryType({});
builder.mutationType({});

export default builder;
