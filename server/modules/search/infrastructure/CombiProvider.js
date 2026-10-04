'use strict';
const { config } = require('../../../config/env');
const { AppError } = require('../../../shared/errors/AppError');
class CombiProvider {
  constructor({
    settings = config.elevenlabs,
    fetcher = (...args) => fetch(...args),
  } = {}) {
    this.settings = settings;
    this.fetcher = fetcher;
  }
  get ready() {
    return Boolean(this.settings.apiKey && this.settings.agentId);
  }
  async session() {
    const fail = () =>
      new AppError('LOUMOO Combi is unavailable. Please use text search.', {
        code: 'VOICE_UNAVAILABLE',
        statusCode: 503,
      });
    if (!this.ready) throw fail();
    try {
      const response = await this.fetcher(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.settings.agentId)}`,
        {
          headers: { 'xi-api-key': this.settings.apiKey },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!response.ok) throw fail();
      const d = await response.json(),
        url = new URL(d.signed_url);
      if (url.protocol !== 'wss:' || url.hostname !== 'api.elevenlabs.io')
        throw fail();
      return { signedUrl: d.signed_url, name: 'LOUMOO Combi' };
    } catch (_) {
      throw fail();
    }
  }
}
module.exports = { CombiProvider };
