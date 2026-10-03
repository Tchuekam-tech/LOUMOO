/**
 * Vercel Web Analytics Integration
 * 
 * Initializes Vercel Web Analytics for the LOUMOO platform.
 * This script loads the analytics tracking code which sends pageview
 * events to Vercel's analytics endpoint.
 * 
 * Implementation follows the official @vercel/analytics package approach
 * adapted for vanilla JavaScript (non-module) usage.
 * 
 * Documentation: https://vercel.com/docs/analytics/quickstart
 */

(function() {
  'use strict';

  // Queue for analytics events before script loads
  function initQueue() {
    if (window.va) return;
    window.va = function a(...params) {
      if (!window.vaq) window.vaq = [];
      window.vaq.push(params);
    };
  }

  // Detect environment
  function detectEnvironment() {
    try {
      const env = process?.env?.NODE_ENV;
      if (env === 'development' || env === 'test') {
        return 'development';
      }
    } catch {
      // In browser, assume production unless on localhost
      if (window.location.hostname === 'localhost' || 
          window.location.hostname === '127.0.0.1') {
        return 'development';
      }
    }
    return 'production';
  }

  function setMode(mode = 'auto') {
    if (mode === 'auto') {
      window.vam = detectEnvironment();
      return;
    }
    window.vam = mode;
  }

  function getMode() {
    const mode = window.vam || detectEnvironment();
    return mode || 'production';
  }

  function isDevelopment() {
    return getMode() === 'development';
  }

  // Get the appropriate script source based on environment
  function getScriptSrc() {
    if (isDevelopment()) {
      return 'https://va.vercel-scripts.com/v1/script.debug.js';
    }
    return '/_vercel/insights/script.js';
  }

  // Inject Vercel Analytics script
  function injectAnalytics() {
    if (typeof window === 'undefined') return;

    // Initialize the queue
    initQueue();
    setMode('auto');

    const src = getScriptSrc();
    
    // Don't inject twice
    if (document.head.querySelector(`script[src*="${src}"]`)) {
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    
    // Set data attributes for the SDK
    script.dataset.sdkn = '@vercel/analytics';
    script.dataset.sdkv = '2.0.1';
    
    script.defer = true;
    script.onerror = () => {
      const errorMessage = isDevelopment() 
        ? 'Please check if any ad blockers are enabled and try again.'
        : 'Be sure to enable Web Analytics for your project and deploy again. See https://vercel.com/docs/analytics/quickstart for more information.';
      console.log(
        `[Vercel Web Analytics] Failed to load script from ${src}. ${errorMessage}`
      );
    };
    
    document.head.appendChild(script);
  }

  // Initialize on DOMContentLoaded or immediately if DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectAnalytics);
  } else {
    injectAnalytics();
  }
})();
