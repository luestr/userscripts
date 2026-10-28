// ==UserScript==
// @name         月色视频网广告过滤
// @name:zh-CN   月色视频网广告过滤
// @name:en      Yuese Ad Block & Play Unlock
// @namespace    https://github.com/luestr/userscripts
// @version      1.1.0
// @description  过滤月色视频广告，自动跳转最新地址，解除游客播放限制。仅适配 WebKit 引擎环境。
// @description:en Block ads, auto-follow the latest mirror, and remove guest/login playback limits on Yuese. WebKit only.
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/adblock/yuese_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/adblock/yuese_adblock.user.js
// @match        https://ys.m4k5em85.icu/*
// @match        https://ys.ph3ywdns.icu/*
// @include      /^https?:\/\/ys\.[a-z0-9]+\.icu\//
// @include      /^https?:\/\/(?:www\.)?yuese[0-9]*\.icu\//
// @noframes
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__yueseAdblockInstalled) return;
  window.__yueseAdblockInstalled = true;

  // ---------- 站点常量 ----------
  // 接口响应使用 AES-128-CBC/PKCS7，key 与 iv 相同，均由前端硬编码。
  const AES_KEY = 'LqzCOd16vnYhOHTz';
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const subtle = window.crypto && window.crypto.subtle;
  // 保存原生 fetch，脚本内部请求不经过自己的钩子，避免重复处理与递归
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  // 视频详情：需要解除限制
  const RE_DETAIL = /\/api\/videos\/detail(?:[?#]|$)/;
  // 列表/首页：需要清空广告位
  const RE_AD_PAGES =
    /\/api\/(?:videos\/(?:index\w*|list_\w+|search|related|dvds|classification|tags)|index\/(?:app_config))/;

  // 线路缓存，避免同一视频重复切换
  const lineCache = new Map();
  const LINE_CACHE_TTL = 5 * 60 * 1000;
  const MAX_CACHE = 200;

  // 公告弹窗（推广备用网址）也算推广内容，默认隐藏；想保留改成 false
  const STRIP_NOTICE_POPUP = true;

  // ---------- 工具 ----------
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function decryptJson(encryptData) {
    if (!subtle) throw new Error('SubtleCrypto 不可用');
    const keyBytes = textEncoder.encode(AES_KEY);
    const key = await subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
    const plain = await subtle.decrypt({ name: 'AES-CBC', iv: keyBytes }, key, base64ToBytes(encryptData));
    return JSON.parse(textDecoder.decode(plain));
  }

  // 仅用于把明文 content 交回页面；页面检测不到 encrypt 字段会直接使用，无需重新加密。
  function encodeResponse(env) {
    return textEncoder.encode(
      JSON.stringify({
        error: env.error == null ? 0 : env.error,
        message: env.message == null ? '' : env.message,
        content: env.content
      })
    ).buffer;
  }

  // ---------- 广告清理 ----------
  function stripAds(data) {
    if (!data || typeof data !== 'object') return data;

    // 首页顶部图文广告与文字广告
    for (const key of ['list_ads_top', 'list_ads_text']) {
      const box = data[key];
      if (box && typeof box === 'object' && 'content' in box) box.content = [];
    }

    // 开屏广告开关
    if ('OPEN_AD' in data) data.OPEN_AD = 0;

    // 顶部滚动广告（接口自述为“顶部滚动广告”）
    const scroll = data.top_scroll_notice;
    if (scroll && scroll.content && typeof scroll.content === 'object') {
      scroll.content.status_id = 0;
    }

    // 公告弹窗（推广最新网址）
    if (STRIP_NOTICE_POPUP) {
      const notice = data.notice;
      if (notice && notice.content && typeof notice.content === 'object') {
        notice.content.status_id = 0;
      }
    }

    // 下载 App 横幅
    if (data.download_banner && typeof data.download_banner === 'object') {
      data.download_banner.enabled = false;
    }

    // 详情页内嵌广告
    if (Array.isArray(data.ads)) data.ads = [];
    if (Array.isArray(data.text_ads)) data.text_ads = [];

    return data;
  }

  // ---------- 播放限制解除 ----------
  function pickLineIdx(data) {
    const lines = Array.isArray(data.cdn_lines) ? data.cdn_lines : [];
    const preferred = lines.find((x) => x && x.is_default === 1) || lines[0];
    const idx = preferred && typeof preferred.idx === 'number' ? preferred.idx : 2;
    return idx;
  }

  function readCache(key) {
    const hit = lineCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > LINE_CACHE_TTL) {
      lineCache.delete(key);
      return null;
    }
    return hit.value;
  }

  function writeCache(key, value) {
    if (lineCache.size >= MAX_CACHE) {
      const first = lineCache.keys().next();
      if (!first.done) lineCache.delete(first.value);
    }
    lineCache.set(key, { at: Date.now(), value });
  }

  async function fetchApiJson(url) {
    const res = await nativeFetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const text = await res.text();
    let env;
    try {
      env = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!env || !env.content || typeof env.content !== 'object') return null;
    if (env.content.encrypt === 1 && typeof env.content.encryptData === 'string') {
      try {
        return await decryptJson(env.content.encryptData);
      } catch (e) {
        return null;
      }
    }
    return env.content;
  }

  async function unlockDetail(absUrl, data) {
    // 付费视频保持原状，只处理游客配额/未登录导致的空地址
    if (data.vip_required === 1) return data;

    const need = !data.video_url || data.is_limit_over === 1;
    if (!need) return data;

    const videoId =
      absUrl.searchParams.get('id') || (data.video_id != null ? String(data.video_id) : '');
    if (!videoId) return data;

    const cacheKey = String(videoId);
    let line = readCache(cacheKey);

    if (!line) {
      const lineIdx = pickLineIdx(data);
      const switchUrl = new URL('/api/videos/switch_line', absUrl.origin);
      switchUrl.searchParams.set('video_id', videoId);
      switchUrl.searchParams.set('line_idx', String(lineIdx));

      const result = await fetchApiJson(switchUrl.href);
      if (result && typeof result.video_url === 'string' && result.video_url) {
        line = result;
        writeCache(cacheKey, line);
      }
    }

    if (!line || !line.video_url) return data;

    data.video_url = line.video_url;
    if (typeof line.line_idx === 'number') data.line_idx = line.line_idx;
    data.seg_skip_bytes = typeof line.seg_skip_bytes === 'number' ? line.seg_skip_bytes : 0;
    data.is_limit_over = 0;
    return data;
  }

  // ---------- 响应改写 ----------
  async function transformJson(urlStr, rawText) {
    let env;
    try {
      env = JSON.parse(rawText);
    } catch (e) {
      return null;
    }
    if (!env || !env.content || typeof env.content !== 'object') return null;

    let data = env.content;
    if (data.encrypt === 1 && typeof data.encryptData === 'string') {
      try {
        data = await decryptJson(data.encryptData);
      } catch (e) {
        return null;
      }
    }
    if (!data || typeof data !== 'object') return null;

    stripAds(data);

    let abs = null;
    try {
      abs = new URL(urlStr, location.href);
    } catch (e) {
      abs = null;
    }
    if (abs && RE_DETAIL.test(abs.pathname + abs.search)) {
      await unlockDetail(abs, data);
    }

    return { error: env.error, message: env.message, content: data };
  }

  function shouldTransform(urlStr) {
    if (!urlStr) return false;
    return RE_DETAIL.test(urlStr) || RE_AD_PAGES.test(urlStr);
  }

  // ---------- 自动跳转最新地址 ----------
  const NAV_LAST_KEY = '__yuese_nav_target';

  function decodeCharCodes(codes) {
    if (!Array.isArray(codes)) return '';
    let out = '';
    for (let i = 0; i < codes.length; i += 4096) {
      out += String.fromCharCode.apply(null, codes.slice(i, i + 4096));
    }
    return out;
  }

  function validNavUrl(value) {
    if (typeof value !== 'string') return null;
    const url = value.trim();
    if (!/^https?:\/\//i.test(url)) return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      if (!u.hostname || u.hostname.indexOf('.') < 0) return null;
      if (u.hostname === location.hostname) return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }

  // 中转页把地址写成 var xxxCodes=[[104,116,...],...];
  function readInlineVar(text, name) {
    const at = text.indexOf(name);
    if (at < 0) return null;
    const eq = text.indexOf('=', at);
    if (eq < 0) return null;
    const end = text.indexOf(';', eq);
    if (end < 0) return null;
    try {
      return JSON.parse(text.slice(eq + 1, end).trim());
    } catch (e) {
      return null;
    }
  }

  function findLatestAddress() {
    // 1. 中转页内联变量：最新地址 (1) 即 domainsH5Codes[0]
    const scripts = document.scripts || [];
    for (let i = 0; i < scripts.length; i++) {
      const node = scripts[i];
      if (node.src) continue;
      const text = node.textContent || '';
      if (text.indexOf('domainsH5Codes') < 0 && text.indexOf('internationalCodes') < 0) continue;

      const h5 = readInlineVar(text, 'domainsH5Codes');
      if (Array.isArray(h5)) {
        for (const codes of h5) {
          const url = validNavUrl(decodeCharCodes(codes));
          if (url) return url;
        }
      }

      const intl = readInlineVar(text, 'internationalCodes');
      if (Array.isArray(intl)) {
        for (const item of intl) {
          const url = item ? validNavUrl(decodeCharCodes(item.codes)) : null;
          if (url) return url;
        }
      }
    }

    // 2. 已渲染的复制按钮
    const btn = document.querySelector('#domain-list .copy-btn[data-clipboard-text]');
    if (btn) {
      const url = validNavUrl(btn.getAttribute('data-clipboard-text'));
      if (url) return url;
    }

    // 3. 页面文本兜底
    const body = document.body;
    const text = body ? body.innerText || '' : '';
    const withScheme = text.match(
      /最新地址\s*[（(]?\s*1\s*[)）]?\s*[:：]?\s*(https?:\/\/[^\s"'<>]+)/i
    );
    if (withScheme) return validNavUrl(withScheme[1]);
    const bare = text.match(
      /最新地址\s*[（(]?\s*1\s*[)）]?\s*[:：]?\s*([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i
    );
    if (bare) return validNavUrl('https://' + bare[1]);
    return null;
  }

  let navJumped = false;

  function tryAutoJump() {
    if (navJumped) return;
    // ?stay=1 时保留中转页，便于手动复制其它备用地址
    try {
      if (new URLSearchParams(location.search).get('stay') === '1') return;
    } catch (e) {
      /* 忽略 */
    }

    const url = findLatestAddress();
    if (!url) return;
    navJumped = true;

    // 防止 A→B→A 之类的中转页互指循环
    try {
      if (sessionStorage.getItem(NAV_LAST_KEY) === url) {
        sessionStorage.removeItem(NAV_LAST_KEY);
        return;
      }
      sessionStorage.setItem(NAV_LAST_KEY, url);
    } catch (e) {
      /* 忽略 */
    }

    location.replace(url);
  }

  function scheduleAutoJump() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryAutoJump, { once: true });
    } else {
      tryAutoJump();
    }
    // 兼容地址稍后由脚本渲染出来的情况
    setTimeout(tryAutoJump, 800);
    setTimeout(tryAutoJump, 2000);
  }

  // ---------- XHR 拦截（Flutter Web 走 XMLHttpRequest） ----------
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && nativeFetch) {
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    const originalAbort = XHR.prototype.abort;
    const originalSetRequestHeader = XHR.prototype.setRequestHeader;

    XHR.prototype.open = function (method, url) {
      try {
        this.__ysMethod = String(method || 'GET').toUpperCase();
        this.__ysUrl = String(url || '');
        this.__ysHeaders = null;
      } catch (e) {
        /* 忽略 */
      }
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function (name, value) {
      try {
        if (!this.__ysHeaders) this.__ysHeaders = {};
        this.__ysHeaders[String(name)] = String(value);
      } catch (e) {
        /* 忽略 */
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    XHR.prototype.abort = function () {
      this.__ysAborted = true;
      return originalAbort.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      const url = this.__ysUrl || '';
      if (this.__ysMethod !== 'GET' || !shouldTransform(url)) {
        return originalSend.apply(this, arguments);
      }

      const xhr = this;
      const fallback = () => {
        try {
          originalSend.call(xhr, body);
        } catch (e) {
          /* 忽略 */
        }
      };

      (async () => {
        let text;
        let status = 200;
        let statusText = 'OK';
        try {
          const res = await nativeFetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            headers: buildHeaders(xhr)
          });
          status = res.status;
          statusText = res.statusText;
          text = await res.text();
        } catch (e) {
          fallback();
          return;
        }

        const env = await transformJson(url, text);
        reply(xhr, url, env ? JSON.stringify(env) : text, status, statusText);
      })();
    };
  }

  // 转发页面设置过的请求头（例如登录态令牌），过滤 fetch 不允许的字段
  function buildHeaders(xhr) {
    const headers = { Accept: 'application/json' };
    const source = xhr.__ysHeaders;
    if (!source) return headers;
    const blocked = {
      host: 1,
      'content-length': 1,
      connection: 1,
      cookie: 1,
      origin: 1,
      referer: 1,
      'user-agent': 1,
      'accept-encoding': 1
    };
    for (const name of Object.keys(source)) {
      if (!blocked[name.toLowerCase()]) headers[name] = source[name];
    }
    return headers;
  }

  function reply(xhr, url, text, status, statusText) {
    if (xhr.__ysAborted) return;
    const buffer = textEncoder.encode(text).buffer;
    let responseValue = buffer;
    try {
      const rt = xhr.responseType;
      if (rt === '' || rt === 'text') responseValue = text;
    } catch (e) {
      /* 忽略 */
    }
    try {
      Object.defineProperty(xhr, 'readyState', { configurable: true, get: () => 4 });
      Object.defineProperty(xhr, 'status', { configurable: true, get: () => (status == null ? 200 : status) });
      Object.defineProperty(xhr, 'statusText', {
        configurable: true,
        get: () => (statusText == null ? '' : statusText)
      });
      Object.defineProperty(xhr, 'responseURL', {
        configurable: true,
        get: () => {
          try {
            return new URL(url, location.href).href;
          } catch (e) {
            return url;
          }
        }
      });
      Object.defineProperty(xhr, 'response', { configurable: true, get: () => responseValue });
      xhr.getAllResponseHeaders = () => 'content-type: application/json; charset=utf-8\r\n';
    } catch (e) {
      return;
    }
    for (const type of ['readystatechange', 'load', 'loadend']) {
      try {
        xhr.dispatchEvent(type === 'readystatechange' ? new Event(type) : new ProgressEvent(type));
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  // ---------- fetch 兜底（站点当前未使用，防后续改版） ----------
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      const method = String((init && init.method) || 'GET').toUpperCase();
      const p = originalFetch.apply(this, arguments);
      if (method !== 'GET' || !shouldTransform(url)) return p;

      return p.then(async (res) => {
        let text;
        try {
          text = await res.clone().text();
        } catch (e) {
          return res;
        }
        const env = await transformJson(url, text);
        if (!env) return res;
        return new Response(encodeResponse(env), {
          status: res.status,
          statusText: res.statusText,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      });
    };
  }

  // ---------- 清掉已落盘的下载横幅配置 ----------
  try {
    const raw = localStorage.getItem('flutter.download_banner_config');
    if (raw) {
      // Flutter 的 shared_preferences 会把 JSON 再序列化成字符串，需要拆两层
      let config = JSON.parse(raw);
      if (typeof config === 'string') config = JSON.parse(config);
      if (config && typeof config === 'object' && config.enabled !== false) {
        config.enabled = false;
        localStorage.setItem('flutter.download_banner_config', JSON.stringify(JSON.stringify(config)));
      }
    }
  } catch (e) {
    /* 忽略 */
  }

  // ---------- 启动 ----------
  scheduleAutoJump();
})();
