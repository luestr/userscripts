// ==UserScript==
// @name         黑料网广告拦截
// @namespace    hl365 Ad Block
// @namespace    https://github.com/luestr/userscripts
// @version      1.4.5
// @description  对 hl365.com 优先拦截广告/追踪请求，其次清理页面广告元素。
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/ad-filter/hl365_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/ad-filter/hl365_adblock.user.js
// @match        https://hl365.com/*
// @run-at       document-start
// @grant        none
// @webRequest   [{"selector":"*://mc.yandex.ru/*","action":"cancel"},{"selector":"*://*.googletagmanager.com/*","action":"cancel"},{"selector":"*://*.google-analytics.com/*","action":"cancel"},{"selector":"*://static.cloudflareinsights.com/*","action":"cancel"},{"selector":"*://*/api/eventTracking/batchReport.json*","action":"cancel"},{"selector":"*://api1.gxmufvxq.cc/api.php/api/home/config*","action":"cancel"},{"selector":"https://hl365.com/storage/static/popup-feed.json*","action":"cancel"},{"selector":"https://hl365.com/usr/themes/Mirages/js/bottom_ad_poll.js*","action":"cancel"},{"selector":"https://hl365.com/usr/plugins/activity/js/popup-lottery.js*","action":"cancel"},{"selector":"https://hl365.com/usr/plugins/activity/js/popup-zhongqiu.js*","action":"cancel"},{"selector":"https://hl365.com/usr/themes/Mirages/js/7.10.0/fp.min.js*","action":"cancel"},{"selector":"https://hl365.com/usr/themes/Mirages/js/7.10.0/tjtag.3.2.3.js*","action":"cancel"},{"selector":"https://hl365.com/usr/themes/Mirages/js/7.10.0/web-sdk-v1.1.3.js*","action":"cancel"}]
// ==/UserScript==

/*
 * 设计说明
 * ----------
 * 目标：https://hl365.com 首页广告过滤，优先级为
 *   1) 请求拦截（第一优先）：@webRequest 声明式取消（支持该指令的构建，
 *      在网络层拦截 script/xhr/websocket/sub_frame，含页面脚本加载前），
 *      加上 document-start 阶段对 fetch / XMLHttpRequest / sendBeacon 以及
 *      元素 src/href/srcset 的运行时拦截（可移植到 Manifest V3 等不支持
 *      @webRequest 的环境）。
 *   2) 页面清理（第二优先）：注入 CSS 隐藏 + MutationObserver 移除广告节点。
 *
 * 已确认的广告/追踪目标（侦察 https://hl365.com/ 得到）：
 *   - 追踪：mc.yandex.ru、googletagmanager.com、google-analytics.com、
 *     static.cloudflareinsights.com、任意主机 /api/eventTracking/batchReport.json。
 *   - 配置：api1.gxmufvxq.cc/api.php/api/home/config（活动弹窗开关）。
 *   - 底部弹窗广告：/storage/static/popup-feed.json + bottom_ad_poll.js。
 *   - 活动弹窗：/usr/plugins/activity/js/popup-lottery.js、popup-zhongqiu.js。
 *   - 指纹/埋点：/usr/themes/Mirages/js/7.10.0/{fp.min,tjtag.*,web-sdk-*}.js。
 *   - 广告素材图：pic.hdhwqx.cn/hc237/uploads/default/other/（已确认该目录
 *     下图片均来自 .ad-item / 广告弹窗，站点正文图使用 /upload_01/ 目录）。
 *   - 广告 DOM：article.ad-item、.adspop、.bottom-ads、
 *     #lottery-popup-wrap、#zq-activity-popup、#aiFloat（成人 AI 悬浮广告）、
 *     .launchapp-btn-container（App 下载提示）、#foot-menu 与 #footer（整块页脚）、
 *     .horizontal-banner（首页底部 banner 广告墙）。
 *   - 文章页推广（/archives/*.html 的 .post-content 内）：.article-ads-btn、
 *     .ads-title、.article-bottom-apps、.article-content-after、#button5、
 *     .post-near、.top_picks_title、.top_picks_wrapper、
 *     .content-copyright、.tags、.table-responsive，以及“最新地址/加群/分享动力/
 *     关键词/保存下图”等引流段落（正文段落、图片、视频与评论区一律保留）。
 *   - 播放器广告：DPlayer 前置广告由 player.js 注入，包含三部分——
 *     ①广告图外层 <div class="tjtagmanager" data-ad_type data-event="ad_click">（按 [data-ad_type] 处理）；
 *     ②右上角倒计时文案 <div class="ads_text">（“广告加载中…”/“… 后自动关闭”）；
 *     ③底部进度条 <div style="background: rgba(255, 255, 255, 0.4)">。
 *     ②③ 没有 data-ad_type，需按 .ads_text 与进度条样式单独移除/隐藏。
 *
 * 不作处理：仅保留 #age-verify-overlay（年龄验证，非广告）与
 *   .zq-activity-banner（活动入口导航，非弹窗）。
 */

