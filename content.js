/* 智慧树自动连播 v2.0
 *
 * 判断"这一节学完了"的依据：目录项 status-box 里出现 <i class="icon-finish">（蓝色对勾）。
 *   实测结构：<div class="file-item"><i class="icon-video"></i><span class="file-name">…</span>
 *             <div class="status-box"><i class="icon-finish"></i></div></div>
 *   页面上没有任何百分比数字，别再找百分比。
 *
 * v2.0：界面重做 —— 卡片浮标、进度条、倒计时、可拖动、状态配色。判断逻辑不变。
 *   仍不改 playbackRate、不改 muted、不改 currentTime。
 */
(function () {
  'use strict';
  if (window.__zhsAutoplay) return;
  window.__zhsAutoplay = true;

  var MIN_DWELL_MS = 30000;     // 进节后至少待这么久才认"完成对勾"，防乐观打勾
  var PLAY_WINDOW_MS = 120000;  // 进节后 2 分钟内自动帮他点播放
  var POS_KEY = '__zhs_badge_pos';
  var COLORS = { ok: '#10b981', done: '#3b82f6', warn: '#f59e0b', err: '#ef4444', idle: '#6b7280' };

  var advancedFromIdx = -1;
  var lastNextAt = 0;
  var curIdx = -1;
  var curEnterAt = 0;
  var manualPaused = false;
  var lastPct = 0;

  function log(m) { try { console.log('%c[连播] ' + m, 'color:#0a9;font-weight:bold'); } catch (e) {} }
  function isTop() { try { return window.top === window.self; } catch (e) { return false; } }

  /* ---------- 页面结构 ---------- */

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
    return { items: items, idx: idx, cur: cur, done: idx >= 0 ? items[idx].done : false };
  }

  /* ---------- 浮标 UI ---------- */

  var CSS = [
    '#__zhs_badge{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:174px;',
    'padding:11px 13px 9px;border-radius:14px;background:rgba(17,24,39,.94);',
    'box-shadow:0 8px 28px rgba(0,0,0,.42);',
    'font:12px/1.35 "Segoe UI",system-ui,-apple-system,"Microsoft YaHei",sans-serif;',
    'color:#e5e7eb;cursor:grab;-webkit-user-select:none;user-select:none;',
    'transition:box-shadow .15s, transform .12s;}',
    '#__zhs_badge:hover{box-shadow:0 10px 34px rgba(0,0,0,.55);}',
    '#__zhs_badge:active{cursor:grabbing;}',
    '#__zhs_badge .zs-h{margin-bottom:5px;}',
    '#__zhs_badge .zs-dot{display:inline-block;width:8px;height:8px;border-radius:50%;',
    'background:#6b7280;vertical-align:middle;margin-right:7px;}',
    '#__zhs_badge .zs-dot.zs-pulse{animation:zsPulse 2s ease-in-out infinite;}',
    '@keyframes zsPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.8);}}',
    '#__zhs_badge .zs-t{display:inline-block;font-size:12.5px;font-weight:600;',
    'color:#f3f4f6;letter-spacing:.2px;vertical-align:middle;}',
    '#__zhs_badge .zs-n{font-size:11px;color:#9ca3af;margin:0 0 7px 15px;',
    'font-variant-numeric:tabular-nums;}',
    '#__zhs_badge .zs-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.13);overflow:hidden;}',
    '#__zhs_badge .zs-bar i{display:block;height:100%;width:0;border-radius:2px;',
    'background:#10b981;transition:width .45s ease;}'
  ].join('');

  function badgeEl() {
    if (!isTop()) return null;
    var b = document.getElementById('__zhs_badge');
    if (b) return b;
    var s = document.getElementById('__zhs_style');
    if (!s) {
      s = document.createElement('style');
      s.id = '__zhs_style';
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }
    b = document.createElement('div');
    b.id = '__zhs_badge';
    b.innerHTML = '<div class="zs-h"><span class="zs-dot"></span><span class="zs-t"></span></div>'
      + '<div class="zs-n"></div>'
      + '<div class="zs-bar"><i></i></div>';
    (document.body || document.documentElement).appendChild(b);
    bindDrag(b);
    restorePos(b);
    return b;
  }

  function restorePos(b) {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
      var maxX = Math.max(0, window.innerWidth - 60);
      var maxY = Math.max(0, window.innerHeight - 60);
      b.style.left = Math.min(Math.max(0, p.x), maxX) + 'px';
      b.style.top = Math.min(Math.max(0, p.y), maxY) + 'px';
      b.style.right = 'auto';
      b.style.bottom = 'auto';
    } catch (e) {}
  }

  function render(st) {
    var b = badgeEl();
    if (!b) return;
    var c = COLORS[st.mode] || COLORS.idle;
    var dot = b.querySelector('.zs-dot');
    var t = b.querySelector('.zs-t');
    var n = b.querySelector('.zs-n');
    var bar = b.querySelector('.zs-bar i');
    dot.style.background = c;
    dot.className = 'zs-dot' + (st.mode === 'ok' ? ' zs-pulse' : '');
    t.textContent = st.title || '';
    t.style.color = st.mode === 'err' ? '#fca5a5' : '#f3f4f6';
    n.textContent = st.sub || '';
    n.style.color = st.mode === 'done' ? '#93c5fd' : '#9ca3af';
    bar.style.width = Math.max(0, Math.min(100, st.pct || 0)) + '%';
    bar.style.background = c;
  }

  function bindDrag(b) {
    var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, dragging = false;

    b.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var r = b.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      moved = false; dragging = true;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });

    function onMove(e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - sx) > 4 || Math.abs(e.clientY - sy) > 4) moved = true;
      if (!moved) return;
      var x = Math.max(0, Math.min(ox + e.clientX - sx, window.innerWidth - 60));
      var y = Math.max(0, Math.min(oy + e.clientY - sy, window.innerHeight - 60));
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      b.style.right = 'auto';
      b.style.bottom = 'auto';
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (moved) {
        var r = b.getBoundingClientRect();
        try { localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (err) {}
      } else {
        manualPaused = !manualPaused;
        log(manualPaused ? '手动暂停' : '恢复自动');
        loop();
      }
    }

    b.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      downloadDiag();
    });
  }

  function downloadDiag() {
    try {
      var items = catalogItems();
      var out = {
        ver: '2.0', url: location.href, currentTitle: currentTitle(),
        curIdx: curIdx, curEnterAt: curEnterAt, advancedFromIdx: advancedFromIdx,
        catalogCount: items.length,
        catalog: items.slice(0, 40).map(function (i, n) { return n + (i.done ? ' [v] ' : ' [ ] ') + i.text; }),
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
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 4000);
      render({ mode: 'warn', title: '诊断已导出', sub: 'zhs-diag.json', pct: lastPct });
      setTimeout(loop, 2600);
    } catch (err) {
      render({ mode: 'err', title: '导出失败', sub: String(err).slice(0, 26), pct: lastPct });
      log('导出失败 ' + err);
    }
  }

  /* ---------- 跳转 ---------- */

  function goNext(nav) {
    var now = Date.now();
    if (now - lastNextAt < 6000) return false;
    lastNextAt = now;

    if (nav.idx < 0) { render({ mode: 'err', title: '定位失败', sub: '右键导出诊断', pct: 0 }); return false; }
    if (nav.idx + 1 >= nav.items.length) { render({ mode: 'err', title: '已是最后一节', sub: '共 ' + nav.items.length + ' 节', pct: 100 }); return false; }

    var next = nav.items[nav.idx + 1];
    try { next.el.click(); } catch (e) {}
    log('这一节完成 -> 下一节「' + next.text + '」');
    lastPct = Math.round((nav.idx + 1) / nav.items.length * 100);
    render({ mode: 'warn', title: '跳转中', sub: next.text.slice(0, 16), pct: lastPct });
    curEnterAt = 0;
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

  /* ---------- 主循环 ---------- */

  function loop() {
    var nav = scanNav();

    if (nav.idx !== curIdx) { curIdx = nav.idx; curEnterAt = Date.now(); }
    if (!curEnterAt) curEnterAt = Date.now();

    if (manualPaused) {
      render({ mode: 'idle', title: '已暂停', sub: '点我恢复自动', pct: lastPct });
      return;
    }
    if (nav.idx < 0) {
      render({ mode: 'err', title: '定位失败', sub: '右键导出诊断', pct: 0 });
      return;
    }

    var total = nav.items.length;
    lastPct = Math.round((nav.idx + 1) / total * 100);

    if (Date.now() - curEnterAt < PLAY_WINDOW_MS) ensurePlaying();

    if (!nav.done) {
      render({ mode: 'ok', title: '学习中', sub: (nav.idx + 1) + ' / ' + total, pct: lastPct });
      return;
    }

    var elapsed = Date.now() - curEnterAt;
    if (elapsed < MIN_DWELL_MS) {
      var left = Math.ceil((MIN_DWELL_MS - elapsed) / 1000);
      render({ mode: 'done', title: '已完成', sub: left + ' 秒后跳转', pct: lastPct });
      return;
    }
    if (nav.idx === advancedFromIdx) {
      render({ mode: 'done', title: '已完成', sub: '等待下一节加载', pct: lastPct });
      return;
    }
    if (goNext(nav)) advancedFromIdx = nav.idx;
  }

  setInterval(loop, 2000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loop);
  else loop();
  log('v2.0 已加载 —— 卡片浮标 + 进度条，逻辑不变');
})();
