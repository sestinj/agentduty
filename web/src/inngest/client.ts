import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "agentduty",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
