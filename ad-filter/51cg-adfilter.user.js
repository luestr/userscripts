// ==UserScript==
// @name         51吃瓜广告过滤器
// @name:en      51cg Ad Filter
// @namespace    https://github.com/luestr/userscripts
// @version      2.2.0
// @description  过滤 51cg1.com 广告：优先请求拦截（页面上下文 XHR/fetch/Image 钩子 + Tampermonkey @webRequest），其次页面清理。首页：浮标 / 底部横幅 / 弹窗 / 底部悬浮按钮“51吃瓜APP内打开” / 悬浮公告条 / “没有文章标题”的列表广告卡；详情页：顶部文字广告、正文“51吃瓜最新地址/关键词/热门吃瓜”，下载/分享按钮、热门应用/最新上架/必备精品/猜你喜欢、版权段、关键词标签、重磅热瓜、官方公告地址盒、页脚。
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/ad-filter/51cg-adfilter.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/ad-filter/51cg-adfilter.user.js
// @match        *://51cg1.com/*
// @match        *://*.51cg1.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// @webRequest   [{"selector":"*://pic.wvxrrip.cn/hc237/*","action":"cancel"},{"selector":"*://*.zyudkkup.com/*","action":"cancel"},{"selector":"*://mc.yandex.ru/*","action":"cancel"},{"selector":"*://*.googletagmanager.com/*","action":"cancel"},{"selector":"*://*.google-analytics.com/*","action":"cancel"},{"selector":"*://analytics.google.com/*","action":"cancel"},{"selector":"*://*.doubleclick.net/*","action":"cancel"},{"selector":"*://*.googlesyndication.com/*","action":"cancel"}]
// ==/UserScript==

