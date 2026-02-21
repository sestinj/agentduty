import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  time,
  pgEnum,
} from "drizzle-orm/pg-core";

export const channelEnum = pgEnum("channel", ["slack", "sms"]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "delivered",
  "responded",
  "expired",
]);

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  phone: text("phone"),
  slackUserId: text("slack_user_id"),
  slackTeamId: text("slack_team_id"),
  timezone: text("timezone").default("UTC"),
  quietHoursStart: time("quiet_hours_start"),
  quietHoursEnd: time("quiet_hours_end"),
  workosUserId: text("workos_user_id").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  name: text("name").notNull(),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const escalationPolicies = pgTable("escalation_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const escalationSteps = pgTable("escalation_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => escalationPolicies.id),
  stepOrder: integer("step_order").notNull(),
  channel: channelEnum("channel").notNull(),
  delaySeconds: integer("delay_seconds").notNull(),
});

export const priorityRoutes = pgTable("priority_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  priority: integer("priority").notNull(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => escalationPolicies.id),
});

export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  sessionKey: text("session_key").notNull(),
  workspace: text("workspace"),
  slackThreadTs: text("slack_thread_ts"),
  slackChannelId: text("slack_channel_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  shortCode: text("short_code").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  sessionId: uuid("session_id").references(() => agentSessions.id),
  message: text("message").notNull(),
  priority: integer("priority").notNull().default(3),
  context: jsonb("context"),
  tags: text("tags").array(),
  options: text("options").array(),
  status: notificationStatusEnum("status").notNull().default("pending"),
  currentEscalationStep: integer("current_escalation_step").default(0),
  policyId: uuid("policy_id").references(() => escalationPolicies.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id")
    .notNull()
    .references(() => notifications.id),
  channel: channelEnum("channel").notNull(),
  status: deliveryStatusEnum("status").notNull().default("pending"),
  externalId: text("external_id"),
  metadata: jsonb("metadata"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const responses = pgTable("responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  notificationId: uuid("notification_id")
    .notNull()
    .references(() => notifications.id),
  channel: channelEnum("channel").notNull(),
  text: text("text"),
  selectedOption: text("selected_option"),
  externalId: text("external_id"),
  responderId: uuid("responder_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
