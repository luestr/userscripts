// ==UserScript==
// @name         unfaird IPA Decrypt Service — 简体中文 i18n
// @namespace    https://github.com/luestr/userscripts
// @version      1.1.1
// @description  将 decrypt.34306.lol 界面翻译为简体中文，并将 App Store 区域默认选为「中国」
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/i18n/decrypt.34306.lol-zh-CN.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/i18n/decrypt.34306.lol-zh-CN.js
// @match        https://decrypt.34306.lol/*
// @match        http://decrypt.34306.lol/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------
     * 目标：让页面直接以简体中文呈现。
     * 站点是纯静态 SPA，所有文案都通过 innerHTML / textContent 动态写入，
     * 且每个字符串都带越南语特有字符（ă â đ ê ô ơ ư 及各种声调符号）。
     * 因此这里采用「全量字符串映射 + 文本节点翻译」的方式：
     *   1. 用 MutationObserver 监听 DOM 增删，节点一出现就翻译；
     *   2. 用 Object.defineProperty 接管 placeholder / title / value 等属性；
     *   3. 拦截 alert()，让错误提示也是中文；
     *   4. 不提供任何语言切换界面，也不保留原文回退入口。
     *
     * 另含一项功能增强：App Store 区域默认选中「中国」（站点原本默认越南）。
     * ---------------------------------------------------------------- */

    // ========== 越南语 → 简体中文 映射表 ==========
    const DICT = [
        // ---- 页面标题 / 品牌 ----
        ['unfaird', 'unfaird'],
        ['IPA Decrypt Service', 'IPA 解密服务'],
        ['IPA DECRYPT SERVICE', 'IPA 解密服务'],

        // ---- 登录 / 注册弹窗 ----
        ['Đăng nhập để tải app mới. App có sẵn thì tải không cần đăng nhập.',
            '登录后才能下载新应用；已缓存的应用无需登录即可下载。'],
        ['Đăng nhập', '登录'],
        ['Đăng ký', '注册'],
        ['Tên của bạn', '你的昵称'],
        ['Mật khẩu', '密码'],
        ['Chưa có tài khoản? Đăng ký', '还没有账号？立即注册'],
        ['Đã có tài khoản? Đăng nhập', '已有账号？去登录'],
        ['Đăng ký xong, đăng nhập nhé', '注册成功，请登录'],
        ['Về trang chủ', '返回首页'],

        // ---- 账户栏 ----
        ['🔓 Mở · tải không giới hạn', '🔓 开放 · 不限下载'],
        ['🔓 Mở · không giới hạn', '🔓 开放 · 无限制'],
        ['chờ duyệt', '待审核'],
        ['Thoát', '退出登录'],
        ['Admin', '管理'],

        // ---- 搜索区 ----
        ['App Name', '应用名称'],
        ['Bundle ID', '应用包名'],
        ['Search iOS apps...', '搜索 iOS 应用…'],
        ['Search Apple TV (tvOS) apps...', '搜索 Apple TV (tvOS) 应用…'],
        ['Search Vision Pro (visionOS) apps...', '搜索 Vision Pro (visionOS) 应用…'],
        ['com.example.appname', 'com.example.appname'],
        ['Search', '搜索'],
        ['Decrypt', '解密'],
        ['App Store region', 'App Store 区域'],
        ['Platform', '平台'],
        ['Vietnam', '越南'],
        ['China', '中国'],
        ['Japan', '日本'],
        ['USA', '美国'],
        ['iPhone / iPad', 'iPhone / iPad'],
        ['Apple TV · tvOS', 'Apple TV · tvOS'],
        ['Vision Pro · visionOS', 'Vision Pro · visionOS'],

        // ---- 列表 / 卡片状态 ----
        ['Recently Decrypted', '最近解密'],
        ['Top Free Apps', '热门免费应用'],
        ['Purchased', '已购买'],
        ['cached:', '已缓存：'],
        ['Download', '下载'],
        ['Processing', '处理中'],
        ['Versions', '版本'],
        ['Cached', '缓存'],
        ['▾ Versions', '▾ 版本'],
        ['▲ Versions', '▲ 版本'],
        ['▾ Cached', '▾ 缓存'],
        ['▲ Cached', '▲ 缓存'],
        ['↻ Latest v', '↻ 最新 v'],
        ['Searching...', '搜索中…'],
        ['Search failed', '搜索失败'],
        ['No free apps found', '未找到免费应用'],
        ['Looking up ', '正在查询 '],
        ['Decrypt bản mới nhất', '解密商店最新版本'],
        ['Tải + decrypt bản mới nhất trên store', '下载并解密商店最新版本'],
        ['Decrypted Mach-O binaries only', '仅解密后的 Mach-O 二进制文件'],
        ['Decrypt bản mới nhất', '解密最新版本'],
        ['Unknown', '未知'],

        // ---- 包名输入校验提示 ----
        ['Đây là một đường link', '这看起来是一个链接'],
        ['Đây có vẻ là tên app', '这似乎是应用名称'],
        ['Sai định dạng Bundle ID', 'Bundle ID 格式错误'],
        ['Ô này chỉ nhận', '该输入框只接受'],
        ['(vd:', '（例如：'],
        ['Muốn tìm theo', '想按'],
        ['tên app', '应用名称'],
        ['→ bấm tab', '→ 请点击上方'],
        ['ở trên.', '标签页。'],
        ['<b>Bundle ID</b>', '<b>Bundle ID</b>'],
        ['<b>App Name</b>', '<b>应用名称</b>'],

        // ---- 任务面板 ----
        ['Completed', '已完成'],
        ['Failed', '失败'],
        ['downloading', '下载中'],
        ['purchasing', '购买中'],
        ['decrypting', '解密中'],
        ['waiting_decrypt', '等待解密'],
        ['waiting decrypt', '等待解密'],
        ['Waiting', '等待中'],
        ['queued', '排队中'],
        ['pending', '等待中'],
        ['ready', '就绪'],
        ['Processing', '处理中'],

        // ---- 队列 ----
        ['Queue', '队列'],
        ['workers', '个线程'],
        ['waiting decrypt', '等待解密'],

        // ---- 版本选择面板 ----
        ['version trên store · chọn bản để decrypt', '个商店版本 · 选择要解密的版本'],
        ['version đã decrypt · tải ngay, không decrypt lại', '个已解密版本 · 可直接下载，无需重新解密'],
        ['Đang lấy danh sách version…', '正在获取版本列表…'],
        ['Đang tải cache…', '正在加载缓存…'],
        ['Không lấy được version cho app này (cần đăng nhập account vùng này / app không có trên store).',
            '无法获取该应用的版本列表（需要登录该区域账号，或该应用不在此商店）。'],
        ['Chưa có version nào của app này trong cache.', '该应用暂无已缓存的版本。'],
        ['Xem thêm version cũ hơn', '查看更多历史版本'],
        ['Đang tải…', '加载中…'],
        ['latest', '最新'],
        ['đã có', '已缓存'],

        // ---- 暂停横幅 ----
        ['⏸ Đang tạm dừng nhận app mới (bảo trì/nâng cấp). Các app đang trong hàng đợi vẫn chạy.',
            '⏸ 已暂停接收新的应用请求（维护/升级中）。队列中已有的应用仍会继续处理。'],

        // ---- 捐赠栏 ----
        ['yeah i maintain this web for free, feel free to', '本站由我免费维护，欢迎'],
        ['buy me some token for claude code/codex', '请我喝杯咖啡（Claude Code / Codex 额度）'],
        ['☕', '☕'],
    ];

    // ---- 精确匹配用（整串相等才翻译，避免误伤 app 名称/包名） ----
    const EXACT = new Map();
    // ---- 片段替换用（多处出现、可安全内联替换的词） ----
    const FRAGMENT = new Map();

    for (const [vi, zh] of DICT) {
        // 含越南语字符的短词一律走精确匹配；长句同样精确匹配。
        EXACT.set(vi, zh);
    }

    // 片段级替换：仅限不会与 app 名称/包名冲突的 UI 词。
    // 顺序敏感：长片段务必排在短片段之前。
    const FRAGMENTS = [
        // ---- 包名校验提示（整块 HTML 是一个文本节点） ----
        ['Đây là một đường link', '这看起来是一个链接'],
        ['Đây có vẻ là tên app', '这似乎是应用名称'],
        ['Sai định dạng Bundle ID', 'Bundle ID 格式错误'],
        ['Ô này chỉ nhận <b>Bundle ID</b> (vd: ', '该输入框只接受 <b>Bundle ID</b>（例如：'],
        [').<br>Muốn tìm theo <b>tên app</b> → bấm tab <b>App Name</b> ở trên.',
            '）。<br>想按 <b>应用名称</b> 搜索 → 请点击上方的 <b>应用名称</b> 标签页。'],
        // ---- 账户栏剩余额度：còn {n}/{m} app hôm nay ----
        ['còn ', '剩余 '],
        [' app hôm nay', ' 个应用额度（今日）'],
        // ---- 队列标题：Queue (N workers) ----
        ['Queue (', '队列（'],
        [' workers)', ' 个线程）'],
        // ---- 版本 / 缓存面板 ----
        [' version trên store · chọn bản để decrypt', ' 个商店版本 · 选择要解密的版本'],
        [' version đã decrypt · tải ngay, không decrypt lại', ' 个已解密版本 · 可直接下载，无需重新解密'],
        ['Đang lấy danh sách version…', '正在获取版本列表…'],
        ['Đang tải cache…', '正在加载缓存…'],
        ['Chưa có version nào của app này trong cache.', '该应用暂无已缓存的版本。'],
        ['Không lấy được version cho app này (cần đăng nhập account vùng này / app không có trên store).',
            '无法获取该应用的版本列表（需要登录该区域账号，或该应用不在此商店）。'],
        ['Xem thêm version cũ hơn', '查看更多历史版本'],
        ['Đang tải…', '加载中…'],
    ];

    // ---------- 词条查表 ----------
    function translate(text) {
        if (!text) return text;
        const raw = text;
        const trimmed = raw.trim();
        if (!trimmed) return raw;

        // 1) 整串精确匹配（保留首尾空白）
        if (EXACT.has(trimmed)) {
            const lead = raw.slice(0, raw.indexOf(trimmed));
            const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
            return lead + EXACT.get(trimmed) + tail;
        }

        let out = raw;
        let changed = false;

        // 1.5) 前置 emoji / 旗帜符号：如 "🇻🇳 Vietnam"、"📱 iPhone / iPad"
        //      拆出前缀符号，仅翻译其后的实体文本。
        const m = trimmed.match(/^([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]+\s*)(.+)$/u);
        if (m && EXACT.has(m[2].trim())) {
            const rest = m[2].trim();
            const newRest = EXACT.get(rest);
            return out.replace(rest, newRest);
        }

        // 2) 片段替换
        for (const [vi, zh] of FRAGMENTS) {
            if (out.indexOf(vi) !== -1) {
                out = out.split(vi).join(zh);
                changed = true;
            }
        }
        if (changed) return out;

        // 3) 前缀型（如 "Looking up com.xxx..." / "↻ Latest v1.2.3"）
        if (trimmed.startsWith('Looking up ')) {
            return raw.replace('Looking up ', '正在查询 ');
        }
        if (/^[▾▴↻]\s*Latest v/.test(trimmed)) {
            return raw.replace('Latest v', '最新 v');
        }

        return raw;
    }

    // ---------- 判定节点是否属于用户可控内容（不翻译） ----------
    function skipNode(node) {
        const p = node.parentNode;
        if (!p || !p.tagName) return false;
        const tag = p.tagName.toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return true;
        // 包名 / 应用名 / 版本号等动态内容不要动：
        // 交由 translate() 的精确匹配保证，不在这里粗暴跳过。
        return false;
    }

    // ---------- 翻译单个文本节点 ----------
    function translateTextNode(node) {
        if (skipNode(node)) return;
        const data = node.nodeValue;
        if (!data) return;
        const next = translate(data);
        if (next !== data) node.nodeValue = next;
    }

    // ---------- 翻译元素属性 ----------
    const ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'value'];
    function translateElementAttrs(el) {
        if (!el || el.nodeType !== 1) return;
        for (const a of ATTRS) {
            if (!el.hasAttribute || !el.hasAttribute(a)) continue;
            const cur = el.getAttribute(a);
            const next = translate(cur);
            if (next !== cur) el.setAttribute(a, next);
        }
    }

    // ---------- 遍历子树 ----------
    function walk(root) {
        if (!root) return;
        if (root.nodeType === 3) {           // 文本节点
            translateTextNode(root);
            return;
        }
        if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;

        if (root.nodeType === 1) translateElementAttrs(root);

        // 用 TreeWalker 但避开 script/style
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
            acceptNode(n) {
                if (n.nodeType === 1) {
                    const t = n.tagName.toUpperCase();
                    if (t === 'SCRIPT' || t === 'STYLE' || t === 'CODE' || t === 'PRE') {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let n;
        while ((n = walker.nextNode())) {
            if (n.nodeType === 3) translateTextNode(n);
            else translateElementAttrs(n);
        }
        // 根节点自身文本（TreeWalker 从根的子节点开始）
        if (root.nodeType === 1 && root.firstChild === null) translateTextNode(root);
    }

    // ---------- alert 拦截 ----------
    const nativeAlert = window.alert;
    window.alert = function (msg) {
        return nativeAlert.call(window, translate(String(msg == null ? '' : msg)));
    };

    // ---------- MutationObserver ----------
    function startObserver() {
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'characterData') {
                    translateTextNode(m.target);
                    continue;
                }
                for (const node of m.addedNodes) {
                    if (node.nodeType === 3) translateTextNode(node);
                    else if (node.nodeType === 1) walk(node);
                }
                if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
                    translateElementAttrs(m.target);
                }
            }
        });
        obs.observe(document.documentElement || document, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ATTRS,
        });
        return obs;
    }

    // ========== 新增功能：App Store 区域默认选中「中国」 ==========
    // 站点内联脚本里写死 `let region='vn'`（默认越南），HTML 中 #region 也默认选中越南，
    // 且区域不做任何持久化，因此每次加载都会回到越南。
    // 这里在站点脚本就绪后把 #region 切到中国，并派发 change 事件，
    // 由站点自身的 onRegionChange() 把内部 region 变量同步为 'cn'。
    const DEFAULT_REGION = 'cn';       // 目标默认区域：中国
    const SITE_DEFAULT_REGION = 'vn';  // 站点原始默认区域：越南

    function applyDefaultRegion() {
        const sel = document.getElementById('region');
        if (!sel) return false;
        if (sel.dataset.zhRegionApplied === '1') return true;   // 只处理一次
        sel.dataset.zhRegionApplied = '1';
        // 仅当仍处于站点默认值时才切换，避免覆盖用户手动选择过的区域
        if (sel.value !== SITE_DEFAULT_REGION) return true;
        sel.value = DEFAULT_REGION;
        // 触发站点 onchange="onRegionChange()"，同步其内部 region 变量
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        // onRegionChange() 内部会调用 _clearView() 清空列表，这里补回一次首屏列表
        if (typeof window.loadFeatured === 'function') {
            try { window.loadFeatured(); } catch (e) {}
        }
        return true;
    }

    // 站点内联脚本位于 body 末尾，需等 onRegionChange 定义后（脚本执行完）再切换，
    // 这样派发的 change 事件才能被站点正确处理。
    function bootDefaultRegion() {
        let tries = 0;
        const timer = setInterval(() => {
            const ready = document.getElementById('region') &&
                typeof window.onRegionChange === 'function';
            if (ready) {
                applyDefaultRegion();
                clearInterval(timer);
            } else if (++tries >= 300) {   // 约 3s 兜底
                applyDefaultRegion();
                clearInterval(timer);
            }
        }, 10);
    }

    // ---------- 首屏处理 ----------
    function boot() {
        const root = document.documentElement || document;
        walk(root);
        startObserver();
        bootDefaultRegion();   // 新增：把 App Store 区域默认切到「中国」
        // 站点会在极短时间内多次重绘，补几次全量扫描兜底
        let ticks = 0;
        const t = setInterval(() => {
            walk(document.documentElement || document);
            if (++ticks >= 20) clearInterval(t);
        }, 150);
    }

    if (document.documentElement) boot();
    else document.addEventListener('DOMContentLoaded', boot, { once: true });
    window.addEventListener('load', () => walk(document.documentElement || document));
})();
