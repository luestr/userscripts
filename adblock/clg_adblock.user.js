// ==UserScript==
// @name         磁力狗广告过滤
// @name:zh-CN   磁力狗广告过滤
// @name:en      CiliGou Ad Block
// @namespace    https://github.com/luestr/userscripts
// @version      1.0.0
// @description  过滤 clg63.top 搜索页与详情页广告，优先拦截请求、其次清理页面，仅适配 WebKit 引擎环境。
// @description:en Block ads on clg63.top search and detail pages with request blocking first and DOM cleanup as fallback. WebKit only.
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/adblock/clg63_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/adblock/clg63_adblock.user.js
// @match        https://clg63.top/*
// @run-at       document-start
// @grant        none
// @webRequest   [{"selector":"*://s3.filej.xyz/chart.js*","action":"cancel"},{"selector":"*://s3.filej.xyz/go.js*","action":"cancel"},{"selector":"*://*.mehqk5u.com/*","action":"cancel"},{"selector":"*://*.smun7ro.com/*","action":"cancel"},{"selector":"*://*.h87lorh.com/*","action":"cancel"},{"selector":"*://g.oljiock.cn/*","action":"cancel"}]
// ==/UserScript==

(() => {
  'use strict';

  if (window.__clg63Adblock) return;
  window.__clg63Adblock = true;

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[clg63-adblock]', ...args); };

  // 广告脚本与落地页所在的域名；fileh.xyz 只承载广告图片。
  const AD_HOST_RE = /(?:^|\.)(?:mehqk5u\.com|smun7ro\.com|h87lorh\.com|oljiock\.cn|fileh\.xyz)$/i;
  // 广告脚本通过 insertAdjacentHTML 注入的横幅/弹窗特征。
  const AD_HTML_RE = /cps-wrap|asset\.3400\.org\/txt|img\.fileh\.xyz|s3\.filej\.xyz\/(?:chart|go)\.js|bus-modal|网址屏蔽提醒|mehqk5u|smun7ro|h87lorh|oljiock/i;
  // 广告脚本写入 <style> 的样式特征（含随机 id，因此按内容识别）。
  const AD_STYLE_RE = /#lVjJpp|Rzahci|KGlGZc|rdiojdog_style_id|body\{position:initial|padding-bottom:100px[^}]*min-height:932px|min-height:932px[^}]*padding-bottom:100px/i;

  const STYLE_ID = 'clg63-adblock-style';

  function toURL(raw) {
    if (raw === null || raw === undefined) return null;
    try { return new URL(String(raw), location.href); } catch (e) { return null; }
  }

  /** 是否为需要拦截的广告请求。 */
  function isAdUrl(raw) {
    const url = toURL(raw);
    if (!url) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname;

    if (host === 's3.filej.xyz') return /^\/(?:chart|go)\.js$/i.test(path);
    if (host === 'img.fileh.xyz') return true;
    if (host === 'asset.3400.org') return /^\/txt(?:\/|$)/i.test(path);
    if (host === 'g.oljiock.cn') return true;
    if (AD_HOST_RE.test(host)) return true;
    return false;
  }

  /** 文本（如 style/srcset）中是否含有广告 URL。 */
  function textHasAdUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    const matches = value.match(/https?:\/\/[^\s"'()]+/gi);
    return !!matches && matches.some(isAdUrl);
  }

  /* ------------------------------------------------------------------ *
   * 一、请求拦截：页面级钩子（@webRequest 不可用时的兜底）
   * ------------------------------------------------------------------ */

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const raw = typeof input === 'string'
          ? input
          : (input && typeof input.url === 'string' ? input.url : '');
        if (raw && isAdUrl(raw)) {
          log('block fetch', raw);
          return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
        }
      } catch (e) { /* 放行 */ }
      return nativeFetch.apply(this, arguments);
    };
  }

  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__clg63Blocked = isAdUrl(url); } catch (e) { /* ignore */ }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      if (!this.__clg63Blocked) return nativeSend.apply(this, arguments);
      const xhr = this;
      const type = xhr.responseType;
      const isText = !type || type === 'text';
      window.setTimeout(() => {
        try {
          Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
          Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
          Object.defineProperty(xhr, 'responseText', { value: '', configurable: true });
          Object.defineProperty(xhr, 'response', { value: isText ? '' : null, configurable: true });
          Object.defineProperty(xhr, 'responseURL', { value: '', configurable: true });
        } catch (e) { /* ignore */ }
        for (const handler of ['onreadystatechange', 'onload', 'onloadend']) {
          if (typeof xhr[handler] === 'function') {
            try { xhr[handler](); } catch (e) { /* ignore */ }
          }
        }
      }, 0);
    };
  }

  if (navigator && typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isAdUrl(url)) { log('block beacon', url); return true; }
      return nativeBeacon(url, data);
    };
  }

  // 在赋值阶段丢弃广告资源地址，避免 go.js 和广告脚本被动态插入执行。
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      const attr = String(name).toLowerCase();
      if (attr === 'src' || attr === 'href' || attr === 'poster' ||
          attr === 'data-src' || attr === 'data-original' || attr === 'data-bg') {
        if (isAdUrl(value)) { log('block attr', attr, value); return; }
      } else if ((attr === 'srcset' || attr === 'style') && textHasAdUrl(value)) {
        log('block attr', attr);
        return;
      }
    } catch (e) { /* 放行 */ }
    return nativeSetAttribute.apply(this, arguments);
  };

  function guardProperty(proto, prop) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.set !== 'function') return;
    const nativeSet = desc.set;
    try {
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value) {
          if (isAdUrl(value)) { log('block prop', prop, value); return; }
          return nativeSet.call(this, value);
        },
      });
    } catch (e) { /* ignore */ }
  }

  guardProperty(window.HTMLScriptElement && window.HTMLScriptElement.prototype, 'src');
  guardProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'src');
  guardProperty(window.HTMLIFrameElement && window.HTMLIFrameElement.prototype, 'src');
  guardProperty(window.HTMLLinkElement && window.HTMLLinkElement.prototype, 'href');

  // 广告横幅通过 insertAdjacentHTML 注入；命中特征时整段丢弃。
  if (typeof Element.prototype.insertAdjacentHTML === 'function') {
    const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, html) {
      const value = html === null || html === undefined ? '' : String(html);
      if (value && AD_HTML_RE.test(value)) {
        log('block insertAdjacentHTML');
        return;
      }
      return nativeInsertAdjacentHTML.call(this, position, value);
    };
  }

  const nativeWindowOpen = window.open;
  if (typeof nativeWindowOpen === 'function') {
    window.open = function (url) {
      if (url && isAdUrl(url)) { log('block window.open', url); return null; }
      return nativeWindowOpen.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------------ *
   * 二、页面清理：兜底处理已经进入 DOM 的广告节点
   * ------------------------------------------------------------------ */

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const root = document.documentElement;
    if (!root) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#cps-wrap,',
      'kglgzc,',
      '.bus-modal-mask,',
      '.bus-modal,',
      'body > div[style*="opacity:0.01"],',
      'body > div[style*="z-index: 2147483646"]',
      '{ display: none !important; }',
    ].join('\n');
    (document.head || root).appendChild(style);
  }

  function removeNode(node) {
    if (!node) return;
    try {
      if (node.tagName === 'SCRIPT' || node.tagName === 'IMG' || node.tagName === 'IFRAME') {
        node.removeAttribute('src');
        node.removeAttribute('srcset');
      } else if (node.tagName === 'LINK') {
        node.removeAttribute('href');
      }
    } catch (e) { /* ignore */ }
    try { node.remove(); } catch (e) { /* ignore */ }
  }

  function isAdStyle(styleEl) {
    if (!styleEl || styleEl.tagName !== 'STYLE') return false;
    if (styleEl.id === STYLE_ID) return false;
    if (styleEl.id === 'bus-modal-css') return true;
    return AD_STYLE_RE.test(styleEl.textContent || '');
  }

  function isAdOverlay(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.id === 'cps-wrap' || el.id === 'lVjJpp' || el.tagName === 'KGLGZC') return true;
    if (el.classList.contains('bus-modal-mask') || el.classList.contains('bus-modal')) return true;

    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed') return false;

    const inlineStyle = el.getAttribute('style') || '';
    if (/opacity:\s*0?\.01/.test(inlineStyle)) return true;

    if (el.childElementCount === 0 && !(el.textContent || '').trim()) {
      const z = Number.parseInt(cs.zIndex, 10);
      if (Number.isFinite(z) && z >= 2147483000) return true;
    }
    return false;
  }

  function clean() {
    if (!document.documentElement) return;
    ensureStyle();

    document.querySelectorAll('#cps-wrap, kglgzc, .bus-modal-mask, .bus-modal').forEach(removeNode);

    document.querySelectorAll('style').forEach((styleEl) => {
      if (isAdStyle(styleEl)) {
        log('remove ad style', styleEl.id);
        styleEl.remove();
      }
    });

    document.querySelectorAll('script[src], img[src], iframe[src], link[href]').forEach((el) => {
      const url = el.getAttribute('src') || el.getAttribute('href');
      if (isAdUrl(url)) removeNode(el);
    });

    if (document.body) {
      for (const el of Array.from(document.body.children)) {
        if (isAdOverlay(el)) removeNode(el);
      }
    }

    document.querySelectorAll('[id^="Rzahci"], [class*="Rzahci"], [id^="ZTYImh"]').forEach(removeNode);
  }

  function safeClean(reason) {
    try { clean(); } catch (e) { log('clean failed', reason, e); }
  }

  /* ------------------------------------------------------------------ *
   * 三、生命周期
   * ------------------------------------------------------------------ */

  let observer = null;
  let scheduleTimer = null;
  let scheduled = false;
  const extraTimers = [];

  function scheduleClean() {
    if (scheduled) return;
    scheduled = true;
    scheduleTimer = window.setTimeout(() => {
      scheduled = false;
      scheduleTimer = null;
      safeClean('scheduled');
    }, 50);
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    if (scheduleTimer !== null) window.clearTimeout(scheduleTimer);
    scheduleTimer = null;
    scheduled = false;
    for (const timer of extraTimers) window.clearTimeout(timer);
    extraTimers.length = 0;
  }

  function start() {
    if (observer) return;
    ensureStyle();
    safeClean('start');

    try {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            if (node.tagName === 'SCRIPT' || node.tagName === 'IMG' ||
                node.tagName === 'IFRAME' || node.tagName === 'LINK') {
              const url = node.getAttribute('src') || node.getAttribute('href');
              if (isAdUrl(url)) { removeNode(node); continue; }
            }
            if (node.tagName === 'STYLE' && isAdStyle(node)) { node.remove(); continue; }
            if (isAdOverlay(node)) { removeNode(node); continue; }
          }
        }
        scheduleClean();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      log('observer failed', e);
    }

    for (const delay of [500, 1500, 3000]) {
      extraTimers.push(window.setTimeout(() => safeClean(`delay-${delay}`), delay));
    }

    document.addEventListener('DOMContentLoaded', () => safeClean('domcontentloaded'), { once: true });
    window.addEventListener('load', () => safeClean('load'), { once: true });
    window.addEventListener('pagehide', stop, { once: true });
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
})();
