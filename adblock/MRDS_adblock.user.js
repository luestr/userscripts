// ==UserScript==
// @name         每日大赛网广告过滤
// @name:zh-CN   每日大赛网广告过滤
// @name:en      MRDS Ad Block
// @namespace    https://github.com/luestr/userscripts
// @version      1.0.0
// @description  过滤 mrds66.com 的横幅、弹窗、播放器与列表广告，仅适配 WebKit 引擎环境。
// @description:en Block banner, popup, player and list ads on mrds66.com. WebKit only.
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/adblock/MRDS_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/adblock/MRDS_adblock.user.js
// @match        https://mrds66.com/*
// @match        https://www.mrds66.com/*
// @run-at       document-start
// @grant        none
// @webRequest   [{"selector":"*://pic.jtzatly.cn/hc237/uploads/default/other/*","action":"cancel"},{"selector":"*://*/api/eventTracking/batchReport.json*","action":"cancel"}]
// ==/UserScript==

(() => {
  'use strict';

  if (window.__mrds66Adblock) return;
  window.__mrds66Adblock = true;

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[mrds66-adblock]', ...args); };

  /* ------------------------------------------------------------------ *
   * 一、请求拦截（第一优先）
   * ------------------------------------------------------------------ */

  // 广告素材目录经核对只存放广告创意：列表广告、横幅、弹窗、播放器贴片均取自此处，
  // 而正文图片走 /upload_01/ 与 /uploads/，因此按该目录拦截不会误伤正文。
  const AD_PATTERNS = [
    /^https?:\/\/pic\.jtzatly\.cn\/hc237\/uploads\/default\/other\//i,
    /\/api\/eventTracking\/batchReport\.json(?:[?#]|$)/i,
  ];

  /** 判断 URL 是否命中广告规则，兼容相对路径与非法值。 */
  function isAdUrl(value) {
    if (value === null || value === undefined) return false;
    let raw;
    try { raw = String(value); } catch (e) { return false; }
    if (!raw) return false;
    for (const re of AD_PATTERNS) {
      if (re.test(raw)) return true;
    }
    let abs = null;
    try { abs = new URL(raw, location.href).href; } catch (e) { /* 保留 raw 匹配 */ }
    if (abs) {
      for (const re of AD_PATTERNS) {
        if (re.test(abs)) return true;
      }
    }
    return false;
  }

  /* ---- 1.1 window.fetch ---- */
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const url = (typeof input === 'string')
          ? input
          : (input && typeof input.url === 'string')
            ? input.url
            : String(input);
        if (isAdUrl(url)) {
          log('block fetch', url);
          return Promise.reject(new TypeError('Blocked by mrds66 adblock'));
        }
      } catch (e) { /* 放行 */ }
      return nativeFetch.apply(this, arguments);
    };
  }

  /* ---- 1.2 XMLHttpRequest（站点用 $.ajax 拉取广告素材）---- */
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__mrdsBlocked = isAdUrl(url); } catch (e) { /* ignore */ }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      if (!this.__mrdsBlocked) return nativeSend.apply(this, arguments);

      log('block xhr');
      const self = this;
      // 伪造一次网络失败，让 $.ajax 走 error 分支，避免请求发出或调用方永久挂起。
      window.setTimeout(() => {
        try {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', { value: 0, configurable: true });
          Object.defineProperty(self, 'statusText', { value: '', configurable: true });
          Object.defineProperty(self, 'response', { value: null, configurable: true });
          Object.defineProperty(self, 'responseText', { value: '', configurable: true });
          self.getAllResponseHeaders = () => '';
        } catch (e) { /* ignore */ }
        for (const handler of ['onreadystatechange', 'onerror']) {
          if (typeof self[handler] === 'function') {
            try { self[handler](); } catch (e) { /* ignore */ }
          }
        }
      }, 0);
    };
  }

  /* ---- 1.3 navigator.sendBeacon ---- */
  if (navigator && typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isAdUrl(url)) { log('block beacon', url); return true; }
      return nativeBeacon(url, data);
    };
  }

  /* ---- 1.4 资源属性赋值 ---- */
  const GUARDED_ATTRS = new Set(['src', 'srcset', 'data-src', 'z-image-loader-url', 'x-image-loader-url']);

  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      if (GUARDED_ATTRS.has(String(name).toLowerCase()) && isAdUrl(value)) {
        log('block setAttribute', name);
        return;
      }
    } catch (e) { /* ignore */ }
    return nativeSetAttribute.apply(this, arguments);
  };

  /** 包装原型的属性 setter，命中广告规则时丢弃赋值。 */
  function guardProperty(proto, prop) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.set !== 'function') return;
    const nativeSet = desc.set;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set(value) {
        if (isAdUrl(value)) { log('block prop', prop); return; }
        return nativeSet.call(this, value);
      },
    });
  }

  guardProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'src');
  guardProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'srcset');

  /* ---- 1.5 站点自身的广告图片加载入口 ---- */
  // 站内图片一律经由全局 loadImage / loadBannerDirect 拉取。
  // 在函数被定义前安装访问器，使广告元素 ID 与广告 URL 在发起请求前就被丢弃。
  const AD_TARGET_ID = /^(?:ad-card|article-top-banner|article-bottom-ads|horizontal-banner|float-ads)-/i;

  function interceptGlobal(name, shouldSkip) {
    // 先捕获既有实现：Tampermonkey 的注入时机早于站点脚本，但保留这一手可避免
    // 站点在脚本之后重新定义时丢失原函数。
    let impl = null;
    try {
      impl = typeof window[name] === 'function' ? window[name] : null;
    } catch (e) { /* ignore */ }

    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() {
          if (!impl) return undefined;
          return function (...args) {
            try {
              if (shouldSkip(args)) { log('skip', name); return undefined; }
            } catch (e) { /* 放行 */ }
            return impl.apply(this, args);
          };
        },
        set(value) {
          impl = typeof value === 'function' ? value : null;
        },
      });
    } catch (e) { /* ignore */ }
  }

  interceptGlobal('loadImage', (args) => {
    const url = args[0];
    const id = args[1];
    return isAdUrl(url) || AD_TARGET_ID.test(String(id || ''));
  });

  interceptGlobal('loadBannerDirect', (args) => {
    const url = args[0];
    const wrap = args[2];
    const id = (wrap && typeof wrap === 'object') ? String(wrap.id || '') : '';
    return isAdUrl(url) || AD_TARGET_ID.test(id);
  });

  /* ---- 1.6 关闭 DPlayer 前置贴片广告 ---- */
  // player.min.v.1.0.4.js 通过 window.DPLAYER_PREROLL_AD.pickAdConfig 取贴片配置，
  // 返回空值即不挂载贴片，正片也不会被静音暂停。
  let prerollApi = null;
  try {
    Object.defineProperty(window, 'DPLAYER_PREROLL_AD', {
      configurable: true,
      enumerable: true,
      get() { return prerollApi; },
      set(value) {
        try {
          if (value && typeof value === 'object') {
            value.pickAdConfig = function pickAdConfig() { return null; };
            value.attachPreRollAd = function attachPreRollAd(player) { return player; };
          }
        } catch (e) { /* ignore */ }
        prerollApi = value;
      },
    });
  } catch (e) { /* ignore */ }

  /* ------------------------------------------------------------------ *
   * 二、页面清理（第二优先：兜底已插入文档的广告节点）
   * ------------------------------------------------------------------ */

  const REMOVE_SELECTORS = [
    'article.ad-item',            // 首页/列表信息流广告
    '[id^="ad-card-"]',           // 列表广告卡片
    '.post-card-ads',             // 列表广告遮罩
    '.adspop',                    // 弹窗广告（含“应用中心”弹窗）
    '.application-popup',         // 应用中心弹窗
    '#adFloat',                   // 首页悬浮轮播广告
    '.xqbj-component-adfloat',    // 同上（类名兜底）
    '.article-ads-btn',           // 详情页正文文字链广告
    'a[data-event="ad_click"]',   // 其余带广告点击标记的链接
    '.dplayer-pre-img',           // 播放器贴片广告图
    '.dplayer-pre-bg',            // 播放器贴片遮罩
    '.dplayer-pre-countdown',     // 播放器贴片倒计时
  ];

  const HIDE_CSS = `
    article.ad-item,
    [id^="ad-card-"],
    .post-card-ads,
    .adspop,
    .application-popup,
    #adFloat,
    .xqbj-component-adfloat,
    .horizontal-banner,
    .article-ads-btn,
    a[data-event="ad_click"],
    .dplayer .dplayer-pre-img,
    .dplayer .dplayer-pre-bg,
    .dplayer .dplayer-pre-countdown { display: none !important; }
  `;

  function injectStyle() {
    if (document.getElementById('mrds66-adblock-style')) return;
    const host = document.head || document.documentElement;
    if (!host) return;
    const style = document.createElement('style');
    style.id = 'mrds66-adblock-style';
    style.textContent = HIDE_CSS;
    host.appendChild(style);
  }

  /**
   * 列表广告的核心特征是没有文章标题。
   * 站点存在少量“无标题但属于正文”的卡片（如 post-card-193721），它们仍指向站内
   * /archives/ 且遮罩类名为 .post-card-mask；广告卡则带 .post-card-ads 遮罩、
   * 外链落地页或 ad-card-* 标识。因此只有同时满足“无标题 + 非站内文章链接”才移除，
   * 并以遮罩/标识作为佐证，避免误删真实文章。
   */
  function isTitlelessAdCard(article) {
    if (article.classList.contains('ad-item')) return true;
    if (article.querySelector('.post-card-ads')) return true;

    const card = article.querySelector('.post-card');
    if (!card) return false;
    if (AD_TARGET_ID.test(String(card.id || ''))) return true;

    const title = article.querySelector('.post-card-title');
    if (title && title.textContent.trim()) return false;

    const link = article.querySelector('a[href]');
    const href = link ? link.getAttribute('href') || '' : '';
    return !/^\/?archives\//i.test(href);
  }

  function removeTitlelessCards(scope) {
    scope.querySelectorAll('#index > article').forEach((article) => {
      if (!isTitlelessAdCard(article)) return;
      log('remove titleless ad card');
      article.remove();
    });
  }

  /** 横幅墙移除后，清理只剩内联 margin 的空包装层，避免页面留白。 */
  function removeBannerWall(banner) {
    const parent = banner.parentElement;
    banner.remove();
    if (!parent || parent === document.body) return;
    if (parent.tagName !== 'DIV' || parent.children.length !== 0) return;
    if (/margin/i.test(parent.getAttribute('style') || '')) parent.remove();
  }

  function removeAdNodes(root) {
    const scope = (root && typeof root.querySelectorAll === 'function') ? root : document;

    // 贴片广告：先触发 error，让站点自带的收尾逻辑清掉遮罩并恢复正片。
    scope.querySelectorAll('.dplayer-pre-img').forEach((img) => {
      try { img.dispatchEvent(new Event('error')); } catch (e) { /* ignore */ }
    });

    scope.querySelectorAll('.horizontal-banner').forEach(removeBannerWall);

    for (const sel of REMOVE_SELECTORS) {
      scope.querySelectorAll(sel).forEach((node) => {
        log('remove', sel);
        node.remove();
      });
    }

    removeTitlelessCards(scope);
  }

  /* ------------------------------------------------------------------ *
   * 三、动态观察与启动
   * ------------------------------------------------------------------ */

  let cleanupTimer = null;
  let observer = null;
  let pendingRoots = new Set();

  function scheduleCleanup(roots) {
    for (const root of roots) {
      if (root && root.nodeType === 1) pendingRoots.add(root);
    }
    if (cleanupTimer !== null) return;
    cleanupTimer = window.setTimeout(() => {
      cleanupTimer = null;
      const batch = pendingRoots;
      pendingRoots = new Set();
      removeAdNodes(document);
      // 新增子树单独扫描：站点会在播放器、弹窗等容器内动态插入广告节点。
      for (const root of batch) {
        if (root.isConnected) removeAdNodes(root);
      }
    }, 50);
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((mutations) => {
      const roots = [];
      for (const m of mutations) {
        if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) roots.push(node);
        }
      }
      if (roots.length > 0) scheduleCleanup(roots);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  injectStyle();
  removeAdNodes(document);
  startObserver();

  document.addEventListener('DOMContentLoaded', () => {
    injectStyle();
    removeAdNodes(document);
    startObserver();
  }, { once: true });

  window.addEventListener('load', () => { removeAdNodes(document); }, { once: true });

  window.addEventListener('pagehide', () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (cleanupTimer !== null) { window.clearTimeout(cleanupTimer); cleanupTimer = null; }
  }, { once: true });
})();