(function () {
    'use strict';

    /* =========================================================================
     *  51cg1.com 广告过滤器
     *
     *  策略（按优先级）：
     *   1) 请求拦截
     *      a. Tampermonkey @webRequest 声明式取消（见脚本头，网络层拦截）
     *      b. 页面上下文运行时钩子（XMLHttpRequest / fetch / Image.src /
     *         Element.setAttribute / window.open）—— 覆盖本引擎等不支持 @webRequest 的场景
     *         本站在 document-start 之后才解析广告脚本，故钩子必须尽早安装。
     *   2) 页面清理（CSS 立即隐藏 + 节点移除 + MutationObserver 动态清理）
     *   3) 广告点击中和（捕获阶段拦截 a.tjtagmanager / 站外落地域名）
     *
     *  经实测（2026-10-09）本站首页广告结构：
     *   - 浮标   : #adFloat.xqbj-component-adfloat  (swiper, data-page_key="float_ads")
     *   - 底部横幅: section.horizontal-block          (data-page_key="home_bottom")
     *   - 列表广告: article.ad-item                   (data-page_key="post_list", #ad-card-N, .post-card-ads)
     *   - 弹窗   : .recommend-layer                   (data-page_key="category", home_pop_ads)
     *   - 无标题软文卡: #index article，其 h2.post-card-title 内只有“热搜 HOT”徽标、无标题文字
     *   - 底部悬浮按钮: .addbox > a.download-box（文案“51吃瓜APP内打开”，落地 https://230.sqfnhloyh.cc）
     *   - 悬浮公告条: .home-announce-bar（“同城约炮/性感尤物…”）
     *   - 广告素材: 全部经 XHR 从 pic.wvxrrip.cn/hc237/ 拉取并解密（内容图走 /upload_01/、/upload/）
     *   - 广告上报: ads.zyudkkup.com/api/eventTracking/report.json (tjtag)
     * ========================================================================= */

    // ---- 用户可调开关 -------------------------------------------------------
    const CONFIG = {
        blockCreatives: true,   // 拦截广告素材图 pic.wvxrrip.cn/hc237/
        blockTrackers: true,    // 拦截第三方统计/追踪 (zyudkkup / yandex / gtm / ga / doubleclick)
        blockLanding: true,     // 拦截广告落地域名（点击 / 弹窗）
        removeNoTitle: true,    // 移除“没有文章标题”的列表广告卡
    };

    /* -------------------------------------------------------------------------
     * 0. 请求拦截规则（以字符串保存，便于注入页面上下文后重建 RegExp）
     * ---------------------------------------------------------------------- */

    // 广告素材：仅 /hc237/ 路径为广告；内容缩略图在 /upload_01/ 与 /upload/，切勿误伤
    const CREATIVE_PATTERNS = [
        'pic\\.wvxrrip\\.cn/hc237/',
    ];
    // 第三方统计 / 广告上报
    const TRACKER_PATTERNS = [
        'zyudkkup\\.com',            // 站内广告点击/曝光上报 apiEndpoint
        'mc\\.yandex\\.ru',          // Yandex Metrika
        'googletagmanager\\.com',    // Google Tag Manager / gtag
        'google-analytics\\.com',    // Google Analytics
        'analytics\\.google\\.com',
        'doubleclick\\.net',
        'googlesyndication\\.com',
        'googleadservices\\.com',
    ];
    // 广告落地域名（点击/弹窗的中和对象）
    const LANDING_PATTERNS = [
        'gbkhj341\\.com',
        'vfegt910\\.com',
        '05681032\\.com',
        '55730251\\.com',
        '32535634\\.com',
        '82015313\\.com',
        '154\\.201\\.192\\.169',
        'iwangzi\\.com',
        'qddcjy\\.com',
        'sqfnhloyh\\.cc',   // 底部悬浮按钮“51吃瓜APP内打开”的落地域名
        'wtpntjz\\.cc',
        'hailiao60\\.com',   // 详情页文字广告“51裸聊”
        'hgdj9\\.com',       // 详情页文字广告“黄瓜短剧”
        'ushvkvsii\\.cc',    // 详情页文字广告“51短剧”
        'rbofzoubn\\.cc',    // 详情页“官方公告”福利导航
        'dumlhsqb\\.cc',     // 镜像域名劫持跳转目标
        '2622885\\.cc',
        '9751231\\.cc',
        '2690125\\.cc',
        '5836312\\.cc',
        '3920278\\.cc',
        '5648579\\.cc',
        '22e85s7\\.vip',
        'pj74qhg\\.me',
        'ktho480\\.cc',
        '2orjnav\\.me',
        'pj51nc-[0-9]+\\.ap-northeast-2\\.elb\\.amazonaws\\.com',
    ];

    const HOOK_CFG = {
        creatives: CREATIVE_PATTERNS,
        trackers: TRACKER_PATTERNS,
        landing: LANDING_PATTERNS,
        blockCreatives: CONFIG.blockCreatives,
        blockTrackers: CONFIG.blockTrackers,
        blockLanding: CONFIG.blockLanding,
    };

    /* -------------------------------------------------------------------------
     * 1. 页面上下文运行时钩子安装器
     *    —— 自包含（不引用外层作用域），可同时用于 unsafeWindow 直连与页面内 <script> 注入
     * ---------------------------------------------------------------------- */
    function installHooks(win, cfg) {
        if (!win || win.__cgAdFilterHooked) return;
        try { win.__cgAdFilterHooked = true; } catch (e) { return; }

        var CRE = new RegExp(cfg.creatives.join('|'), 'i');
        var TRK = new RegExp(cfg.trackers.join('|'), 'i');
        var LAND = new RegExp(cfg.landing.join('|'), 'i');

        function abs(u) {
            try { return new URL(String(u), (win.location && win.location.href) || undefined).href; }
            catch (e) { return String(u || ''); }
        }
        // 需要取消的“资源/上报”请求
        function isBlocked(u) {
            if (!u) return false;
            var s = abs(u);
            if (cfg.blockCreatives && CRE.test(s)) return true;
            if (cfg.blockTrackers && TRK.test(s)) return true;
            return false;
        }
        // 广告落地域名
        function isLanding(u) {
            if (!u) return false;
            if (!cfg.blockLanding) return false;
            return LAND.test(abs(u));
        }

        // 1.1 XMLHttpRequest（本站广告素材/上报均走 jQuery $.ajax -> XHR）
        try {
            var XP = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
            if (XP && XP.open && XP.send && !XP.open.__cgHooked) {
                var oOpen = XP.open, oSend = XP.send;
                XP.open = function (m, u) {
                    try { this.__cgBlocked = isBlocked(u); } catch (e) { }
                    return oOpen.apply(this, arguments);
                };
                XP.open.__cgHooked = true;
                XP.send = function () {
                    if (this.__cgBlocked) {
                        try { this.abort(); } catch (e) { }
                        return;
                    }
                    return oSend.apply(this, arguments);
                };
            }
        } catch (e) { /* ignore */ }

        // 1.2 fetch
        try {
            if (typeof win.fetch === 'function' && !win.fetch.__cgHooked) {
                var oFetch = win.fetch;
                var nf = function (input, init) {
                    try {
                        var u = (typeof input === 'string') ? input : (input && input.url);
                        if (isBlocked(u)) return Promise.reject(new DOMException('blocked', 'AbortError'));
                    } catch (e) { }
                    return oFetch.apply(this, arguments);
                };
                nf.__cgHooked = true;
                win.fetch = nf;
            }
        } catch (e) { /* ignore */ }

        // 1.3 navigator.sendBeacon
        try {
            var nav = win.navigator;
            if (nav && typeof nav.sendBeacon === 'function' && !nav.sendBeacon.__cgHooked) {
                var oBeacon = nav.sendBeacon;
                var nb = function (u) {
                    try { if (isBlocked(u)) return true; } catch (e) { }
                    return oBeacon.apply(this, arguments);
                };
                nb.__cgHooked = true;
                nav.sendBeacon = nb;
            }
        } catch (e) { /* ignore */ }

        // 1.4 元素 URL 属性 setter（src / href）—— 覆盖 new Image().src 等
        function hookProp(proto, prop) {
            try {
                if (!proto) return;
                var d = Object.getOwnPropertyDescriptor(proto, prop);
                if (!d || !d.set || d.set.__cgHooked) return;
                var oSet = d.set;
                var ns = function (v) {
                    try { if (isBlocked(v)) return; } catch (e) { }
                    return oSet.call(this, v);
                };
                ns.__cgHooked = true;
                Object.defineProperty(proto, prop, {
                    configurable: true,
                    enumerable: d.enumerable,
                    get: function () { return d.get ? d.get.call(this) : undefined; },
                    set: ns,
                });
            } catch (e) { /* ignore */ }
        }
        try {
            hookProp(win.HTMLImageElement && win.HTMLImageElement.prototype, 'src');
            hookProp(win.HTMLScriptElement && win.HTMLScriptElement.prototype, 'src');
            hookProp(win.HTMLIFrameElement && win.HTMLIFrameElement.prototype, 'src');
            hookProp(win.HTMLLinkElement && win.HTMLLinkElement.prototype, 'href');
        } catch (e) { /* ignore */ }

        // 1.5 Element.setAttribute('src'|'href')
        try {
            var EP = win.Element && win.Element.prototype;
            if (EP && EP.setAttribute && !EP.setAttribute.__cgHooked) {
                var oSA = EP.setAttribute;
                var nSA = function (name, value) {
                    try {
                        var n = String(name).toLowerCase();
                        if ((n === 'src' || n === 'href') && isBlocked(value)) return;
                    } catch (e) { }
                    return oSA.apply(this, arguments);
                };
                nSA.__cgHooked = true;
                EP.setAttribute = nSA;
            }
        } catch (e) { /* ignore */ }

        // 1.6 window.open —— 拦截广告落地弹窗
        try {
            if (typeof win.open === 'function' && !win.open.__cgHooked) {
                var oOpen2 = win.open;
                var nOpen = function (u) {
                    try { if (isLanding(u)) return null; } catch (e) { }
                    return oOpen2.apply(this, arguments);
                };
                nOpen.__cgHooked = true;
                win.open = nOpen;
            }
        } catch (e) { /* ignore */ }
    }

    // 安装：unsafeWindow 直连 + 页面内 <script> 注入（双保险，去重由 __cgAdFilterHooked 保证）
    const U = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
    try { installHooks(U, HOOK_CFG); } catch (e) { /* ignore */ }
    try {
        const s = document.createElement('script');
        s.textContent = '(' + installHooks.toString() + ')(window,' + JSON.stringify(HOOK_CFG) + ');';
        (document.head || document.documentElement).appendChild(s);
        s.remove();
    } catch (e) { /* ignore */ }

    /* -------------------------------------------------------------------------
     * 2. 页面清理
     * ---------------------------------------------------------------------- */

    // 广告容器/元素选择器（均为实测命中的真实结构）
    const AD_SELECTORS = [
        '#adFloat',                    // 浮标广告容器
        '.xqbj-component-adfloat',     // 浮标广告容器类
        'section.horizontal-block',    // 首页底部横幅广告区
        'article.ad-item',             // 列表广告卡（首页信息流）
        '.ad-item',
        '[id^="ad-card-"]',            // 列表广告卡内部 id
        '.post-card-ads',              // 列表广告卡遮罩
        'a.tjtagmanager',              // 广告落地链接
        '.tjtagmanager',               // 广告图片/容器
        '.ai-link-ad',                 // 浮标内的 AI 导流广告
        '.recommend-layer',            // 首页弹窗广告层
        '.recommend-wrapper',
        '.recommend-card',
        '.addbox',                     // 底部悬浮按钮容器（“51吃瓜APP内打开”）
        '.addbox .download-box',       // 底部悬浮按钮本体
        '.download-box',
        '.home-announce-bar',          // 底部悬浮公告条（“同城约炮/性感尤物…”）
        // ---- 文章详情页（/archives/*）推广位 ----
        '.txt-apps',                   // 详情页顶部文字广告按钮组（text_top_apps）
        '.ads-title',                  // 详情页底部“热门应用/最新上架/必备精品/猜你喜欢”标题
        '.article-bottom-apps',        // 详情页底部 App 图标广告
        '.content-copyright',          // 详情页“该文章由…发布”版权段
        '.tags',                       // 详情页关键词标签胶囊
        '.hot-news-section',           // 详情页“重磅热瓜”区块
        '.content-tabs',               // 详情页“官方公告”地址盒（下载App/福利导航/回家PDF/提示）
        '.btn-download',               // 详情页“下载APP观看完整版”按钮
        '.copy-box',                   // 详情页“分享好友吃瓜”按钮
        '#foot-menu',                  // 页脚（图标导航 + 官方描述 + 链接 + 社交图标）
    ];
    const AD_SELECTOR_STR = AD_SELECTORS.join(',');

    const AD_CSS =
        '#adFloat,.xqbj-component-adfloat,section.horizontal-block,' +
        'article.ad-item,.ad-item,[id^="ad-card-"],.post-card-ads,' +
        'a.tjtagmanager,.tjtagmanager,.ai-link-ad,' +
        '.recommend-layer,.recommend-wrapper,.recommend-card,' +
        '.addbox,.addbox .download-box,.download-box,.home-announce-bar,' +
        '.txt-apps,.ads-title,.article-bottom-apps,.content-copyright,' +
        '.tags,.hot-news-section,.content-tabs,.btn-download,.copy-box,#foot-menu' +
        '{display:none !important;visibility:hidden !important}' ;

    function injectCss() {
        try { if (typeof GM_addStyle === 'function') { GM_addStyle(AD_CSS); return; } } catch (e) { }
        try {
            const s = document.createElement('style');
            s.textContent = AD_CSS;
            (document.head || document.documentElement || document).appendChild(s);
        } catch (e) { /* ignore */ }
    }

    function qsa(sel, root) {
        try { return (root || document).querySelectorAll(sel); } catch (e) { return []; }
    }

    // 列表卡“文章标题”文字：去掉“热搜 HOT”徽标后的纯文本
    // 广告卡的特征 —— h2.post-card-title 内只有 <div class="wrap"><span class="wraps">热搜 HOT</span></div>，
    // 没有真正的标题文字；列表广告卡(.ad-item)则完全没有 .post-card-title。
    function cardTitleText(card) {
        if (!card) return '';
        const h = card.querySelector('.post-card-title');
        if (!h) return '';
        let clone;
        try { clone = h.cloneNode(true); } catch (e) { return (h.textContent || '').replace(/\s+/g, ''); }
        const wraps = clone.querySelectorAll('.wrap, .wraps');
        for (let i = 0; i < wraps.length; i++) { try { wraps[i].remove(); } catch (e) { } }
        return (clone.textContent || '').replace(/\s+/g, '');
    }

    function isAdNode(node) {
        if (!node || node.nodeType !== 1) return false;
        try { return node.matches(AD_SELECTOR_STR); } catch (e) { return false; }
    }

    // 移除“没有文章标题”的列表卡片（核心特征，与位置无关）
    // 仅在文档解析完成后执行，避免标题子节点尚未插入导致误删。
    function removeNoTitleCards() {
        if (!CONFIG.removeNoTitle) return;
        if (document.readyState === 'loading') return;
        const arts = qsa('#index article');
        for (let i = 0; i < arts.length; i++) {
            const a = arts[i];
            try {
                if (a.matches('.ad-item') || a.querySelector('.post-card-ads,[id^="ad-card-"]')) {
                    a.remove();                      // 明确的广告卡
                    continue;
                }
                const card = a.querySelector('.post-card');
                if (card && cardTitleText(card) === '') {
                    a.remove();                      // 无标题 -> 广告软文卡
                }
            } catch (e) { /* ignore */ }
        }
    }

    // 详情页正文内的“软文/推广”块（无固定 class，按文案特征移除）
    //   - <blockquote>🔗 51吃瓜最新地址 …</blockquote>
    //   - <p>关键词：#…</p>
    //   - <p><strong>🔥 热门吃瓜</strong></p> + 紧随其后的分类 <table>
    //   - <p>版权声明：…</p>
    function cleanArticleContent() {
        if (document.readyState === 'loading') return;
        let body = null;
        try {
            body = document.querySelector('.post-content[itemprop="articleBody"]') ||
                document.querySelector('.post-content');
        } catch (e) { /* ignore */ }
        if (!body) return;

        // 1) “51吃瓜最新地址”引用框
        let bqs;
        try { bqs = body.querySelectorAll('blockquote'); } catch (e) { bqs = []; }
        for (let i = 0; i < bqs.length; i++) {
            try { if (/51吃瓜最新地址/.test(bqs[i].textContent || '')) bqs[i].remove(); } catch (e) { }
        }

        // 2) 关键词 / 版权声明 / 热门吃瓜 标题段
        let ps;
        try { ps = body.querySelectorAll('p'); } catch (e) { ps = []; }
        for (let i = 0; i < ps.length; i++) {
            const p = ps[i];
            const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) continue;
            if (t.indexOf('关键词：') === 0 || t.indexOf('关键词:') === 0) { try { p.remove(); } catch (e) { } continue; }
            if (t.indexOf('版权声明') === 0) { try { p.remove(); } catch (e) { } continue; }
            if (t.length < 20 && t.indexOf('热门吃瓜') !== -1) {
                const nx = p.nextElementSibling;
                if (nx && nx.tagName === 'TABLE') { try { nx.remove(); } catch (e) { } }
                try { p.remove(); } catch (e) { }
            }
        }

        // 3) “热门吃瓜”分类表格（含 吃瓜中心/今日吃瓜 链接）
        let tbs;
        try { tbs = body.querySelectorAll('table'); } catch (e) { tbs = []; }
        for (let i = 0; i < tbs.length; i++) {
            const t = tbs[i].textContent || '';
            try { if (t.indexOf('吃瓜中心') !== -1 || t.indexOf('今日吃瓜') !== -1) tbs[i].remove(); } catch (e) { }
        }
    }

    function sweep(root) {
        const scope = (root && root.querySelectorAll) ? root : document;
        try {
            if (scope !== document && isAdNode(scope)) { scope.remove(); return; }
        } catch (e) { /* ignore */ }
        for (let i = 0; i < AD_SELECTORS.length; i++) {
            const nodes = qsa(AD_SELECTORS[i], scope);
            for (let j = 0; j < nodes.length; j++) {
                try { nodes[j].remove(); } catch (e) { /* ignore */ }
            }
        }
    }

    // 无标题清理做防抖，避免解析过程中误删
    let noTitleTimer = null;
    function scheduleNoTitleCleanup() {
        if (noTitleTimer) return;
        noTitleTimer = setTimeout(function () {
            noTitleTimer = null;
            try { removeNoTitleCards(); } catch (e) { /* ignore */ }
            try { cleanArticleContent(); } catch (e) { /* ignore */ }
        }, 300);
    }

    /* -------------------------------------------------------------------------
     * 3. 广告点击中和（捕获阶段）
     * ---------------------------------------------------------------------- */
    const LANDING_RE = new RegExp(LANDING_PATTERNS.join('|'), 'i');
    function isLandingHref(href) {
        try {
            const u = new URL(String(href), (U.location && U.location.href) || undefined);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
            return LANDING_RE.test(u.href);
        } catch (e) { return false; }
    }
    function onCaptureClick(e) {
        try {
            const t = e.target;
            const a = t && t.closest ? t.closest('a[href]') : null;
            if (!a) return;
            const isAdAnchor = a.matches('.tjtagmanager,[data-event="ad_click"],[data-page_key]') ||
                isLandingHref(a.getAttribute('href') || a.href);
            if (isAdAnchor) {
                e.preventDefault();
                e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                const box = a.closest('#adFloat,section.horizontal-block,article.ad-item,.recommend-layer');
                if (box) { try { box.remove(); } catch (err) { } }
            }
        } catch (err) { /* ignore */ }
    }

    /* -------------------------------------------------------------------------
     * 4. 启动
     * ---------------------------------------------------------------------- */
    injectCss();
    sweep(document);
    try { document.addEventListener('click', onCaptureClick, true); } catch (e) { }

    // MutationObserver：清理动态注入的广告位/弹窗
    try {
        const observer = new MutationObserver(function (muts) {
            for (let i = 0; i < muts.length; i++) {
                const m = muts[i];
                if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
                    for (let j = 0; j < m.addedNodes.length; j++) {
                        const n = m.addedNodes[j];
                        if (!n || n.nodeType !== 1) continue;
                        if (isAdNode(n)) { try { n.remove(); } catch (e) { } }
                        else { sweep(n); }
                    }
                } else if (m.type === 'attributes' && m.target && isAdNode(m.target)) {
                    try { m.target.remove(); } catch (e) { }
                }
            }
            scheduleNoTitleCleanup();
        });
        observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) { /* ignore */ }

    // 生命周期钩子
    try { document.addEventListener('readystatechange', function () { sweep(document); scheduleNoTitleCleanup(); }); } catch (e) { }
    try { document.addEventListener('DOMContentLoaded', function () { sweep(document); scheduleNoTitleCleanup(); }); } catch (e) { }
    try { window.addEventListener('load', function () { sweep(document); scheduleNoTitleCleanup(); }); } catch (e) { }

    // 前 ~12s 每 400ms 兜底清理一次（应对延迟渲染的弹窗/浮标）
    let ticks = 0;
    try {
        const timer = setInterval(function () {
            sweep(document);
            scheduleNoTitleCleanup();
            if (++ticks >= 30) clearInterval(timer);
        }, 400);
    } catch (e) { /* ignore */ }

    /* -------------------------------------------------------------------------
     * 5. 菜单命令
     * ---------------------------------------------------------------------- */
    try {
        if (typeof GM_getValue === 'function') {
            CONFIG.blockCreatives = GM_getValue('blockCreatives', CONFIG.blockCreatives);
            CONFIG.blockTrackers = GM_getValue('blockTrackers', CONFIG.blockTrackers);
            CONFIG.removeNoTitle = GM_getValue('removeNoTitle', CONFIG.removeNoTitle);
        }
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand((CONFIG.removeNoTitle ? '✅ ' : '⬜ ') + '移除“无标题”列表广告卡（刷新生效）', function () {
                CONFIG.removeNoTitle = !CONFIG.removeNoTitle;
                try { GM_setValue('removeNoTitle', CONFIG.removeNoTitle); } catch (e) { }
                location.reload();
            });
            GM_registerMenuCommand((CONFIG.blockCreatives ? '✅ ' : '⬜ ') + '拦截广告素材图（刷新生效）', function () {
                CONFIG.blockCreatives = !CONFIG.blockCreatives;
                try { GM_setValue('blockCreatives', CONFIG.blockCreatives); } catch (e) { }
                location.reload();
            });
            GM_registerMenuCommand((CONFIG.blockTrackers ? '✅ ' : '⬜ ') + '拦截第三方统计/追踪（刷新生效）', function () {
                CONFIG.blockTrackers = !CONFIG.blockTrackers;
                try { GM_setValue('blockTrackers', CONFIG.blockTrackers); } catch (e) { }
                location.reload();
            });
        }
    } catch (e) { /* ignore */ }

})();
