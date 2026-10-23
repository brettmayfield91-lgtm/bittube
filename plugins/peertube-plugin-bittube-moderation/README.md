# peertube-plugin-bittube-moderation

BitTube's AI moderation agent, as a standard PeerTube server plugin. It sends the title, description and tags of new or updated local videos, and the text of new local comments, to an OpenAI-compatible chat completions API. If the model flags the content at or above your confidence threshold, the item goes to a review queue for admins.

It never deletes content and never bans anyone. If the API is unconfigured, slow or down, it does nothing (fails open) and never blocks uploads or comments.

## Install

From the BitTube/PeerTube server directory:

```
cd /var/www/peertube/peertube-latest
sudo -u peertube NODE_CONFIG_DIR=/var/www/peertube/config NODE_ENV=production npm run plugin:install -- --plugin-path /path/to/bittube/plugins/peertube-plugin-bittube-moderation
```

Restart PeerTube, then open Administration > Plugins/Themes > Installed > bittube-moderation > Settings.

## Settings

All settings are private (server-side only).

| Setting | Default | Notes |
| --- | --- | --- |
| API base URL | `https://api.openai.com/v1` | Any OpenAI-compatible endpoint, including self-hosted (vLLM, Ollama, LiteLLM) |
| API key | empty | Required; the plugin stays idle without it |
| Model | `gpt-4o-mini` | |
| Confidence threshold | `0.8` | 0 to 1; invalid values fall back to 0.8 |
| Check videos / Check comments | on | |
| Hide flagged videos | off | Uses the reversible video blacklist until an admin reviews |
| Notify email | empty | Sends an email per flag |

## Review queue

Admins and moderators can read recent flags (newest first, last 500) at:

`GET /plugins/bittube-moderation/router/flags` (with an admin or moderator OAuth token)

Every decision, flagged or not, is written to the PeerTube log with the prefix `bittube-moderation decision`.

## Hooks used

Verified against `packages/models/src/plugins/server/server-hook.model.ts`:
`action:api.video.uploaded`, `action:api.video.updated`, `action:api.video-thread.created`, `action:api.video-comment-reply.created`.

## Limitations

- The plugin API has no helper to create abuse reports, so flags go to the plugin's own queue (plus optional email and optional reversible blacklist) instead of PeerTube's Reports page.
- The plugin API has no way to hold a comment for approval. Comments are classified after posting and flagged only. Use PeerTube's built-in comment approval and watched words for holding.
- Remote (federated) content is not checked.

## Tests

```
npm test
```

Runs Node's built-in test runner on the classification and threshold logic; no PeerTube needed.

## License

AGPL-3.0, same as BitTube and PeerTube.
