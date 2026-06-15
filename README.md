# telegram-invite

A telegram bot to create calendar events from telegram. Others can RSVP and receive the invite in google calendar.
Without the need to authenticate with your google account.

In any chat type `@tinyinvitebot describe your event and time`.
Click on the generated message to send it.
People can RSVP and you can add it to your calendar with a button. The people who said yes will receive an invite.

## Setup

Create a bot with [BotFather](https://t.me/BotFather).
Enable inline mode with `/setinline`.

Then create a cloudflare project. Requires a database and access to AI models.

```
mise i
wrangler d1 create telegram-invite-db
```

Copy the `database_id` into `wrangler.jsonc`. Then:

```
npm run db:migrate:local
npx wrangler secret put BOT_TOKEN
npm run db:migrate:remote
npm run deploy
```

Set the webhook (replace token and worker url):

```
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://telegram-invite.<you>.workers.dev/webhook"}'
```

## Local dev

```
cp .dev.vars.example .dev.vars   # add your BOT_TOKEN
npm run dev                       # starts at localhost:8787
```

Use `cloudflared tunnel` to expose it, then point the webhook at the tunnel URL.
