/**
 * Centralized Application Error Handling Middleware
 * Redacts internal stack traces/PII in production and captures unhandled exceptions in Sentry
 */

const { AppError } = require('../errors/AppError');
const logger = require('../logging/logger');
const { Sentry } = require('../../clients/sentry');
const { config } = require('../../config/env');

/**
 * Some >=500 responses are the CORRECT, expected answer to a well-formed
 * request rather than a server fault: a retired endpoint pointing the client
 * at Clerk, or a capability the deployment has not been configured for. They
 * are logged at WARN without a stack so real 500s stay visible.
 */
const EXPECTED_5XX_CODES = new Set([
  'USE_CLERK_AUTHENTICATION',
  'PHONE_VERIFICATION_NOT_CONFIGURED',
  'WEBHOOK_NOT_CONFIGURED',
  'SERVICE_UNAVAILABLE'
]);

function errorHandler(err, req, res, next) {
  const requestId = req.requestId || 'req_unknown';
  const rawPath = req.originalUrl || req.path || '';
  const routePath = /^\/api\/v1\/search(?:[/?]|$)/.test(rawPath) ? rawPath.split('?')[0] : rawPath;

  // 1. Operational Domain Errors (AppError instances)
  if (err instanceof AppError) {
    if (err.statusCode >= 500 && !EXPECTED_5XX_CODES.has(err.code)) {
      logger.error(`[AppError ${err.statusCode}] ${err.message}`, err, {
        requestId,
        path: routePath,
        method: req.method,
        code: err.code
      });
      if (Sentry && Sentry.captureException) {
        Sentry.captureException(err, {
          tags: { requestId, route: routePath, code: err.code }
        });
      }
    } else {
      logger.warn(`[ClientError ${err.statusCode}] ${err.message}`, {
        requestId,
        path: routePath,
        method: req.method,
        code: err.code
      });
    }

    const expected5xx = EXPECTED_5XX_CODES.has(err.code);
    const exposeAppError = !config.isProduction || err.statusCode < 500 || expected5xx;

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: exposeAppError ? err.message : 'An unexpected internal server error occurred.',
        details: exposeAppError ? err.details : null,
        requestId
      }
    });
  }

  // 2. Syntax / JSON Parse Errors from Express Body Parser
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn('[JSONParseError] Malformed request JSON', { requestId, path: routePath });
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed request JSON payload',
        details: null,
        requestId
      }
    });
  }

  // Body-parser rejects oversized JSON, urlencoded and raw upload payloads
  // with these structured errors. Preserve the correct client-facing status
  // without echoing parser internals.
  if (err && (err.status === 413 || err.type === 'entity.too.large' || err.type === 'parameters.too.many')) {
    logger.warn('[RequestLimit] Request body exceeded the configured limit', {
      requestId,
      path: routePath,
      method: req.method
    });
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request payload exceeds the allowed size.',
        details: null,
        requestId
      }
    });
  }

  // 3. Unexpected Server Errors (500)
  logger.error('[UnhandledError] Unexpected runtime exception', err, {
    requestId,
    path: routePath,
    method: req.method
  });

  if (Sentry && Sentry.captureException) {
    Sentry.captureException(err, {
      tags: { requestId, route: routePath, unhandled: true },
      extra: { path: routePath, method: req.method }
    });
  }

  const isDev = config.isDevelopment;
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDev ? err.message : 'An unexpected internal server error occurred.',
      details: isDev ? { stack: err.stack } : null,
      requestId
    }
  });
}

module.exports = errorHandler;
