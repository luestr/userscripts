// ==UserScript==
// @name         肉视频网广告过滤
// @name:zh-CN   肉视频网广告过滤
// @name:en      Rou.video Ad Block
// @namespace    https://github.com/luestr/userscripts
// @version      1.2.0
// @description  拦截 rou.video 的广告脚本、广告位与播放器贴片广告，仅适配 WebKit 引擎环境。
// @description:en Block ad scripts, ad slots and video preroll ads on rou.video. WebKit only.
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/adblock/rou_video_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/adblock/rou_video_adblock.user.js
// @match        https://rou.video/*
// @match        https://www.rou.video/*
// @noframes
// @run-at       document-start
// @grant        none
// @webRequest   [{"selector":"*://*.magsrv.com/*","action":"cancel"},{"selector":"*://magsrv.com/*","action":"cancel"},{"selector":"*://*.tsyndicate.com/*","action":"cancel"},{"selector":"*://tsyndicate.com/*","action":"cancel"},{"selector":"*://*.ptelastaxo.com/*","action":"cancel"},{"selector":"*://ptelastaxo.com/*","action":"cancel"},{"selector":"*://*.clammyendearedkeg.com/*","action":"cancel"},{"selector":"*://clammyendearedkeg.com/*","action":"cancel"},{"selector":"*://*.clickadu.com/*","action":"cancel"},{"selector":"*://*.clickadu.net/*","action":"cancel"},{"selector":"*://rou.video/js/clickadu.js*","action":"cancel"},{"selector":"*://www.rou.video/js/clickadu.js*","action":"cancel"},{"selector":"*://rou.video/js/hilltop.js*","action":"cancel"},{"selector":"*://www.rou.video/js/hilltop.js*","action":"cancel"},{"selector":"*://rou.video/assets/vast-client.min-*.js*","action":"cancel"},{"selector":"*://www.rou.video/assets/vast-client.min-*.js*","action":"cancel"},{"selector":"*://*.mnaspm.com/*","action":"cancel"},{"selector":"*://mnaspm.com/*","action":"cancel"},{"selector":"*://*.stripchat.com/*","action":"cancel"},{"selector":"*://stripchat.com/*","action":"cancel"},{"selector":"*://rou.video/js/stripchat.js*","action":"cancel"},{"selector":"*://www.rou.video/js/stripchat.js*","action":"cancel"}]
// ==/UserScript==

