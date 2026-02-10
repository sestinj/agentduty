import builder from "./builder";

const ResponseType = builder.objectRef<{
  id: string;
  notificationId: string;
  channel: string;
  text: string | null;
  selectedOption: string | null;
  responderId: string;
  createdAt: Date;
}>("Response");

ResponseType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    notificationId: t.exposeString("notificationId"),
    channel: t.exposeString("channel"),
    text: t.exposeString("text", { nullable: true }),
    selectedOption: t.exposeString("selectedOption", { nullable: true }),
    responderId: t.exposeString("responderId"),
    createdAt: t.string({
      resolve: (r) => r.createdAt.toISOString(),
    }),
  }),
});

export { ResponseType };
