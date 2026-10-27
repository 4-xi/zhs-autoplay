# zhs-autoplay
智慧树网课自动连播浏览器扩展
# 打包产物
*.zip

/* 智慧树自动连播 v1.9
 *
 * 判断"这一节学完了"的依据：目录项 status-box 里出现 <i class="icon-finish">（蓝色对勾）。
 *   实测结构：<div class="file-item"><i class="icon-video"></i><span class="file-name">…</span>
 *             <div class="status-box"><i class="icon-finish"></i></div></div>
 *   页面上没有任何百分比数字，别再找百分比。
 *
 * v1.9 相对 v1.8 只加一件事：切到新节时自动点播放。
 *   只对 paused && !ended && readyState>=2 的视频调 play()，并且只在进节后 120 秒内重试，
 *   之后不再管（免得你主动暂停去干别的，被它强行播回来）。
 *   不改 playbackRate、不改 muted、不改 currentTime —— 这三样会影响平台的计时判定。
 */
(function () {
  'use strict';
  if (window.__zhsAutoplay) return;
  window.__zhsAutoplay = true;

  var MIN_DWELL_MS = 30000;     // 进节后至少待这么久才认"完成对勾"，防乐观打勾
  var PLAY_WINDOW_MS = 120000;  // 进节后 2 分钟内自动帮他点播放
  var advancedFromIdx = -1;
  var lastNextAt = 0;
  var curIdx = -1;
  var curEnterAt = 0;
  var navLabelText = '';
  var manualPaused = false;
  var lastNav = null;

  function log(m) { try { console.log('%c[连播] ' + m, 'color:#0a9;font-weight:bold'); } catch (e) {} }
  function isTop() { try { return window.top === window.self; } catch (e) { return false; } }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 5 || r.height < 5) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && parseFloat(cs.opacity) !== 0 && cs.display !== 'none';
  }

  function norm(s) {
    return String(s || '')
      .replace(/\.(mp4|flv|wmv|avi|mov|m4v|mp3|pdf|docx?|pptx?)$/i, '')
      .replace(/[\s\u3000\u00a0]/g, '')
      .replace(/[：]/g, ':')
      .trim();
  }

  function currentTitle() {
    var box = document.querySelector('.source-tit');
    if (!box) return null;
    var span = box.querySelector('span');
    var t = ((span ? span.textContent : box.textContent) || '').trim();
    return t ? norm(t) : null;
  }

  function isFinished(itemEl) {
    return !!(itemEl && itemEl.querySelector('.status-box .icon-finish'));
  }

  function catalogItems() {
    var els = document.querySelectorAll('.file-item');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      var nameEl = e.querySelector('.file-name');
      var t = nameEl ? (nameEl.textContent || '').trim() : '';
      if (!t) continue;
      if (!visible(e)) continue;
      var r = e.getBoundingClientRect();
      out.push({ el: e, text: t, norm: norm(t), y: r.top + window.scrollY, done: isFinished(e) });
    }
    out.sort(function (a, b) { return a.y - b.y; });
    return out;
  }

  function scanNav() {
    var items = catalogItems();
    var cur = currentTitle();
    var idx = -1;
    if (cur) {
      for (var i = 0; i < items.length; i++) if (items[i].norm === cur) { idx = i; break; }
      if (idx < 0) {
        for (var j = 0; j < items.length; j++) {
          if (items[j].norm.indexOf(cur) >= 0 || cur.indexOf(items[j].norm) >= 0) { idx = j; break; }
        }
      }
    }
    var done = idx >= 0 ? items[idx].done : false;
    navLabelText = items.length
      ? (' · ' + (idx < 0 ? '?' : idx + 1) + '/' + items.length + ' · ' + (done ? '✓已完成' : '学习中'))
      : ' · 未找到目录';
    return { items: items, idx: idx, cur: cur, done: done };
  }

  function setBadge(text, bg) {
    if (!isTop()) return;
    var b = document.getElementById('__zhs_badge');
    if (!b) {
      b = document.createElement('div');
      b.id = '__zhs_badge';
      b.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;padding:6px 12px;'
        + 'border-radius:14px;font:13px/1.4 system-ui,-apple-system,sans-serif;color:#fff;'
        + 'cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.28)';
      b.onclick = function () {
        manualPaused = !manualPaused;
        log(manualPaused ? '手动暂停（不再自动播放/跳转）' : '恢复自动');
        refreshBadge(lastNav);
      };
      b.oncontextmenu = function (ev) { ev.preventDefault(); downloadDiag(); };
      document.documentElement.appendChild(b);
    }
    b.textContent = text;
    b.style.background = bg;
  }

  function refreshBadge(nav) {
    if (!isTop()) return;
    if (nav) lastNav = nav;
    if (manualPaused) { setBadge('已暂停（点我恢复）' + navLabelText, '#777'); return; }
    setBadge('连播' + navLabelText, '#0a9');
  }

  function downloadDiag() {
    try {
      var items = catalogItems();
      var out = {
        ver: '1.9', url: location.href, currentTitle: currentTitle(),
        curIdx: curIdx, curEnterAt: curEnterAt, advancedFromIdx: advancedFromIdx,
        catalogCount: items.length,
        catalog: items.slice(0, 40).map(function (i, n) { return n + (i.done ? ' [✓] ' : ' [ ] ') + i.text; }),
        videos: [].map.call(document.querySelectorAll('video'), function (v) {
          return { dur: Math.round(v.duration || 0), cur: Math.round(v.currentTime || 0), paused: v.paused, ended: v.ended, rate: v.playbackRate, muted: v.muted };
        })
      };
      var blob = new Blob(['\ufeff' + JSON.stringify(out, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'zhs-diag.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
      setBadge('诊断已导出', '#08a');
      setTimeout(function () { refreshBadge(lastNav); }, 4000);
    } catch (err) { setBadge('导出失败', '#d33'); log('导出失败 ' + err); }
  }

  function goNext(nav) {
    var now = Date.now();
    if (now - lastNextAt < 6000) return false;
    lastNextAt = now;

    if (nav.idx < 0) { setBadge('定位失败，右键我导出诊断', '#d33'); return false; }
    if (nav.idx + 1 >= nav.items.length) { setBadge('已是最后一节', '#d33'); return false; }

    var next = nav.items[nav.idx + 1];
    try { next.el.click(); } catch (e) {}
    log('✓ 这一节完成 → 点下一节「' + next.text + '」');
    setBadge('下一节：' + next.text.slice(0, 12), '#08a');
    curEnterAt = 0;   // 让新节重新计时，下一轮 loop 会重置 play window
    setTimeout(function () { scanNav(); refreshBadge(); }, 4000);
    return true;
  }

  function ensurePlaying() {
    var vs = document.querySelectorAll('video');
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (!v.paused || v.ended || v.readyState < 2) continue;
      try {
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
        log('点了播放（原来停着）');
      } catch (e) {}
    }
  }

  function loop() {
    var nav = scanNav();

    if (nav.idx !== curIdx) { curIdx = nav.idx; curEnterAt = Date.now(); }
    if (!curEnterAt) curEnterAt = Date.now();

    refreshBadge(nav);
    if (manualPaused || nav.idx < 0) return;

    // 进节后 2 分钟内，只要视频是停着的就帮他点播放
    if (Date.now() - curEnterAt < PLAY_WINDOW_MS) ensurePlaying();

    if (!nav.done) return;
    if (Date.now() - curEnterAt < MIN_DWELL_MS) return;
    if (nav.idx === advancedFromIdx) return;

    if (goNext(nav)) advancedFromIdx = nav.idx;
  }

  setInterval(loop, 2000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loop);
  else loop();
  log('v1.9 已加载 —— 自动点播放 + 看完成对勾跳下一节');
})();

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

