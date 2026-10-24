// ==UserScript==
// @name         91Porn网广告过滤
// @name:zh-CN   91Porn网广告过滤
// @name:en      91Porn Ad Block
// @namespace    https://github.com/luestr/userscripts
// @version      1.0.0
// @description  拦截 91porn.com 的横幅广告、弹窗与播放器贴片广告，仅适配 WebKit 引擎环境。
// @description:en Block banner ads, popunders and player preroll ads on 91porn.com. WebKit only.
// @author       可莉
// @homepageURL  https://t.me/ibilibili
// @updateURL    https://raw.githubusercontent.com/luestr/userscripts/main/adblock/91porn_adblock.user.js
// @downloadURL  https://raw.githubusercontent.com/luestr/userscripts/main/adblock/91porn_adblock.user.js
// @match        https://91porn.com/*
// @match        https://www.91porn.com/*
// @run-at       document-start
// @grant        none
// @webRequest   [{"selector":"*://*.jads.co/*","action":"cancel"},{"selector":"*://*.juicyads.com/*","action":"cancel"},{"selector":"*://*.rmhfrtnd.com/*","action":"cancel"},{"selector":"*://*.exoclick.com/*","action":"cancel"},{"selector":"*://*.exosrv.com/*","action":"cancel"},{"selector":"*://*.exdynsrv.com/*","action":"cancel"},{"selector":"*://*.realsrv.com/*","action":"cancel"},{"selector":"*://*.popads.net/*","action":"cancel"},{"selector":"*://*.popcash.net/*","action":"cancel"},{"selector":"*://*.propellerads.com/*","action":"cancel"},{"selector":"*://*.propellerpops.com/*","action":"cancel"},{"selector":"*://*.onclickads.net/*","action":"cancel"},{"selector":"*://*.clickadu.com/*","action":"cancel"},{"selector":"*://*.adsterra.com/*","action":"cancel"},{"selector":"*://*.hilltopads.net/*","action":"cancel"},{"selector":"*://*.trafficjunky.net/*","action":"cancel"},{"selector":"*://*.trafficjunky.com/*","action":"cancel"},{"selector":"*://*.adspyglass.com/*","action":"cancel"},{"selector":"*://*.adnium.com/*","action":"cancel"},{"selector":"*://*.tsyndicate.com/*","action":"cancel"},{"selector":"*://g-br-cdn.kwai.net/*","action":"cancel"},{"selector":"*://fans.91selfie.com/*","action":"cancel"},{"selector":"*://*.cryptosign.academy/*","action":"cancel"},{"selector":"*://*.jhgfdsaqpwoeiru.cc/*","action":"cancel"}]
// ==/UserScript==