(() => {
  'use strict';

  const INSTANCE_KEY = '__rouVideoAdBlock';
  if (window[INSTANCE_KEY]?.active === true) return;

  const state = {
    active: true,
    started: false,
    observer: null,
    cleanupTimer: null,
    historyPatched: false,
    originalPushState: null,
    originalReplaceState: null,
    wrappedPushState: null,
    wrappedReplaceState: null,
  };

  const AD_HOST_RE =
    /(^|\.)(magsrv\.com|tsyndicate\.com|ptelastaxo\.com|clammyendearedkeg\.com|clickadu\.com|clickadu\.net|mnaspm\.com|stripchat\.com)$/i;
  const AD_PATH_RE =
    /\/vast(?:\.php)?(?:[?#]|$)|\/ad-provider\.js(?:[?#]|$)|\/master\.spot\.js(?:[?#]|$)|\/bn\.js(?:[?#]|$)/i;
  const FIRST_PARTY_AD_PATH_RE =
    /^\/(?:js\/(?:clickadu|hilltop|stripchat)\.js|assets\/vast-client\.min-[^/]+\.js)$/;
  const AD_SCRIPT_SRC_RE =
    /(?:clickadu|hilltop|stripchat|tsyndicate|magsrv|ptelastaxo|clammyendearedkeg|mnaspm|smartpop|ad-provider)/i;
  const AD_IFRAME_SRC_RE =
    /(?:tsyndicate|magsrv|clickadu|ptelastaxo|clammyendearedkeg|mnaspm|stripchat|smartpop)/i;
  const AD_SLOT_SELECTOR =
    '[data-cl-spot], ins[data-zoneid], #ts_ad_native_bucxq, [id^="ts_ad_"], #exo-ad-provider, #player-container';
  const AD_IMG_SELECTOR = 'img[src*="/wm:0/"], img[alt="rou.video-banner"]';
  const STYLE_ID = 'rou-video-adblock-style';
  const HOP_PATH = '/api/hop/';

  function toUrl(raw) {
    if (!raw) return null;
    try {
      return new URL(String(raw), location.href);
    } catch {
      return null;
    }
  }

  function isFirstParty(url) {
    return (
      url.hostname === 'rou.video' ||
      url.hostname === 'www.rou.video' ||
      url.hostname.endsWith('.rou.video')
    );
  }

  function isBlockedUrl(raw) {
    const url = toUrl(raw);
    if (!url) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (AD_HOST_RE.test(url.hostname)) return true;
    if (AD_PATH_RE.test(url.pathname + url.search)) return true;
    if (isFirstParty(url) && FIRST_PARTY_AD_PATH_RE.test(url.pathname)) return true;
    return false;
  }

  function installNetworkBlocking() {
    if (typeof window.fetch === 'function') {
      const nativeFetch = window.fetch;
      const patchedFetch = function patchedFetch(input) {
        let raw = '';
        if (typeof input === 'string') {
          raw = input;
        } else if (input && typeof input.url === 'string') {
          raw = input.url;
        } else if (input && typeof input.href === 'string') {
          raw = input.href;
        }
        if (isBlockedUrl(raw)) return Promise.reject(new TypeError('Blocked ad request'));
        return nativeFetch.apply(this, arguments);
      };
      try {
        window.fetch = patchedFetch;
      } catch {
        // Ignore a locked window object; the webRequest layer still applies.
      }
    }

    if (typeof XMLHttpRequest === 'function') {
      const proto = XMLHttpRequest.prototype;
      const nativeOpen = proto.open;
      const nativeSend = proto.send;
      const blockedRequests = new WeakSet();

      proto.open = function patchedOpen(method, url) {
        if (isBlockedUrl(String(url))) {
          blockedRequests.add(this);
          return;
        }
        return nativeOpen.apply(this, arguments);
      };

      proto.send = function patchedSend() {
        if (blockedRequests.has(this)) {
          window.setTimeout(() => {
            try {
              this.dispatchEvent(new ProgressEvent('error'));
            } catch {
              // The consumer may already have dropped the request.
            }
          }, 0);
          return;
        }
        return nativeSend.apply(this, arguments);
      };
    }

    if (typeof window.open === 'function') {
      const nativeWindowOpen = window.open;
      window.open = function patchedWindowOpen(url) {
        if (isBlockedUrl(url)) return null;
        return nativeWindowOpen.apply(this, arguments);
      };
    }
  }

  function installScriptSrcGuard() {
    if (typeof HTMLScriptElement !== 'function') return;
    const proto = HTMLScriptElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');

    if (descriptor && typeof descriptor.get === 'function' && typeof descriptor.set === 'function') {
      try {
        Object.defineProperty(proto, 'src', {
          configurable: descriptor.configurable !== false,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set(value) {
            if (isBlockedUrl(value)) {
              this.setAttribute('data-tm-ad-blocked', '1');
              return;
            }
            descriptor.set.call(this, value);
          },
        });
      } catch {
        // Fall back to the setAttribute guard below.
      }
    }

    const nativeSetAttribute = Element.prototype.setAttribute;
    try {
      Element.prototype.setAttribute = function patchedSetAttribute(name, value) {
        if (
          this instanceof HTMLScriptElement &&
          String(name).toLowerCase() === 'src' &&
          isBlockedUrl(value)
        ) {
          this.setAttribute('data-tm-ad-blocked', '1');
          return;
        }
        return nativeSetAttribute.apply(this, arguments);
      };
    } catch {
      // Ignore a non-configurable Element.prototype.
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [data-cl-spot],
      ins[data-zoneid],
      #ts_ad_native_bucxq,
      [id^="ts_ad_"],
      #exo-ad-provider,
      #player-container,
      img[src*="/wm:0/"],
      img[alt="rou.video-banner"],
      div:has(> a[href*="/api/hop/"]),
      iframe[src*="tsyndicate"],
      iframe[src*="magsrv"],
      iframe[src*="clickadu"],
      iframe[src*="ptelastaxo"],
      a[href*="/api/hop/"] {
        display: none !important;
      }
    `;
    parent.appendChild(style);
  }

  function isHopLink(anchor) {
    const url = toUrl(anchor.getAttribute('href'));
    return !!url && isFirstParty(url) && url.pathname.startsWith(HOP_PATH);
  }

  function findAdCell(element) {
    let node = element;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      if (
        node.classList &&
        node.classList.contains('min-w-0') &&
        node.classList.contains('grid') &&
        node.classList.contains('place-items-center')
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return element;
  }

  function findAdHopUnit(anchor) {
    if (anchor.closest('[role="dialog"]')) return anchor.parentElement || anchor;

    let node = anchor;
    for (let depth = 0; depth < 2; depth += 1) {
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      if (parent.querySelector('.rv-player')) break;
      if (parent.querySelector('a[href]:not([href*="/api/hop/"])')) break;
      node = parent;
    }
    return node;
  }

  function removeEmptyAdParent(parent) {
    if (!parent || parent === document.body || parent === document.documentElement) return;
    if (parent.children.length !== 0) return;
    let display = '';
    try {
      display = window.getComputedStyle(parent).display;
    } catch {
      display = '';
    }
    if (display.includes('grid') || display.includes('flex')) parent.remove();
  }

  function removeAdUnit(element, kind) {
    if (!element || !element.isConnected) return;
    let unit = element;
    if (kind === 'hop') {
      unit = findAdHopUnit(element);
    } else {
      unit = findAdCell(element);
    }
    const parent = unit.parentElement;
    unit.remove();
    removeEmptyAdParent(parent);
  }

  function closeAdDialog(dialog) {
    const closeButton = dialog.querySelector('[data-slot="dialog-close"]');
    if (closeButton instanceof HTMLElement) {
      closeButton.click();
      return;
    }

    dialog.remove();
    for (const overlay of document.querySelectorAll('[data-state="open"]')) {
      if (overlay === dialog || overlay.contains(dialog)) continue;
      let position = '';
      try {
        position = window.getComputedStyle(overlay).position;
      } catch {
        position = '';
      }
      if (position === 'fixed' && overlay.matches('[class*="inset-0"]')) overlay.remove();
    }
    if (document.body) document.body.style.pointerEvents = '';
  }

  function clickSkipButtons() {
    for (const button of document.querySelectorAll('.rv-player button')) {
      const text = (button.textContent || '').trim();
      if (text.includes('跳過廣告') || text.includes('跳过广告')) {
        button.click();
      }
    }
  }

  function skipVisibleAdVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.classList.contains('rv-player-video')) return;
    if (!video.closest('.rv-player')) return;
    if (!video.src && !video.currentSrc) return;

    video.muted = true;
    try {
      video.pause();
    } catch {
      // The element may already be detached.
    }
    try {
      video.dispatchEvent(new Event('ended'));
    } catch {
      // Ignore synthetic event failures.
    }
  }

  function handleVisibleAdVideos() {
    for (const player of document.querySelectorAll('.rv-player')) {
      for (const child of player.children) {
        if (child.tagName !== 'VIDEO') continue;
        if (child.classList.contains('rv-player-video')) continue;
        if (child.style.display === 'none') continue;
        skipVisibleAdVideo(child);
      }
    }
  }

  function cleanup() {
    if (!state.active) return;

    for (const script of document.querySelectorAll('script[src]')) {
      if (AD_SCRIPT_SRC_RE.test(script.src)) script.remove();
    }
    for (const script of document.querySelectorAll('script[data-tm-ad-blocked]')) {
      script.remove();
    }

    for (const slot of document.querySelectorAll(AD_SLOT_SELECTOR)) {
      if (slot.id === 'player-container') {
        slot.remove();
        continue;
      }
      removeAdUnit(slot, 'slot');
    }

    for (const frame of document.querySelectorAll('iframe[src]')) {
      if (AD_IFRAME_SRC_RE.test(frame.src)) removeAdUnit(frame, 'slot');
    }

    for (const anchor of document.querySelectorAll('a[href*="/api/hop/"]')) {
      if (!isHopLink(anchor)) continue;
      const dialog = anchor.closest('[role="dialog"]');
      removeAdUnit(anchor, 'hop');
      if (dialog) closeAdDialog(dialog);
    }

    for (const image of document.querySelectorAll(AD_IMG_SELECTOR)) {
      if (!image.isConnected) continue;
      const anchor = image.closest('a[href*="/api/hop/"]');
      if (anchor) {
        const dialog = anchor.closest('[role="dialog"]');
        removeAdUnit(anchor, 'hop');
        if (dialog) closeAdDialog(dialog);
      } else {
        image.remove();
      }
    }

    clickSkipButtons();
    handleVisibleAdVideos();
  }

  function scheduleCleanup() {
    if (!state.active || state.cleanupTimer !== null) return;
    state.cleanupTimer = window.setTimeout(() => {
      state.cleanupTimer = null;
      cleanup();
    }, 60);
  }

  function onAdClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target ? target.closest('a[href]') : null;
    if (!anchor || !isHopLink(anchor)) return;
    event.preventDefault();
    event.stopPropagation();
    removeAdUnit(anchor, 'hop');
    scheduleCleanup();
  }

  function onAdPlay(event) {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.classList.contains('rv-player-video')) return;
    if (!video.closest('.rv-player')) return;
    if (!video.src && !video.currentSrc) return;
    window.setTimeout(() => skipVisibleAdVideo(video), 30);
  }

  function patchHistory() {
    if (state.historyPatched) return;
    state.originalPushState = history.pushState;
    state.originalReplaceState = history.replaceState;

    state.wrappedPushState = function wrappedPushState(...args) {
      const result = state.originalPushState.apply(this, args);
      scheduleCleanup();
      return result;
    };
    state.wrappedReplaceState = function wrappedReplaceState(...args) {
      const result = state.originalReplaceState.apply(this, args);
      scheduleCleanup();
      return result;
    };

    history.pushState = state.wrappedPushState;
    history.replaceState = state.wrappedReplaceState;
    state.historyPatched = true;
  }

  function onPopState() {
    scheduleCleanup();
  }

  function start() {
    if (!state.active || state.started) return;
    state.started = true;

    ensureStyle();
    document.addEventListener('click', onAdClick, true);
    document.addEventListener('auxclick', onAdClick, true);
    document.addEventListener('play', onAdPlay, true);
    window.addEventListener('popstate', onPopState);
    patchHistory();

    if (document.documentElement) {
      state.observer = new MutationObserver(scheduleCleanup);
      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    cleanup();
  }

  function stop() {
    if (!state.active) return;
    state.active = false;
    record.active = false;

    state.observer?.disconnect();
    state.observer = null;
    if (state.cleanupTimer !== null) window.clearTimeout(state.cleanupTimer);
    state.cleanupTimer = null;

    document.removeEventListener('click', onAdClick, true);
    document.removeEventListener('auxclick', onAdClick, true);
    document.removeEventListener('play', onAdPlay, true);
    window.removeEventListener('popstate', onPopState);

    if (state.historyPatched) {
      if (history.pushState === state.wrappedPushState) history.pushState = state.originalPushState;
      if (history.replaceState === state.wrappedReplaceState) {
        history.replaceState = state.originalReplaceState;
      }
      state.historyPatched = false;
    }

    document.getElementById(STYLE_ID)?.remove();
    if (window[INSTANCE_KEY] === record) delete window[INSTANCE_KEY];
  }

  const record = { active: true, stop };
  window[INSTANCE_KEY] = record;

  installNetworkBlocking();
  installScriptSrcGuard();

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) stop();
  });
})();
