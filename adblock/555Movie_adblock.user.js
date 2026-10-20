// ==UserScript==
// @name         555电影广告过滤
// @name:zh-CN   555电影广告过滤
// @name:en      555 Movie Ad Block
// @namespace    https://github.com/luestr/userscripts
// @version      1.2.0
// @description  过滤 555k06.com 首页与播放页广告，优先拦截请求、其次清理页面，仅适配 WebKit 引擎环境。
// @description:en Block ads on 555k06.com home and play pages with request blocking first and DOM cleanup as fallback. WebKit only.
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/adblock/555Movie_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/adblock/555Movie_adblock.user.js
// @match        https://555k06.com/*
// @match        https://www.555k06.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (window.__ad555k06) return;
  window.__ad555k06 = true;

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[555-adblock]', ...args); };

  /* ------------------------------------------------------------------ *
   * 一、广告判定（请求拦截为第一优先级）
   * ------------------------------------------------------------------ */

  // 博彩/推广落地域名：图标墙、弹窗、悬浮按钮、播放页横幅都指向这些站点。
  const AD_HOST_RE = /(?:^|\.)(?:32841243\.com|10387723\.com|52629942\.com|bihe299\.com|24240575\.com|98516601\.com|91001719\.com|55kp2\.com|55kp30\.com|55dy23\.com|55dy32\.com|55dy75\.com|55dy1\.top)$/i;
  // 播放页「分享好友观看」指向的微信推广短链域名。
  const SHARE_HOST_RE = /(?:^|\.)clb\.kr-tencentclb\.net$/i;
  // 统计与埋点：Google tag 与站点自建 DF Analytics。
  const TRACK_HOST_RE = /(?:^|\.)(?:googletagmanager\.com|google-analytics\.com|ddjzis\.cn)$/i;
  // 纯广告素材 CDN（该域只承载广告图标）。
  const AD_IMAGE_HOST_RE = /(?:^|\.)xstore\.qihu\.com$/i;
  // 站点资源 CDN：同时承载主题 CSS/JS 与广告素材，只能按「图片路径」精确拦截。
  const CDN_HOST = 'eliteres.fanruan.com';
  const CDN_AD_IMAGE_RE = /^\/office\/\d{4}\/\d{2}\/\d{2}\/[^/?#]+\.(?:gif|png|jpe?g|webp|svg)$/i;
  // 命中任一片段才进入字符串清洗，避免全局 innerHTML 开销与误伤。
  const SUSPECT_RE = /eliteres|\.xstore\.qihu|32841243|10387723|52629942|bihe299|24240575|98516601|91001719|55kp2|55kp30|55dy23|55dy32|55dy75|small-icon/i;

  function toURL(raw) {
    if (raw === null || raw === undefined) return null;
    try { return new URL(String(raw), location.href); } catch (e) { return null; }
  }

  /** URL 是否属于需要拦截的广告/追踪请求。 */
  function isBlockedUrl(raw) {
    const url = toURL(raw);
    if (!url) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname;
    if (AD_HOST_RE.test(host) || TRACK_HOST_RE.test(host) || AD_IMAGE_HOST_RE.test(host) || SHARE_HOST_RE.test(host)) return true;
    if (host === CDN_HOST && CDN_AD_IMAGE_RE.test(url.pathname)) return true;
    return false;
  }

  /** 文本（如 style="background:url(...)"）中是否含需拦截的广告资源。 */
  function textHasBlockedUrl(text) {
    if (typeof text !== 'string' || !SUSPECT_RE.test(text)) return false;
    const matches = text.match(/https?:\/\/[^\s"'()]+/gi);
    if (!matches) return false;
    return matches.some(isBlockedUrl);
  }

  /* ------------------------------------------------------------------ *
   * 二、请求拦截：fetch / XHR / sendBeacon / 资源属性
   * ------------------------------------------------------------------ */

  // 2.1 fetch：返回空 200，避免调用方因网络错误中断。
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        const raw = typeof input === 'string'
          ? input
          : (input && typeof input.url === 'string' ? input.url : '');
        if (raw && isBlockedUrl(raw)) {
          log('block fetch', raw);
          return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
        }
      } catch (e) { /* 放行 */ }
      return nativeFetch.apply(this, arguments);
    };
  }

  // 2.2 XMLHttpRequest：合成一个成功但为空的响应。
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__ad555Blocked = isBlockedUrl(url); } catch (e) { /* ignore */ }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      if (!this.__ad555Blocked) return nativeSend.apply(this, arguments);
      const self = this;
      const type = self.responseType;
      const isText = !type || type === 'text';
      window.setTimeout(() => {
        try {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', { value: 200, configurable: true });
          Object.defineProperty(self, 'statusText', { value: 'OK', configurable: true });
          // 与原生空响应保持一致：文本类型给空串，其余类型给 null，
          // 避免调用方把空串当作 JSON 解析而抛错。
          Object.defineProperty(self, 'responseText', { value: '', configurable: true });
          Object.defineProperty(self, 'response', { value: isText ? '' : null, configurable: true });
        } catch (e) { /* ignore */ }
        for (const handler of ['onreadystatechange', 'onload', 'onloadend']) {
          if (typeof self[handler] === 'function') {
            try { self[handler](); } catch (e) { /* ignore */ }
          }
        }
      }, 0);
    };
  }

  // 2.3 sendBeacon：埋点直接吞掉。
  if (navigator && typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isBlockedUrl(url)) { log('block beacon', url); return true; }
      return nativeBeacon(url, data);
    };
  }

  // 2.4 元素属性：脚本/图片/iframe/link 在赋值阶段丢弃广告 URL。
  const nativeSetAttribute = Element.prototype.setAttribute;
  const GUARDED_ATTRS = new Set(['src', 'href', 'srcset', 'poster', 'data-src', 'data-original', 'data-bg', 'data-lazy-src']);
  Element.prototype.setAttribute = function (name, value) {
    try {
      const attr = String(name).toLowerCase();
      if (attr === 'style') {
        if (textHasBlockedUrl(String(value))) { log('block style attr', value); return; }
      } else if (GUARDED_ATTRS.has(attr) && isBlockedUrl(value)) {
        log('block setAttribute', attr, value);
        return;
      }
    } catch (e) { /* ignore */ }
    return nativeSetAttribute.apply(this, arguments);
  };

  // 2.5 属性 setter：覆盖页面直接用 el.src / el.href 赋值的情况。
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
        if (isBlockedUrl(value)) { log('block prop', prop, value); return; }
        return nativeSet.call(this, value);
      },
    });
  }

  guardProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'src');
  guardProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'srcset');
  guardProperty(window.HTMLScriptElement && window.HTMLScriptElement.prototype, 'src');
  guardProperty(window.HTMLIFrameElement && window.HTMLIFrameElement.prototype, 'src');
  guardProperty(window.HTMLLinkElement && window.HTMLLinkElement.prototype, 'href');
  guardProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'src');
  guardProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'srcset');

  // 2.6 innerHTML / insertAdjacentHTML：广告数据是 base64 JSON 拼成 HTML 后注入的，
  //     在插入前剔除广告卡片，等价于「不发起请求」。
  function hasAdHref(tagHtml) {
    const m = tagHtml.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    return !!m && isBlockedUrl(m[1]);
  }

  function hasAdImgSrc(tagHtml) {
    const m = tagHtml.match(/\b(?:src|data-src|data-original|data-bg|data-lazy-src)\s*=\s*["']([^"']+)["']/i);
    return !!m && isBlockedUrl(m[1]);
  }

  function scrubHtml(html) {
    if (typeof html !== 'string' || html.length > 300000) return html;
    if (!SUSPECT_RE.test(html)) return html;
    let out = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, (tag) => {
      // 图标墙：<a class="small-icon-div">…</a>
      if (/class\s*=\s*["'][^"']*small-icon-div/i.test(tag)) return '';
      // 带广告图片的推广卡片
      if (/<img\b/i.test(tag) && (hasAdImgSrc(tag) || hasAdHref(tag))) return '';
      return tag;
    });
    out = out.replace(/<img\b[^>]*>/gi, (tag) => (hasAdImgSrc(tag) ? '' : tag));
    if (out !== html) log('scrubbed injected html');
    return out;
  }

  const innerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (innerHTMLDesc && typeof innerHTMLDesc.set === 'function') {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      enumerable: innerHTMLDesc.enumerable,
      get: innerHTMLDesc.get,
      set(value) {
        // 与原生一致：null 等价于空串，其余按字符串清洗后写入。
        const html = value === null ? '' : scrubHtml(String(value));
        return innerHTMLDesc.set.call(this, html);
      },
    });
  }

  if (typeof Element.prototype.insertAdjacentHTML === 'function') {
    const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, html) {
      const value = html === null ? '' : scrubHtml(String(html));
      return nativeInsertAdjacentHTML.call(this, position, value);
    };
  }

  /* ------------------------------------------------------------------ *
   * 三、页面清理（兜底：处理解析器已插入或脚本已渲染的广告节点）
   * ------------------------------------------------------------------ */

  // 明确由广告脚本填充的容器与弹窗。
  const REMOVE_SELECTORS = [
    '#popup.popup',                       // 首页 APP 下载弹窗
    '.popup-tips',                        // 弹窗通用容器
    '.small-icon-container',              // 博彩图标墙（首页 / 播放页 / 侧栏）
    'a.fixedGroup-item[href*="55kp2.com"]',   // 右下角悬浮下载按钮
    'a.fixedGroup-item[href*="55dy23.com"]',
    'a.share-btn',                        // 播放页「分享好友观看」按钮本体
  ];

  // 站点内联脚本会按 id 回写这两个横幅容器（2s 后再次 innerHTML），
  // 直接删除会让页面脚本取到 null 而抛错；因此只清空 + 隐藏，保留节点。
  const NEUTRALIZE_SELECTORS = [
    '#c2f670cd2',                         // 播放器上方横幅广告
    '#c2f670cd',                          // 播放器下方横幅广告
  ];

  // 文章列表 / 模块内的广告卡片只在这些范围内按链接域名识别。
  const LIST_SCOPE = '.module-items, .module-main, .module-player, .module-player-side, .content > .module, .small-icon-container, .fixedGroup';

  const HIDE_CSS = `
    #popup.popup,
    .popup-tips,
    .small-icon-container,
    #c2f670cd,
    #c2f670cd2,
    a.fixedGroup-item[href*="55kp2.com"],
    a.fixedGroup-item[href*="55dy23.com"] { display: none !important; }
    /* 单独成条：不支持 :has() 的引擎只会丢弃这一条，不影响上面的隐藏规则。 */
    footer.player-footer > p:has(#player-release) { display: none !important; }
  `;

  function injectStyle() {
    if (document.getElementById('ad555-style') || !document.documentElement) return;
    const style = document.createElement('style');
    style.id = 'ad555-style';
    style.textContent = HIDE_CSS;
    document.documentElement.appendChild(style);
  }

  function removeElement(el) {
    if (el && el.parentNode) el.remove();
  }

  /**
   * 摘除节点前先切断它的资源请求：对仍在加载的图片 / iframe 移除地址属性，
   * 可让浏览器放弃未完成的下载（仅删除节点在部分引擎上不会取消请求）。
   */
  function removeResourceNode(el) {
    if (!el) return;
    const tag = el.tagName;
    try {
      if (tag === 'IMG' || tag === 'IFRAME' || tag === 'SOURCE' || tag === 'SCRIPT') {
        el.removeAttribute('src');
        el.removeAttribute('srcset');
      } else if (tag === 'LINK') {
        el.removeAttribute('href');
      }
    } catch (e) { /* ignore */ }
    removeElement(el);
  }

  /** 播放器 iframe 页脚的「最新发布页」推广链。 */
  function removePlayerRelease(root) {
    const link = root.querySelector('#player-release');
    if (!link) return;
    const para = link.closest('footer.player-footer > p') || link.parentElement;
    if (para && /最新发布页/.test(para.textContent || '')) removeElement(para);
    else removeElement(link);
  }

  /** 清空并隐藏，但保留节点本身，供页面脚本继续安全引用。 */
  function neutralize(el) {
    if (!el) return;
    try { el.textContent = ''; } catch (e) { /* ignore */ }
    el.style.setProperty('display', 'none', 'important');
  }

  function sweep(root) {
    for (const selector of REMOVE_SELECTORS) {
      try { root.querySelectorAll(selector).forEach(removeElement); } catch (e) { log('selector failed', selector, e); }
    }
    for (const selector of NEUTRALIZE_SELECTORS) {
      try { root.querySelectorAll(selector).forEach(neutralize); } catch (e) { log('selector failed', selector, e); }
    }
    if (root.querySelector) removePlayerRelease(root);

    // 已经插入文档的广告资源节点（解析期脚本 / 图片 / iframe / 样式）：
    // 先切断地址属性再摘除，尽快中止未完成的下载。
    try {
      for (const node of document.querySelectorAll('script[src], img[src], iframe[src], link[href]')) {
        const url = node.getAttribute('src') || node.getAttribute('href');
        if (!isBlockedUrl(url)) continue;
        removeResourceNode(node);
      }
    } catch (e) { log('resource sweep failed', e); }

    const scopes = [];
    if (root.nodeType === 1 && root.matches(LIST_SCOPE)) scopes.push(root);
    if (root.querySelectorAll) scopes.push(...root.querySelectorAll(LIST_SCOPE));

    for (const scope of scopes) {
      // 指向广告域名的列表卡片（文章列表 / 推荐列表）。
      for (const a of scope.querySelectorAll('a[href]')) {
        if (a.closest('.navbar')) continue;
        if (!isBlockedUrl(a.getAttribute('href'))) continue;
        const card = a.closest('.module-poster-item, .module-topic-item, .module-item, li, .swiper-slide') || a;
        removeElement(card);
      }
      // 图片本身命中广告素材的卡片（放宽到任意容器）。
      for (const img of scope.querySelectorAll('img[src], img[data-original]')) {
        const src = img.getAttribute('src') || img.getAttribute('data-original');
        if (!isBlockedUrl(src)) continue;
        removeElement(img.closest('.module-poster-item, .module-topic-item, .module-item, li, .swiper-slide') || img);
      }
    }

    // 悬浮组：广告按钮移除后若已无内容，整组一起移除。
    for (const group of document.querySelectorAll('.fixedGroup')) {
      if (!group.querySelector('.fixedGroup-item') && !group.querySelector('a, div')) removeElement(group);
    }

    // 分享按钮被移除后，清掉留白的空容器。
    for (const bar of document.querySelectorAll('.module-player-handle-items')) {
      if (!bar.textContent.trim() && !bar.querySelector('a, button, div')) removeElement(bar);
    }
  }

  /* ------------------------------------------------------------------ *
   * 四、生命周期：尽早清理 + 观察动态注入
   * ------------------------------------------------------------------ */

  let scheduled = false;
  let observer = null;
  let extraTimers = [];

  function scheduleSweep() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      try { sweep(document); } catch (e) { log('sweep failed', e); }
    }, 60);
  }

  function start() {
    injectStyle();
    try { sweep(document); } catch (e) { log('initial sweep failed', e); }

    try {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          // 解析期插入的广告脚本 / 图片 / iframe：命中即刻摘除，
          // 尽量在解析线程继续之前切断后续加载（@webRequest 不可用时的兜底）。
          // 只处理资源类元素本身，绝不因「包含广告容器」而删除整棵子树。
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (!node || node.nodeType !== 1) continue;
              const tag = node.tagName;
              if (tag === 'SCRIPT' || tag === 'IMG' || tag === 'IFRAME' || tag === 'LINK') {
                if (isBlockedUrl(node.getAttribute('src') || node.getAttribute('href'))) {
                  log('block parsed node', tag, node.getAttribute('src') || node.getAttribute('href'));
                  removeElement(node);
                }
              }
            }
          }
          if (mutation.type === 'attributes') {
            const el = mutation.target;
            if (!el || el.nodeType !== 1) continue;
            const attr = mutation.attributeName;
            const value = el.getAttribute(attr);
            if (attr === 'href' && isBlockedUrl(value)) {
              const card = el.closest('.module-poster-item, .module-topic-item, .module-item, li, .swiper-slide');
              if (card && !card.closest('.navbar')) { removeElement(card); continue; }
            }
            if ((attr === 'src' || attr === 'data-original' || attr === 'style') && value && (
              isBlockedUrl(value) || (attr === 'style' && textHasBlockedUrl(value))
            )) {
              removeElement(el);
              continue;
            }
          }
        }
        scheduleSweep();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'src', 'srcset', 'data-bg', 'data-original', 'style'],
      });
    } catch (e) {
      log('observer failed', e);
    }

    // 广告在 2s 后才由内联脚本渲染，补几次兜底清理。
    for (const delay of [800, 2000, 3500]) {
      extraTimers.push(window.setTimeout(scheduleSweep, delay));
    }
  }

  function stop() {
    if (observer) { observer.disconnect(); observer = null; }
    for (const timer of extraTimers) window.clearTimeout(timer);
    extraTimers = [];
  }

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  document.addEventListener('DOMContentLoaded', scheduleSweep, { once: true });
  window.addEventListener('load', scheduleSweep, { once: true });
  window.addEventListener('pagehide', stop, { once: true });
})();
