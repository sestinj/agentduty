import builder from "./builder";

// Import all type modules to register them with the builder
import "./user";
import "./notification";
import "./response";
import "./escalation";

export const schema = builder.toSchema();