(() => {
  'use strict';

  // 第一层：@webRequest 在脚本加载前取消广告请求（Tampermonkey 仅处理
  // sub_frame / script / xhr / websocket；图片与视频由下方 DOM 逻辑兜底）。
  // 第二层：document-start 拦截播放器 preroll 调用，避免贴片广告视频发出请求。
  // 第三层：MutationObserver 清理服务端直出的广告节点，处理漏网广告。

  const AD_HOSTS = [
    // 本站实际出现的广告域名
    'jads.co',
    'juicyads.com',
    'rmhfrtnd.com',
    'fans.91selfie.com',
    'cryptosign.academy',
    'jhgfdsaqpwoeiru.cc',
    'g-br-cdn.kwai.net',
    // 常见成人广告网络，用于拦截轮换投放
    'exoclick.com',
    'exosrv.com',
    'exdynsrv.com',
    'realsrv.com',
    'popads.net',
    'popcash.net',
    'propellerads.com',
    'propellerpops.com',
    'onclickads.net',
    'clickadu.com',
    'adsterra.com',
    'hilltopads.net',
    'trafficjunky.net',
    'trafficjunky.com',
    'adspyglass.com',
    'adnium.com',
    'tsyndicate.com',
  ];

  const AD_HOST_SET = new Set(AD_HOSTS);

  const SCAN_SELECTOR = [
    'img.ad_img',
    'img[src]',
    'div.cont6',
    'ins[id]',
    'script[src]',
    'script:not([src])',
    'iframe[src]',
    '.vjs-preroll',
  ].join(',');

  const STYLE_TEXT = [
    'img.ad_img,',
    'div.cont6,',
    'ins[data-width][data-height],',
    '.vjs-preroll {',
    '  display: none !important;',
    '}',
  ].join('\n');

  let pagePlayer = null;

  function isAdHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    for (const candidate of AD_HOST_SET) {
      if (host === candidate || host.endsWith(`.${candidate}`)) return true;
    }
    return false;
  }

  function isAdUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return isAdHost(url.hostname);
    } catch {
      return false;
    }
  }

  function installStyle() {
    if (document.querySelector('style[data-91porn-adblock]')) return;
    const parent = document.head || document.documentElement;
    if (!parent) {
      document.addEventListener('DOMContentLoaded', installStyle, { once: true });
      return;
    }
    const style = document.createElement('style');
    style.setAttribute('data-91porn-adblock', '');
    style.textContent = STYLE_TEXT;
    parent.appendChild(style);
  }

  function isAdIns(element) {
    if (element.id && /^\d+$/.test(element.id)) return true;
    return element.hasAttribute('data-width') && element.hasAttribute('data-height');
  }

  function removeAdImage(image) {
    if (!image.isConnected) return;
    const block = image.closest('div.cont6');
    if (block) {
      block.remove();
      return;
    }
    const link = image.closest('a');
    (link || image).remove();
  }

  function playMainVideo() {
    if (!pagePlayer || typeof pagePlayer.play !== 'function') return;
    try {
      const result = pagePlayer.play();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // 无用户手势时浏览器会拒绝播放，忽略即可。
    }
  }

  function killPreroll(element) {
    const target = element || document.querySelector('.vjs-preroll');
    if (!target) return;
    for (const video of target.querySelectorAll('video')) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // 视频尚未初始化时忽略。
      }
    }
    target.remove();
    playMainVideo();
  }

  function cleanElement(element) {
    if (!element.isConnected) return;

    const tag = element.tagName;
    if (tag === 'IMG') {
      if (element.classList.contains('ad_img') || isAdUrl(element.src)) {
        removeAdImage(element);
      }
      return;
    }

    if (tag === 'DIV' && element.classList.contains('cont6')) {
      element.remove();
      return;
    }

    if (tag === 'INS') {
      if (isAdIns(element)) element.remove();
      return;
    }

    if (tag === 'SCRIPT') {
      if (element.src ? isAdUrl(element.src) : element.textContent.includes('adsbyjuicy')) {
        element.remove();
      }
      return;
    }

    if (tag === 'IFRAME') {
      if (isAdUrl(element.src)) element.remove();
      return;
    }

    if (element.classList.contains('vjs-preroll')) {
      killPreroll(element);
    }
  }

  function cleanSubtree(root) {
    if (!(root instanceof Element)) return;
    cleanElement(root);
    if (!root.isConnected) return;

    let nodes;
    try {
      nodes = root.querySelectorAll(SCAN_SELECTOR);
    } catch {
      return;
    }
    for (const node of nodes) cleanElement(node);
  }

  function sweep() {
    if (!document.documentElement) return;
    cleanSubtree(document.documentElement);
  }

  function neutralizePreroll(player) {
    if (player === null || (typeof player !== 'object' && typeof player !== 'function')) {
      return player;
    }
    try {
      // 自有属性会遮蔽插件注册在 Player.prototype 上的 preroll 方法。
      Object.defineProperty(player, 'preroll', {
        configurable: true,
        enumerable: false,
        writable: false,
        value() {
          return this;
        },
      });
    } catch (error) {
      console.warn('[91porn-adblock] 无法拦截播放器贴片广告', error);
    }
    return player;
  }

  function installPlayerGuard() {
    try {
      Object.defineProperty(window, 'player', {
        configurable: true,
        enumerable: false,
        get() {
          return pagePlayer;
        },
        set(value) {
          pagePlayer = neutralizePreroll(value);
        },
      });
    } catch (error) {
      console.warn('[91porn-adblock] 无法安装播放器拦截器', error);
    }
  }

  function start() {
    installStyle();
    installPlayerGuard();

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) cleanSubtree(node);
        }
      }
    });

    try {
      observer.observe(document, { childList: true, subtree: true });
    } catch (error) {
      console.warn('[91porn-adblock] 无法监听页面变化', error);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sweep, { once: true });
    } else {
      sweep();
    }
    window.addEventListener('load', sweep, { once: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  try {
    start();
  } catch (error) {
    console.error('[91porn-adblock] 启动失败', error);
  }
})();
