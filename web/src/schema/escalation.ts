import builder from "./builder";

const EscalationStepType = builder.objectRef<{
  id: string;
  policyId: string;
  stepOrder: number;
  channel: string;
  delaySeconds: number;
}>("EscalationStep");

EscalationStepType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    policyId: t.exposeString("policyId"),
    stepOrder: t.exposeInt("stepOrder"),
    channel: t.exposeString("channel"),
    delaySeconds: t.exposeInt("delaySeconds"),
  }),
});

const EscalationPolicyType = builder.objectRef<{
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  steps?: Array<{
    id: string;
    policyId: string;
    stepOrder: number;
    channel: string;
    delaySeconds: number;
  }>;
}>("EscalationPolicy");

EscalationPolicyType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    userId: t.exposeString("userId"),
    name: t.exposeString("name"),
    isDefault: t.exposeBoolean("isDefault"),
    createdAt: t.string({
      resolve: (p) => p.createdAt.toISOString(),
    }),
    steps: t.field({
      type: [EscalationStepType],
      resolve: (policy) => policy.steps ?? [],
    }),
  }),
});

export { EscalationPolicyType, EscalationStepType };
