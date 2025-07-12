(function (window) {
    const style_element_id = 'section_packer_style';
    const style_element_text = `
.horizontal_section_wrapper { display: flex; flex-direction: column; gap: 1rem; overflow-x: auto; }
.horizontal_container_row { display: flex; gap: 1rem; overflow-x: auto; scroll-behavior: smooth; transition: all 0.3s ease; }
.horizontal_container_row > section { flex: 0 0 auto; box-sizing: border-box; min-height: 1px; }
.horizontal_container_row::-webkit-scrollbar { display: none; }
.triangle_layout > .horizontal_container_row:nth-child(even) { justify-content: flex-end; }
@media (max-width: 768px) {
  .horizontal_container_row { flex-direction: column; overflow-x: visible; }
}`;

    function inject_style() {
        if (!document.getElementById(style_element_id)) {
            const el = document.createElement('style');
            el.id = style_element_id;
            el.textContent = style_element_text;
            requestAnimationFrame(() => document.head.appendChild(el));
        }
    }

    function calc_min_width(element) {
        if (element._min_width != null) return element._min_width;
        let max_width = 0;
        [element, ...element.querySelectorAll('*')].forEach(node => {
            const cs = getComputedStyle(node);
            const mw = parseInt(cs.minWidth) || node.offsetWidth;
            if (mw > max_width) max_width = mw;
        });
        element._min_width = max_width;
        return max_width;
    }

    function schedule_idle(callback) {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(callback, { timeout: 100 });
        } else {
            requestAnimationFrame(callback);
        }
    }

    function compute_in_worker(items, cfg) {
        return new Promise((resolve, reject) => {
            const blob = new Blob(["(" + worker_main.toString() + ")()"], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const worker = new Worker(url);
            worker.postMessage({ items, cfg });
            worker.onmessage = e => { resolve(e.data); worker.terminate(); URL.revokeObjectURL(url); };
            worker.onerror = err => { reject(err); worker.terminate(); URL.revokeObjectURL(url); };
        });
    }

    function worker_main() {
        function ffd(secs, W) {
            secs.sort((a, b) => b.min_w - a.min_w);
            const rows = [];
            secs.forEach(item => {
                let placed = false;
                for (const row of rows) {
                    const used = row.reduce((s, it) => s + it.min_w, 0);
                    if (used + item.min_w <= W) {
                        row.push(item);
                        placed = true;
                        break;
                    }
                }
                if (!placed) rows.push([item]);
            });
            return rows.length;
        }

        function pack_dp(secs, W, unsorted, overflow, maxr, shape) {
            const n = secs.length, total_masks = 1 << n;
            const upper = Math.min(maxr, ffd(secs, W));
            const dp = new Map(), parent = new Map();
            const keyf = (m, s) => m + '|' + s;
            dp.set(keyf(0, W), 0);
            const totalW = new Array(total_masks).fill(0);
            for (let m = 0; m < total_masks; m++) {
                for (let i = 0; i < n; i++) {
                    if (m & (1 << i)) totalW[m] += secs[i].min_w;
                }
            }
            for (let m = 0; m < total_masks; m++) {
                for (let s2 = W; s2 >= 0; s2--) {
                    const k = keyf(m, s2), cur = dp.get(k);
                    if (cur == null || cur >= upper) continue;
                    const rem = (total_masks - 1) ^ m;
                    const need = Math.ceil(totalW[rem] / W);
                    if (cur + need >= upper) continue;
                    if (s2 < W) {
                        const k2 = keyf(m, W), v2 = dp.get(k2) || Infinity;
                        if (cur + 1 < v2) {
                            dp.set(k2, cur + 1);
                            parent.set(k2, { m, s2, act: 'E' });
                        }
                    }
                    for (let i = 0; i < n; i++) {
                        if (m & (1 << i)) continue;
                        const w = secs[i].min_w;
                        if (w > s2) continue;
                        const nm = m | (1 << i), ns = s2 - w, nk = keyf(nm, ns);
                        const vcur = dp.get(nk) || Infinity;
                        if (cur < vcur) {
                            dp.set(nk, cur);
                            parent.set(nk, { m, s2, act: 'A', i });
                        }
                    }
                }
            }
            let best_s = 0, best_rows = Infinity;
            for (let s2 = 0; s2 <= W; s2++) {
                const v = dp.get(keyf(total_masks - 1, s2));
                if (v != null) {
                    const tot = v + (s2 < W ? 1 : 0);
                    if (tot < best_rows) { best_rows = tot; best_s = s2; }
                }
            }
            const groups = [], row = [];
            let cm = total_masks - 1, cs = best_s;
            while (cm || cs !== W) {
                const p = parent.get(keyf(cm, cs));
                if (!p) break;
                if (p.act === 'E') {
                    groups.unshift([...row]);
                    row.length = 0;
                } else {
                    row.unshift(secs[p.i]);
                }
                cm = p.m; cs = p.s2;
            }
            if (row.length) groups.unshift([...row]);
            if (!unsorted) groups.forEach(g => g.sort((a, b) => a.origIndex - b.origIndex));
            if (shape === 'triangle') return groups.map((g, i) => i % 2 ? g.reverse() : g);
            return groups;
        }

        function heuristic(secs, W, shape, unsorted) {
            secs.sort((a, b) => b.min_w - a.min_w);
            const rows = [];
            secs.forEach(item => {
                let best = null, min_gap = Infinity;
                for (const row of rows) {
                    const used = row.reduce((s, it) => s + it.min_w, 0);
                    const gap = W - used - item.min_w;
                    if (gap >= 0 && gap < min_gap) { best = row; min_gap = gap; }
                }
                if (best) best.push(item); else rows.push([item]);
            });
            if (!unsorted) rows.forEach(r => r.sort((a, b) => a.origIndex - b.origIndex));
            if (shape === 'triangle') return rows.map((r, i) => i % 2 ? r.reverse() : r);
            return rows;
        }

        self.onmessage = function (e) {
            const { items, cfg } = e.data;
            const secs = items.map((o, i) => ({ min_w: o.min_w, origIndex: i }));
            const groups = secs.length > 15
                ? heuristic(secs, cfg.W, cfg.shape, cfg.unsorted)
                : pack_dp(secs, cfg.W, cfg.unsorted, cfg.overflow, cfg.maxr, cfg.shape);
            postMessage(groups);
        };
    }

    function render_layout(wrapper_id, groups, shape) {
        let wrap = document.getElementById(wrapper_id);
        const is_new = !wrap;
        if (is_new) {
            wrap = document.createElement('div');
            wrap.id = wrapper_id;
            wrap.className = 'horizontal_section_wrapper';
        }
        wrap.classList.toggle('triangle_layout', shape === 'triangle');
        const existing_rows = Array.from(wrap.querySelectorAll('.horizontal_container_row'));
        groups.forEach((g, ri) => {
            let row_div = existing_rows[ri] || document.createElement('div');
            row_div.className = 'horizontal_container_row';
            g.forEach((it, ci) => {
                if (row_div.children[ci] !== it.el) {
                    if (row_div.children[ci]) row_div.replaceChild(it.el, row_div.children[ci]);
                    else row_div.appendChild(it.el);
                }
            });
            while (row_div.children.length > g.length) row_div.removeChild(row_div.lastChild);
            if (!existing_rows[ri]) wrap.appendChild(row_div);
        });
        while (wrap.children.length > groups.length) wrap.removeChild(wrap.lastChild);
        if (is_new) {
            const first = groups.flat()[0]?.el;
            if (first && first.parentNode) first.parentNode.insertBefore(wrap, first);
        }
    }

    function init_section_packer(cfg) {
        inject_style();
        const {
            section_groups,
            allow_unsorted = false,
            layout_shape = 'normal',
            allow_overflow = false,
            max_rows = Infinity,
            observe_element,
            observe_children,
            min_refresh_interval = 16
        } = cfg;

        let last_w = window.innerWidth;
        let is_ready = false;
        console.log('⚙️ SP 测试脚本已加载', document.location.href);
        function schedule_update() {
            if (is_ready) return;
            is_ready = true;
            requestAnimationFrame(() => {
                run_layout();
                is_ready = false;
            });
        }

        async function run_layout() {
            const w = window.innerWidth;
            if (Math.abs(w - last_w) < min_refresh_interval) return;
            last_w = w;
            for (const [wid, sels] of Object.entries(section_groups)) {
                const els = sels.map(sel => document.querySelector(sel)?.closest('section') || null);
                const found = els.filter(Boolean).length;
                if (found === 0) continue;
                if (found < sels.length) {
                    console.error(`section_group "${wid}" 缺少 section：`, sels.filter((s,i)=>!els[i]));
                    continue;
                }
                const secs = els.map(el => ({ el, min_w: calc_min_width(el) }));
                try {
                    const groups = await compute_in_worker(
                        secs.map(s => ({ min_w: s.min_w })),
                        { W: w, unsorted: allow_unsorted, overflow: allow_overflow, maxr: max_rows, shape: layout_shape }
                    );
                    schedule_idle(() => render_layout(
                        wid,
                        groups.map(g => g.map(it => ({ el: secs[it.origIndex].el }))),
                        layout_shape
                    ));
                } catch {
                    schedule_idle(() => render_layout(wid, [secs], layout_shape));
                }
            }
        }

        const target = observe_element
            ? document.querySelector(observe_element)
            : document.scrollingElement || document.documentElement || document.body;

        if ('ResizeObserver' in window) {
            try {
                const ro = new ResizeObserver(entries => {
                    for (const e of entries) {
                        if (e.contentBoxSize || e.contentRect) { schedule_update(); break; }
                    }
                });
                ro.observe(target);
                if (observe_children) document.querySelectorAll(observe_children).forEach(c => ro.observe(c));
            } catch {
                window.addEventListener('resize', schedule_update);
            }
        } else {
            window.addEventListener('resize', schedule_update);
        }

        schedule_update();
    }

    window.SectionPacker = { init: init_section_packer };
})(window);