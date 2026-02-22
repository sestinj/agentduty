# AgentDuty Development

## Communicating via AgentDuty

When having a conversation with the user through AgentDuty (Slack), you MUST always maintain a background listener so you can receive replies:

1. After sending a notification with `notify`, immediately start a background poll:
   ```
   agentduty poll <SHORT_CODE> --wait --timeout 30m
   ```
   Run this in the background so you get notified when the response arrives.

2. The poll watches the **entire session**, not just one notification. It exits as soon as ANY new response arrives in the session (including follow-up messages to earlier notifications). When it completes, immediately process the response and start a new poll. This creates a loop:
   - Send notification → start poll → response arrives → poll exits → handle response → start new poll

3. When a poll returns with new responses, acknowledge receipt with `agentduty react <shortCode> -e <emoji>`. You can target a specific response with `-r <index>` (1-based). The poll output shows the index for each response. Choose an emoji that fits the context — use your judgment (e.g. "eyes" for "take a look at this", "white_check_mark" for confirming you'll do something, "raised_hands" for good news). Don't default to thumbsup for everything.

4. NEVER let a poll timeout without starting a new one. If a poll times out, restart it immediately. Losing contact means the user has to come rescue you manually.

5. Keep messages concise. Slack truncates messages behind a "See more" toggle at ~700 characters. Stay under this limit when possible — be direct, skip filler, use short bullet points. If you truly need more space, it's okay to go over, but prefer brevity.

5. The CLI binary is at `/tmp/agentduty`. If it doesn't exist, build it:
   ```
   cd cli && go build -o /tmp/agentduty .
   ```

## Deploying

- The web app deploys to Vercel. Always deploy from the `web/` directory:
  ```
  cd web && npx vercel --prod
  ```
  Deploying from the repo root will fail (Vercel can't find the `app` directory).

- The Slack Events API URL must use `www.agentduty.dev` (not `agentduty.dev`) to avoid a 307 redirect that breaks event delivery.

## Viewing Slack Messages Directly

The Slack CLI at `/Users/nate/gh/continuedev/remote-config-server/clis/slack/slack` is authed as the AgentDuty bot. Use it to read threads and verify message delivery:
```
slack messages list D0AE5S6BW76 --limit 10
curl -s "https://slack.com/api/conversations.replies?channel=D0AE5S6BW76&ts=THREAD_TS" -H "Authorization: Bearer $(jq -r .token ~/.config/slack/config.json)"
```

## Viewing Images from Slack

Use a sub-agent to download and view Slack file attachments. Do NOT try to view them directly — this can crash the session. The bot token has `files:read` scope.