{
  "manifest_version": 3,
  "name": "智慧树自动连播",
  "version": "1.9",
  "description": "智慧树自动连播：切到新节自动点播放，目录出现完成对勾后跳下一节。",
  "content_scripts": [
    {
      "matches": [
        "*://*.zhihuishu.com/*"
      ],
      "all_frames": true,
      "run_at": "document_idle",
      "js": [
        "content.js"
      ]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}

# 智慧树自动连播

一个浏览器扩展（Manifest V3）：在看智慧树网课（`hike.zhihuishu.com` 资料学习页）时，等右侧目录里当前这一节出现**完成标记**后，自动点开下一节。

**它不刷学时。** 整个播放、计时、上报全部走平台原生逻辑，插件只做"点下一节"这一下。

## 为什么写这个

网课一节接一节，每节播完都要自己回头去右边目录点下一次，几十节下来很烦。现成的自动连播脚本大多是"视频一结束就跳"，但智慧树的时长是异步上报的，跳太快会丢记录。

这个扩展的做法是：**只看平台自己打的完成标记**（目录项里 `status-box` 中的 `icon-finish`，界面上的蓝色对勾），平台认为这一节学完了才跳。

## 判断逻辑

目录项的真实结构是：

```html
<div id="file_35009234" onclick="changeFile(35009234)" class="file-item">
  <i class="icon-video"></i>
  <span class="file-name">国防概述--国防的概念</span>
  <div class="status-box"><i class="icon-finish"></i></div>
</div>
```

学完的节，`status-box` 里会多一个 `<i class="icon-finish">`。插件每 2 秒检查当前播放的这一节：

- 有 `icon-finish` → 等满 30 秒（防止刚点开就被乐观打勾）→ 点下一节
- 没有 → 继续等

页面上从头到尾**没有百分比数字**，所以不要去找"进度百分比"，那是找错的。

## 安装

1. 下载或 clone 本仓库到本地任意目录
2. 打开 `edge://extensions`（Chrome 是 `chrome://extensions`）
3. 打开右上角的 **开发人员模式**
4. 点 **加载解压缩的扩展**，选择本仓库目录
5. 打开智慧树课程页，右下角会出现一个绿色浮标

## 用法

| 操作 | 效果 |
| --- | --- |
| 单击浮标 | 暂停 / 恢复自动播放与自动跳转 |
| 右键浮标 | 导出一份诊断 JSON（排错用） |

浮标文字含义：

- `连播 · 37/176 · 学习中` —— 第 37 节共 176 节，还没打勾
- `连播 · 37/176 · ✓已完成` —— 打勾了，30 秒后跳
- `下一节：xxx` —— 已点下一节
- `定位失败，右键我导出诊断` —— 页面结构变了，见下面的「已知限制」

## 关键设计：不碰播放器

以下四样**故意不做**，因为它们会影响或疑似影响平台的计时判定：

- 不设 `playbackRate`（倍速会让学时长按比例缩水）
- 不设 `muted`（静音播放可能被平台判定为无效）
- 不改 `currentTime`（拖动/回跳会被当成跳转）
- 不做周期性 `play()` 轮询（只在新节前 2 分钟内、且确实暂停时才点一次）

## 已知限制

- **依赖页面 DOM 结构**：智慧树改版后 `.file-item`、`.status-box`、`.icon-finish`、`.source-tit` 任一改名，插件就会失效（浮标会显示 `?` 或 `定位失败`）。
- **只适配"资料学习"页面**（`/aidedteaching/sourceLearning/`），其他学习页结构未验证。
- **标题匹配**：当前播放节的标题从 `.source-tit` 读，目录里靠文字比对定位。标题被截断或含特殊符号时可能匹配失败。
- **不处理弹题**：平台弹出题目时，插件不会代答。建议别完全挂机。

## 免责声明

本项目只用于减少重复点击，不提供任何绕过学习时长统计的能力。使用时请遵守所在学校与平台的使用条款，账号风险自负。

## License

MIT

import zipfile, os
src = os.path.abspath(os.path.dirname(__file__))
out = os.path.join(os.path.dirname(src), "zhs-autoplay.zip")
if os.path.exists(out): os.remove(out)
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
        for f in files:
            if f.lower().endswith(".zip"): continue
            full = os.path.join(root, f)
            arc = os.path.join("zhs-autoplay", os.path.relpath(full, src))
            z.write(full, arc)
            n += 1
print("ZIP_OK", n, os.path.getsize(out))
