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
  let overlayWasDragged = false; // shared between makeDraggable & click handler
  const cache = new Map(); // text → translated (session cache)

  // ─── Init ─────────────────────────────────────────────────────────────────
  chrome.storage.local.get(['enabled', 'apiKey'], (data) => {
    enabled = data.enabled !== false;
    apiKey = data.apiKey || '';
    waitForPlayerButton();
    attachCaptionClickHandler();
    attachSelectionButton();
    if (enabled) start();
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
      enabled = changes.enabled.newValue;
      enabled ? start() : stop();
      updatePlayerButton();
    }
    if (changes.apiKey) {
      apiKey = changes.apiKey.newValue || '';
    }
  });

  // ─── Player Button ────────────────────────────────────────────────────────
  let playerBtn = null;

  function ensurePlayerButton() {
    if (playerBtn) return;
    const controls = document.querySelector('.ytp-right-controls');
    if (!controls) return;

    playerBtn = document.createElement('button');
    playerBtn.id = 'yt-vi-btn';
    playerBtn.title = 'Phụ đề Tiếng Việt';
    playerBtn.textContent = 'VI';
    playerBtn.className = enabled ? 'yt-vi-btn-on' : 'yt-vi-btn-off';

    playerBtn.addEventListener('click', () => {
      enabled = !enabled;
      chrome.storage.local.set({ enabled });
      // storage.onChanged triggers start()/stop(), so just update button here
      updatePlayerButton();
    });

    // Insert before the first child (leftmost in right-controls)
    controls.insertBefore(playerBtn, controls.firstChild);
  }

  function updatePlayerButton() {
    if (!playerBtn) return;
    playerBtn.className = enabled ? 'yt-vi-btn-on' : 'yt-vi-btn-off';
  }

  function waitForPlayerButton() {
    const interval = setInterval(() => {
      if (document.querySelector('.ytp-right-controls')) {
        clearInterval(interval);
        ensurePlayerButton();
      }
    }, 600);
  }

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
  const POSITION_KEY = 'yt-vi-overlay-pos';

  function getDefaultPosition() {
    return {
      left: Math.round(window.innerWidth / 2),
      top: window.innerHeight - 140,
    };
  }

  function applyPosition(pos) {
    // Clamp to viewport
    const w = overlay.offsetWidth || 300;
    const h = overlay.offsetHeight || 50;
    const x = Math.max(0, Math.min(pos.left, window.innerWidth - w));
    const y = Math.max(0, Math.min(pos.top, window.innerHeight - h));
    overlay.style.left = x + 'px';
    overlay.style.top = y + 'px';
    overlay.style.transform = '';
  }

  function makeDraggable() {
    let pending = false; // mousedown happened, waiting to see if it's a drag
    let dragging = false; // movement threshold crossed — real drag in progress
    let startX, startY, origLeft, origTop;

    overlay.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      pending = true;
      dragging = false;
      overlayWasDragged = false;
      startX = e.clientX;
      startY = e.clientY;
      origLeft = parseInt(overlay.style.left, 10) || 0;
      origTop = parseInt(overlay.style.top, 10) || 0;
      // No preventDefault — let click and text-selection events stay intact
    });

    document.addEventListener('mousemove', (e) => {
      if (!pending) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        dragging = true;
        overlayWasDragged = true;
        overlay.classList.add('yt-vi-dragging');
        window.getSelection()?.removeAllRanges();
      }
      if (dragging) applyPosition({ left: origLeft + dx, top: origTop + dy });
    });

    // Bubble phase — runs AFTER our capture-phase mouseup in attachCaptionClickHandler
    document.addEventListener('mouseup', () => {
      if (!pending) return;
      pending = false;
      if (dragging) {
        dragging = false;
        overlay.classList.remove('yt-vi-dragging');
        localStorage.setItem(POSITION_KEY, JSON.stringify({
          left: parseInt(overlay.style.left, 10),
          top: parseInt(overlay.style.top, 10),
        }));
      }
    });
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'yt-vi-overlay';
    overlay.innerHTML = `<div id="yt-vi-text"></div>`;
    document.body.appendChild(overlay);

    // Restore saved position or use default
    const saved = localStorage.getItem(POSITION_KEY);
    const pos = saved ? JSON.parse(saved) : getDefaultPosition();
    // Use rAF so offsetWidth/Height are available after first paint
    requestAnimationFrame(() => applyPosition(pos));

    makeDraggable();
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

  // ─── Word Popup ───────────────────────────────────────────────────────────
  let wordPopup = null;

  function ensureWordPopup() {
    if (wordPopup) return;
    wordPopup = document.createElement('div');
    wordPopup.id = 'yt-vi-word-popup';
    wordPopup.innerHTML = `
      <div id="yt-vi-popup-word"></div>
      <div id="yt-vi-popup-phonetic"></div>
      <div id="yt-vi-popup-translation"><span id="yt-vi-popup-loading">...</span></div>
      <div id="yt-vi-popup-definition"></div>
    `;
    document.body.appendChild(wordPopup);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideWordPopup();
    });
  }

  function showWordPopup(word, clientX, clientY, sourceLang) {
    ensureWordPopup();
    wordPopup.querySelector('#yt-vi-popup-word').textContent = word;
    wordPopup.querySelector('#yt-vi-popup-phonetic').textContent = '';
    wordPopup.querySelector('#yt-vi-popup-translation').textContent = '...';
    wordPopup.querySelector('#yt-vi-popup-definition').textContent = '';

    // Place off-screen first so we can measure dimensions, then snap into place
    wordPopup.style.left = '-9999px';
    wordPopup.style.top = '-9999px';
    wordPopup.classList.add('yt-vi-popup-visible');

    requestAnimationFrame(() => {
      const pw = wordPopup.offsetWidth;
      const ph = wordPopup.offsetHeight;
      let x = clientX - pw / 2;
      let y = clientY - ph - 16;
      x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
      if (y < 8) y = clientY + 20;
      wordPopup.style.left = x + 'px';
      wordPopup.style.top = y + 'px';
    });

    const token = word; // capture for stale-check
    fetchWordInfo(word, sourceLang).then(info => {
      // Bail if user already clicked a different word
      if (wordPopup.querySelector('#yt-vi-popup-word').textContent !== token) return;
      wordPopup.querySelector('#yt-vi-popup-phonetic').textContent = info.phonetic || '';
      wordPopup.querySelector('#yt-vi-popup-translation').textContent = info.translation || '—';
      wordPopup.querySelector('#yt-vi-popup-definition').textContent = info.definition || '';
    });
  }

  function hideWordPopup() {
    if (wordPopup) wordPopup.classList.remove('yt-vi-popup-visible');
  }

  async function fetchWordInfo(text, sourceLang) {
    const info = { translation: '', phonetic: '', definition: '' };
    const targetLang = sourceLang === 'en' ? 'vi' : 'en';
    const clean = text.trim();
    if (!clean) return info;

    const isSingleWord = !clean.includes(' ');

    await Promise.all([
      // Translation (works for single words and phrases)
      translateWord(clean, sourceLang, targetLang)
        .then(t => { if (t) info.translation = t; })
        .catch(() => {}),

      // Phonetic + definition only for single English words
      (isSingleWord && sourceLang === 'en')
        ? fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean.toLowerCase())}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (!data?.[0]) return;
              const entry = data[0];
              const p = [entry.phonetic, ...(entry.phonetics || []).map(x => x.text)].find(Boolean);
              if (p) info.phonetic = p;
              const def = entry.meanings?.[0]?.definitions?.[0]?.definition;
              if (def) info.definition = def;
            })
            .catch(() => {})
        : Promise.resolve(),
    ]);

    return info;
  }

  async function translateWord(word, sl, tl) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(word)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data[0].map(item => item[0]).filter(Boolean).join('');
  }

  function isWordChar(c) {
    return /[\wÀ-ÖØ-öø-ÿÀ-ỹ]/.test(c);
  }

  function wordFromPoint(x, y) {
    const range = document.caretRangeFromPoint(x, y);
    if (!range) return null;

    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.textContent;
    let offset = range.startOffset;

    // If we landed just past the last char, step back one
    if (offset >= text.length) offset = text.length - 1;

    // Walk backwards to word start
    let start = offset;
    while (start > 0 && isWordChar(text[start - 1])) start--;

    // Walk forwards to word end
    let end = offset;
    while (end < text.length && isWordChar(text[end])) end++;

    const word = text.slice(start, end);
    // Reject pure numbers or single chars
    if (!word || word.length < 2 || /^\d+$/.test(word)) return null;
    return word;
  }



  function sourceLangForTarget(target) {
    return target.closest('#yt-vi-overlay') ? 'vi' : 'en';
  }

  // ─── Floating "Dịch" button for text selection ────────────────────────────
  let selBtn = null;

  function ensureSelBtn() {
    if (selBtn) return;
    selBtn = document.createElement('button');
    selBtn.id = 'yt-vi-sel-btn';
    selBtn.textContent = 'Dịch';
    document.body.appendChild(selBtn);

    selBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the selection alive
      const sel = window.getSelection();
      const text = sel?.toString().trim().replace(/\s+/g, ' ') || '';
      if (!text) return;

      const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const x = rect ? (rect.left + rect.right) / 2 : e.clientX;
      const y = rect ? rect.top : e.clientY;

      const anchor = sel.anchorNode?.parentElement;
      const sl = anchor?.closest('#yt-vi-overlay') ? 'vi' : 'en';

      window.getSelection()?.removeAllRanges();
      hideSelBtn();
      showWordPopup(text, x, y, sl);
    });
  }

  function showSelBtn(x, y) {
    ensureSelBtn();
    selBtn.style.left = x + 'px';
    selBtn.style.top = y + 'px';
    selBtn.classList.add('yt-vi-sel-btn-visible');
  }

  function hideSelBtn() {
    selBtn?.classList.remove('yt-vi-sel-btn-visible');
  }

  function attachSelectionButton() {
    let timer = null;
    document.addEventListener('selectionchange', () => {
      clearTimeout(timer);
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (!text || sel.isCollapsed) { hideSelBtn(); return; }

      const anchor = sel.anchorNode?.parentElement;
      if (!anchor) { hideSelBtn(); return; }
      const inCaption = anchor.closest('.ytp-caption-window-container');
      if (!inCaption) { hideSelBtn(); return; }

      // Debounce: wait for selection to settle before showing button
      timer = setTimeout(() => {
        const range = sel.rangeCount ? sel.getRangeAt(0) : null;
        if (!range) return;
        const rect = range.getBoundingClientRect();
        showSelBtn((rect.left + rect.right) / 2, rect.top - 6);
      }, 120);
    });
  }

  function attachCaptionClickHandler() {
    // Dismiss popup on mousedown outside caption/overlay/popup
    document.addEventListener('mousedown', (e) => {
      if (!wordPopup) return;
      if (wordPopup.contains(e.target)) return;
      if (e.target.closest('.ytp-caption-window-container')) return;
      if (e.target.closest('#yt-vi-overlay')) return;
      hideWordPopup();
    }, true);

    // Single-word click on caption or overlay
    document.addEventListener('mouseup', (e) => {
      if (wordPopup && wordPopup.contains(e.target)) return;
      if (selBtn && selBtn.contains(e.target)) return;

      const inCaption = e.target.closest('.ytp-caption-window-container');
      const inOverlay = e.target.closest('#yt-vi-overlay');
      if (!inCaption && !inOverlay) return;

      if (inOverlay && overlayWasDragged) { overlayWasDragged = false; return; }

      // Ignore if user just finished a text selection — the selBtn will handle it
      const selText = window.getSelection()?.toString().trim() || '';
      if (selText.length > 1) return;

      const sl = sourceLangForTarget(e.target);
      const word = wordFromPoint(e.clientX, e.clientY);
      if (word) showWordPopup(word, e.clientX, e.clientY, sl);
    }, true);
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
      playerBtn = null; // controls DOM is rebuilt by YouTube on navigation
      setTimeout(() => {
        waitForPlayerButton();
        if (enabled) waitForCaptionContainer();
      }, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

})();