(() => {
  'use strict';

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[hl365-adblock]', ...args); };

  /* ------------------------------------------------------------------ *
   * 一、请求拦截规则（第一优先）
   * ------------------------------------------------------------------ */

  // 广告 / 追踪 URL 规则。相对 URL 会先解析为绝对 URL 再匹配。
  const AD_PATTERNS = [
    // —— 第三方追踪 ——
    /^https?:\/\/(?:[^/]*\.)?mc\.yandex\.ru\//i,
    /^https?:\/\/(?:[^/]*\.)?googletagmanager\.com\//i,
    /^https?:\/\/(?:[^/]*\.)?google-analytics\.com\//i,
    /^https?:\/\/(?:[^/]*\.)?cloudflareinsights\.com\//i,
    // —— 埋点上报（宿主为 IP:15212 等）——
    /\/api\/eventTracking\/batchReport\.json/i,
    // —— 活动弹窗开关配置（仅该路径，api1.gxmufvxq.cc 其余接口保留）——
    /\/api\.php\/api\/home\/config/i,
    // —— 底部弹出广告 ——
    /\/storage\/static\/popup-feed\.json/i,
    /\/usr\/themes\/Mirages\/js\/bottom_ad_poll\.js/i,
    // —— 活动弹窗脚本与样式 ——
    /\/usr\/plugins\/activity\/js\/popup-(?:lottery|zhongqiu)\.js/i,
    /\/usr\/plugins\/activity\/css\/popup-zhongqiu\.css/i,
    // —— 指纹 / 埋点 SDK ——
    /\/usr\/themes\/Mirages\/js\/7\.10\.0\/(?:fp\.min|tjtag[^/?]*|web-sdk[^/?]*)\.js/i,
    // —— 广告素材图（该目录已确认全部为广告创意）——
    /^https?:\/\/pic\.hdhwqx\.cn\/hc237\/uploads\/default\/other\//i,
  ];

  /** 判断 URL 是否命中广告/追踪规则，兼容相对路径与非法值。 */
  function isAdUrl(url) {
    if (url === null || url === undefined) return false;
    let raw;
    try { raw = String(url); } catch (e) { return false; }
    if (!raw) return false;

    let abs = null;
    try { abs = new URL(raw, location.href).href; } catch (e) { /* 保留 raw 匹配 */ }

    for (const re of AD_PATTERNS) {
      if (re.test(raw)) return true;
      if (abs && re.test(abs)) return true;
    }
    return false;
  }

  /* ---- 1.1 拦截 window.fetch ---- */
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
          // 返回空响应，避免调用方因网络错误抛出未处理异常。
          return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
        }
      } catch (e) { /* 放行，交由原生实现处理 */ }
      return nativeFetch.apply(this, arguments);
    };
  }

  /* ---- 1.2 拦截 XMLHttpRequest ---- */
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try { this.__hl365Blocked = isAdUrl(url); } catch (e) { /* ignore */ }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      if (!this.__hl365Blocked) return nativeSend.apply(this, arguments);

      log('block xhr', this.responseURL || '');
      const self = this;
      // 合成一个“成功但空”的响应，避免依赖方永久挂起。
      window.setTimeout(() => {
        try {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', { value: 200, configurable: true });
          Object.defineProperty(self, 'responseText', { value: '', configurable: true });
          Object.defineProperty(self, 'response', { value: '', configurable: true });
        } catch (e) { /* ignore */ }
        for (const handler of ['onreadystatechange', 'onload', 'onloadend']) {
          if (typeof self[handler] === 'function') {
            try { self[handler](); } catch (e) { /* ignore */ }
          }
        }
      }, 0);
    };
  }

  /* ---- 1.3 拦截 navigator.sendBeacon ---- */
  if (navigator && typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isAdUrl(url)) { log('block beacon', url); return true; }
      return nativeBeacon(url, data);
    };
  }

  /* ---- 1.4 拦截元素资源属性赋值（脚本 / 图片 / iframe / link / source）---- */
  // 站点用惰性加载（z-image-loader-url / data-src）间接加载广告素材，
  // 这里在赋值阶段丢弃广告 URL，阻止其真正发起请求。
  const GUARDED_ATTRS = new Set(['src', 'href', 'srcset', 'data-src', 'z-image-loader-url']);

  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      if (GUARDED_ATTRS.has(String(name).toLowerCase()) && isAdUrl(value)) {
        log('block setAttribute', name, value);
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
        if (isAdUrl(value)) { log('block prop', prop, value); return; }
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

  /* ------------------------------------------------------------------ *
   * 二、页面清理（第二优先：兜底，处理已被 HTML 解析器插入的广告节点）
   * ------------------------------------------------------------------ */

  // 需要移除的广告/推广节点（覆盖已确认的首页广告容器）。
  const REMOVE_SELECTORS = [
    'article.ad-item',          // 信息流广告卡片
    '.post-card-ads',           // 广告卡片遮罩
    '.adspop',                  // 首页弹窗广告
    '.bottom-ads',              // 底部弹出广告
    '#lottery-popup-wrap',      // 抽奖活动弹窗
    '#zq-activity-popup',       // 中秋活动弹窗
    '#aiFloat',                 // 成人 AI 定制悬浮广告
    '.launchapp-btn-container', // “黑料不打烊app内打开”下载提示
    '.launchapp-des',           // 同上（提示链接本体）
    '#foot-menu',               // 页脚：底部导航 + 站点说明/永久域名
    '#footer',                  // 页脚：链接列表 + 社交图标 + 版权/合规
    '.horizontal-banner',       // 首页底部 banner 广告墙（data-page_name=首页底部banner）
  ];

  // 文章页（/archives/*.html）内的推广/引流块（截图所示，需全部移除）。
  // 关键：这些块嵌在正文 <article class="post"> / .post-content 内部，
  // 因此只按“确定的容器”或“标志性文案”精确移除，绝不删除正文段落、图片与视频。
  const ARTICLE_PROMO_SELECTORS = [
    '.article-ads-btn',                 // 正文顶部广告文字链
    '.ads-title',                       // “热门软件 / 精品推荐 / 免费福利”标题
    '.article-bottom-apps',             // 上述标题下的广告链接块
    '.article-content-after',           // “官方免费app / 最新热瓜 / 官方公告”整块
    '#button5',                         // “快分享至抖音”分享悬浮
    '.post-near',                       // “上一篇 / 下一篇”
    '.top_picks_title',                 // “热门推荐”标题
    '.top_picks_wrapper',               // “热门推荐”内容
    '.post-content .content-copyright', // 转载声明引流
    '.post-content .tags',              // 正文标签胶囊
    '.post-content .table-responsive',  // 分类广告网格（今日看料/热门吃瓜/…）
  ];

  // 文章页推广块的标志性文案：命中即移除该元素（信息框 blockquote / 引流段落）。
  const ARTICLE_PROMO_TEXT = [
    '黑料不打烊最新地址',
    '不打烊官方QQ群',
    '你的分享就是小编创作最大的动力',
    '下载黑料不打烊APP',
    '黑料不打烊官方app',
    '可能你会感兴趣的',
    '关键词：',
    '请保存下图发送任意信息到邮箱',
  ];

  const HIDE_CSS = `
    article.ad-item,
    .corner-badge--ad,
    .post-card-ads,
    .adspop,
    .bottom-ads,
    #lottery-popup-wrap,
    #zq-activity-popup,
    #aiFloat,
    .launchapp-btn-container,
    .launchapp-des,
    #foot-menu,
    #footer,
    .horizontal-banner,
    .article-ads-btn,
    .ads-title,
    .article-bottom-apps,
    .article-content-after,
    #button5,
    .post-near,
    .top_picks_title,
    .top_picks_wrapper,
    .post-content .content-copyright,
    .post-content .tags,
    .post-content .table-responsive,
    .dplayer .ads_text,
    .dplayer [style*="rgba(255, 255, 255, 0.4)"],
    [data-ad_type] { display: none !important; }
  `;

  // 2.1 注入隐藏样式（document-start 时 documentElement 通常已存在）
  function injectStyle() {
    if (document.getElementById('hl365-adblock-style')) return;
    const host = document.head || document.documentElement;
    if (!host) return;
    const style = document.createElement('style');
    style.id = 'hl365-adblock-style';
    style.textContent = HIDE_CSS;
    host.appendChild(style);
    // 清理自身：该 style 不是广告节点，不会被 REMOVE_SELECTORS 命中。
  }

  // 2.2 移除广告节点
  function removeAdNodes(scope) {
    const root = (scope && typeof scope.querySelectorAll === 'function') ? scope : document;
    for (const sel of REMOVE_SELECTORS) {
      root.querySelectorAll(sel).forEach((node) => {
        log('remove', sel);
        node.remove();
      });
    }
    // 兜底：按广告标记移除“广告元素本身”，绝不触碰承载正文的 <article>。
    // 注意：文章页会把广告墙与广告链接嵌进 <article class="post">，
    // 因此这里只能移除已知广告容器或广告 <a> 自身，不能用 closest('article')。
    root.querySelectorAll('.corner-badge--ad').forEach((badge) => {
      log('remove ad badge');
      (badge.closest('.ad-item') || badge).remove();
    });
    // 广告元素：既覆盖文章页/详情页 banner 的 <a>，也覆盖播放器“前置广告”
    // 覆盖层（player.js 用 createAdTrackContainer 生成 <div class="tjtagmanager"
    // data-ad_type data-event="ad_click">，绝对定位盖住视频）。故不能只匹配 <a>。
    root.querySelectorAll('[data-ad_type][data-event="ad_click"]').forEach((el) => {
      log('remove ad element');
      const adWrapper = el.closest('.ad-item, .horizontal-banner, .adspop, .bottom-ads');
      (adWrapper || el).remove();
    });

    // 文章页推广清理：仅在存在 .post-content（文章页）时执行，避免影响首页等页面。
    if (root.querySelector('.post-content')) {
      // 推广尾部：自“你的分享就是…”起，删除其后的全部同级节点（纯引流区）。
      // 必须先于“按文案移除”执行：否则该段落会先被删除，导致切片起点丢失。
      root.querySelectorAll('.post-content > p').forEach((node) => {
        if ((node.textContent || '').includes('你的分享就是小编创作最大的动力')) {
          let cur = node;
          const doomed = [];
          while (cur) { doomed.push(cur); cur = cur.nextElementSibling; }
          doomed.forEach((el) => { log('remove promo tail'); el.remove(); });
        }
      });

      // 推广块（确定的容器）。
      for (const sel of ARTICLE_PROMO_SELECTORS) {
        root.querySelectorAll(sel).forEach((node) => {
          log('remove promo', sel);
          node.remove();
        });
      }

      // 推广块（标志性文案：信息框 blockquote / 引流段落）。
      root.querySelectorAll('.post-content p, .post-content blockquote').forEach((node) => {
        const text = (node.textContent || '').replace(/\s+/g, '');
        if (!text) return;
        if (ARTICLE_PROMO_TEXT.some((marker) => text.includes(marker.replace(/\s+/g, '')))) {
          log('remove promo text');
          node.remove();
        }
      });
    }

    // 播放器广告残留：player.js 把广告图外层([data-ad_type]，由上面的规则处理)、
    // 倒计时文案(.ads_text，显示“广告加载中…/…后自动关闭”)与底部进度条
    // (带 rgba(255,255,255,0.4) 背景的绝对定位 div)一起追加到播放器容器内，
    // 后两者没有 data-ad_type，需要单独清除。
    root.querySelectorAll('.dplayer .ads_text').forEach((node) => {
      log('remove ad countdown');
      node.remove();
    });
    root.querySelectorAll('.dplayer [style*="rgba(255, 255, 255, 0.4)"]').forEach((node) => {
      log('remove ad progress');
      node.remove();
    });

    if (root.matches) {
      for (const sel of REMOVE_SELECTORS) {
        if (root.matches(sel)) { log('remove', sel); root.remove(); break; }
      }
    }
  }

  // 2.3 防抖调度，避免对每次 mutation 做昂贵工作
  let cleanupTimer = null;
  function scheduleCleanup() {
    if (cleanupTimer !== null) return;
    cleanupTimer = window.setTimeout(() => {
      cleanupTimer = null;
      removeAdNodes(document);
    }, 50);
  }

  // 2.4 观察页面变化，及时移除动态注入的广告/弹窗
  function startObserver() {
    const target = document.documentElement;
    if (!target) return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList' || m.addedNodes.length === 0) continue;
        scheduleCleanup();
        return;
      }
    });
    observer.observe(target, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  injectStyle();
  removeAdNodes(document);
  startObserver();
  document.addEventListener('DOMContentLoaded', () => { removeAdNodes(document); }, { once: true });
  window.addEventListener('load', () => { removeAdNodes(document); }, { once: true });
})();
