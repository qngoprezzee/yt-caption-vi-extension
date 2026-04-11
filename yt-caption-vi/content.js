// content.js — injected into every youtube.com page
// Strategy: watch YouTube's own caption DOM node for text changes,
// translate each new line, display Vietnamese above the original.

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let enabled = true;
  let apiKey = '';
  let overlay = null;
  let observer = null;
  let lastText = '';
  let translateTimer = null;
  const cache = new Map(); // text → translated (session cache)

  // ─── Init ─────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['enabled', 'apiKey'], (data) => {
    enabled = data.enabled !== false;
    apiKey = data.apiKey || '';
    if (enabled) start();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue;
      enabled ? start() : stop();
    }
    if (changes.apiKey) {
      apiKey = changes.apiKey.newValue || '';
    }
  });

  // ─── Start / Stop ─────────────────────────────────────────────────────────
  function start() {
    if (observer) return;
    waitForCaptionContainer();
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    lastText = '';
  }

  // YouTube is a SPA — the caption container may not exist yet on load.
  // Poll until it appears, then attach the MutationObserver.
  function waitForCaptionContainer() {
    const CHECK_INTERVAL = 800;
    const interval = setInterval(() => {
      if (!enabled) { clearInterval(interval); return; }
      const container = getCaptionContainer();
      if (container) {
        clearInterval(interval);
        attachObserver(container);
        ensureOverlay();
      }
    }, CHECK_INTERVAL);
  }

  // ─── Caption Container Detection ──────────────────────────────────────────
  // YouTube renders captions in different elements depending on version.
  // We try several selectors in priority order.
  function getCaptionContainer() {
    const selectors = [
      '.ytp-caption-segment',          // standard captions
      '.captions-text',                // some variants
      '.ytp-caption-window-container', // fallback container
      'span.ytp-caption-segment',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // Get current caption text across all segments
  // (YouTube sometimes splits one caption line into multiple spans)
  function getCurrentCaptionText() {
    const segments = document.querySelectorAll('.ytp-caption-segment');
    if (!segments.length) return '';
    return Array.from(segments)
      .map(s => s.textContent.trim())
      .filter(Boolean)
      .join(' ');
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────
  function attachObserver(container) {
    // Watch the whole caption window for any subtree changes
    const watchTarget = document.querySelector('.ytp-caption-window-container')
      || document.querySelector('.html5-video-player')
      || document.body;

    observer = new MutationObserver(() => {
      const text = getCurrentCaptionText();
      if (text === lastText) return;
      lastText = text;

      if (!text) {
        hideOverlay();
        return;
      }

      // Debounce: wait 120ms for the caption to stabilise before translating
      clearTimeout(translateTimer);
      translateTimer = setTimeout(() => translateAndShow(text), 120);
    });

    observer.observe(watchTarget, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ─── Overlay ──────────────────────────────────────────────────────────────
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'yt-vi-overlay';
    overlay.innerHTML = `
      <div id="yt-vi-text"></div>
    `;
    document.body.appendChild(overlay);
  }

  function showOverlay(text) {
    if (!overlay) ensureOverlay();
    const el = overlay.querySelector('#yt-vi-text');
    if (el) el.textContent = text;
    overlay.classList.add('yt-vi-visible');
    overlay.classList.remove('yt-vi-hidden');
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove('yt-vi-visible');
    overlay.classList.add('yt-vi-hidden');
  }

  // ─── Translation ──────────────────────────────────────────────────────────
  async function translateAndShow(text) {
    if (!text) return;

    // Check session cache first
    if (cache.has(text)) {
      showOverlay(cache.get(text));
      return;
    }

    try {
      const translated = await translate(text);
      if (translated && translated !== text) {
        cache.set(text, translated);
        // Keep cache size bounded
        if (cache.size > 500) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        showOverlay(translated);
      }
    } catch (err) {
      console.warn('[YT-VI] Translation error:', err.message);
    }
  }

  async function translate(text) {
    // Option A: Use Google Translate API (requires key)
    if (apiKey) {
      return translateWithApiKey(text);
    }
    // Option B: Use Google Translate unofficial endpoint (no key, rate limited)
    return translateFree(text);
  }

  // Official Google Translate API — needs key from popup
  async function translateWithApiKey(text) {
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target: 'vi', source: 'en', format: 'text' }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.data.translations[0].translatedText;
  }

  // Free unofficial endpoint — no key needed, works for light usage
  async function translateFree(text) {
    const encoded = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encoded}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Free translate error ${res.status}`);
    const data = await res.json();
    // Response format: [[["translated","original",null,null,10],...],...]
    return data[0].map(item => item[0]).filter(Boolean).join('');
  }

  // ─── SPA navigation: restart when user navigates to a new video ───────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      stop();
      cache.clear();
      if (enabled) {
        setTimeout(() => waitForCaptionContainer(), 1500);
      }
    }
  }).observe(document, { subtree: true, childList: true });

})();
