'use strict'

const { buildVideoText, buildCommentText, parseThreshold, decide, classify } = require('./lib/classifier')

const FLAGS_KEY = 'flags'
const MAX_FLAGS = 500

async function register ({ registerHook, registerSetting, settingsManager, storageManager, peertubeHelpers, getRouter }) {
  const logger = peertubeHelpers.logger

  registerSetting({ name: 'api-base-url', label: 'OpenAI-compatible API base URL', type: 'input', default: 'https://api.openai.com/v1', private: true })
  registerSetting({ name: 'api-key', label: 'API key', type: 'input-password', private: true })
  registerSetting({ name: 'model', label: 'Model', type: 'input', default: 'gpt-4o-mini', private: true })
  registerSetting({ name: 'threshold', label: 'Confidence threshold (0 to 1)', type: 'input', default: '0.8', private: true })
  registerSetting({ name: 'enable-videos', label: 'Check new and updated local videos', type: 'input-checkbox', default: true, private: true })
  registerSetting({ name: 'enable-comments', label: 'Check new local comments', type: 'input-checkbox', default: true, private: true })
  registerSetting({ name: 'blacklist-flagged-videos', label: 'Also hide flagged videos (blacklist, reversible) until an admin reviews', type: 'input-checkbox', default: false, private: true })
  registerSetting({ name: 'notify-email', label: 'Email address to notify on flags (optional)', type: 'input', private: true })

  async function getConfig () {
    const s = await settingsManager.getSettings(['api-base-url', 'api-key', 'model', 'threshold', 'enable-videos', 'enable-comments', 'blacklist-flagged-videos', 'notify-email'])
    return { ...s, threshold: parseThreshold(s.threshold) }
  }

  async function recordFlag (entry) {
    const flags = (await storageManager.getData(FLAGS_KEY)) || []
    flags.unshift(entry)
    await storageManager.storeData(FLAGS_KEY, flags.slice(0, MAX_FLAGS))
  }

  async function review (kind, id, url, text, extra) {
    const cfg = await getConfig()
    if (!cfg['api-key'] || !cfg['api-base-url'] || !cfg.model) {
      logger.info(`bittube-moderation: not configured, skipping ${kind} ${id}`)
      return
    }
    const result = await classify({ baseUrl: cfg['api-base-url'], apiKey: cfg['api-key'], model: cfg.model, text, logger })
    const decision = decide(result, cfg.threshold)
    logger.info('bittube-moderation decision ' + JSON.stringify({ kind, id, url, decision, result, threshold: cfg.threshold }))
    if (decision.action !== 'flag') return

    await recordFlag({ kind, id, url, result, at: new Date().toISOString() })

    if (kind === 'video' && cfg['blacklist-flagged-videos']) {
      await peertubeHelpers.moderation.blacklistVideo({
        videoIdOrUUID: id,
        createOptions: { reason: 'Held for review by BitTube AI moderation', unfederate: false, internalNote: JSON.stringify(result) }
      })
    }
    if (cfg['notify-email']) {
      await peertubeHelpers.email.createJob({
        to: { email: cfg['notify-email'] },
        subject: `BitTube moderation: ${kind} flagged for review`,
        title: `${kind} flagged for review`,
        text: `Categories: ${result.categories.join(', ')}\nConfidence: ${result.confidence}\nReason: ${result.reason}\n${url || ''}`
      })
    }
  }

  // Run in background so hooks never block or fail user actions (fail open).
  function runSafely (fn) {
    Promise.resolve().then(fn).catch(err => logger.error('bittube-moderation error (ignored): ' + (err && err.message)))
  }

  async function onVideo ({ video }) {
    if (!video || video.remote) return
    if (!(await getConfig())['enable-videos']) return
    runSafely(() => review('video', video.uuid || video.id, video.url, buildVideoText(video)))
  }

  async function onComment ({ comment }) {
    if (!comment) return // these API hooks only fire for comments posted on this instance
    if (!(await getConfig())['enable-comments']) return
    runSafely(() => review('comment', comment.id, comment.url, buildCommentText(comment)))
  }

  registerHook({ target: 'action:api.video.uploaded', handler: onVideo })
  registerHook({ target: 'action:api.video.updated', handler: onVideo })
  registerHook({ target: 'action:api.video-thread.created', handler: onComment })
  registerHook({ target: 'action:api.video-comment-reply.created', handler: onComment })

  // Admin/moderator review queue: GET /plugins/bittube-moderation/router/flags
  const router = getRouter()
  router.get('/flags', async (req, res) => {
    const user = await peertubeHelpers.user.getAuthUser(res)
    if (!user || ![0, 1].includes(user.role)) return res.sendStatus(403)
    res.json((await storageManager.getData(FLAGS_KEY)) || [])
  })
}

async function unregister () {}

module.exports = { register, unregister }
