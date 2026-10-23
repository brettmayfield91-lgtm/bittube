'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { register } = require('../main')

test('register wires the verified hooks and fails open when unconfigured', async () => {
  const hooks = {}; const logs = []
  const settings = { 'enable-videos': true, 'enable-comments': true }
  await register({
    registerHook: ({ target, handler }) => { hooks[target] = handler },
    registerSetting: () => {},
    settingsManager: { getSettings: async () => settings },
    storageManager: { getData: async () => null, storeData: async () => {} },
    peertubeHelpers: { logger: { info: m => logs.push(m), warn: () => {}, error: () => {} } },
    getRouter: () => ({ get: () => {} })
  })
  assert.deepStrictEqual(Object.keys(hooks).sort(), ['action:api.video-comment-reply.created', 'action:api.video-thread.created', 'action:api.video.updated', 'action:api.video.uploaded'])
  await hooks['action:api.video.uploaded']({ video: { uuid: 'u', name: 'x' } })
  await new Promise(r => setTimeout(r, 20))
  assert.ok(logs.some(l => l.includes('not configured')))
})
