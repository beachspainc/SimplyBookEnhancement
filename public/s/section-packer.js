(function (window) {
    const style_element_id = 'section_packer_style';
    const style_element_text = `
.horizontal-section-container {
  display: flex;
  flex-direction: row;
  overflow-x: auto;
  gap: 1rem;
  scroll-behavior: smooth;
  padding: 1rem 0;
  scroll-snap-type: x mandatory;
}
.horizontal-section-container > section {
  flex: 0 0 auto;
  min-width: 300px;
  scroll-snap-align: start;
}
.triangle-layout > section:nth-child(even) {
  margin-top: 2rem;
}
@media (max-width: 768px) {
  .horizontal-section-container {
    flex-direction: column;
    overflow-x: visible;
  }
}`;

    function inject_style() {
        if (!document.getElementById(style_element_id)) {
            const el = document.createElement('style');
            el.id = style_element_id;
            el.textContent = style_element_text;
            requestAnimationFrame(() => document.head.appendChild(el));
            console.log('🎨 样式注入成功');
        }
    }

    const explore = {
        isMobile: () => /Mobi|Android|iPhone/i.test(navigator.userAgent),
        getExploreVersion: () => {
            const ua = navigator.userAgent;
            const match = ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+)/);
            return match ? { name: match[1], version: parseInt(match[2]) } : { name: 'Unknown', version: 0 };
        }
    };

    function get_brief_element_info(el) {
        if (!el || !el.tagName) return '(null)';
        return `${el.tagName}${el.className ? '.' + el.className.split(' ').join('.') : ''} | w:${el.offsetWidth}`;
    }

    function calc_min_width(el) {
        if (el._min_width != null) return el._min_width;
        if (explore.isMobile()) {
            const w = window.innerWidth;
            console.log(`📱 Mobile detected, use viewport width ${w} as min_w for`, get_brief_element_info(el));
            el._min_width = w;
            return w;
        }
        const children = el.querySelectorAll('*');
        let maxRight = el.offsetLeft + el.offsetWidth;
        children.forEach(child => {
            const left = child.offsetLeft || 0;
            const right = left + (child.offsetWidth || 0);
            if (right > maxRight) maxRight = right;
        });
        const containerLeft = el.offsetLeft || 0;
        const min_w = maxRight - containerLeft;
        console.log(`📏 Section Actual Width (Adjusted): ${el.id || el.className}`);
        console.log('container left:', containerLeft.toFixed(2));
        console.log('max right:', maxRight.toFixed(2));
        console.log('adjusted min_w:', min_w.toFixed(2));
        el._min_width = min_w;
        return min_w;
    }

    function schedule_idle(cb) {
        ('requestIdleCallback' in window)
            ? requestIdleCallback(cb, { timeout: 100 })
            : requestAnimationFrame(cb);
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

        function pack_dp(secs, W, unsorted, overflow, max_r, shape) {
            const n = secs.length;
            if (n === 0) return [];
            if (n === 1) return [[secs[0]]];  // 确保返回二维数组结构

            const N = 1 << n;
            const key = (m, s) => `${m}|${s}`;
            const dp = new Map(), parent = new Map();
            dp.set(key(0, W), 0);

            // 预计算：总宽度、超宽section计数、正常section总宽
            const totalW = Array(N).fill(0);
            const wideCount = Array(N).fill(0);
            const normalW = Array(N).fill(0);

            for (let m = 0; m < N; m++) {
                for (let i = 0; i < n; i++) {
                    if (m & (1 << i)) {
                        const w = secs[i].min_w;
                        totalW[m] += w;
                        if (w >= W) {
                            wideCount[m]++;
                        } else {
                            normalW[m] += w;
                        }
                    }
                }
            }

            const upper = Math.min(max_r, ffd(secs, W));

            console.log("📊 pack_dp START: sections =", n, ", width =", W);
            console.log("🔢 upper bound =", upper);
            console.log("🔍 sections:", secs.map(s => s.min_w));
            console.log("📏 viewport width:", W);

            for (let m = 0; m < N; m++) {
                for (let s = W; s >= 0; s--) {
                    const k = key(m, s);
                    const cur = dp.get(k);
                    if (cur == null) continue;

                    const rem = ((1 << n) - 1) ^ m;

                    // 关键修复1：更精确的剪枝条件
                    const minRemRows = wideCount[rem] + Math.ceil(normalW[rem] / Math.max(1, W));
                    if (cur + minRemRows > upper) continue;

                    const new_line = key(m, W);
                    if (s < W && cur + 1 < (dp.get(new_line) ?? Infinity)) {
                        dp.set(new_line, cur + 1);
                        parent.set(new_line, { m, s, act: 'E' });
                    }

                    for (let i = 0; i < n; i++) {
                        if ((m >> i) & 1) continue;
                        const w = secs[i].min_w;
                        const new_m = m | (1 << i);

                        // 超宽section处理保持不变
                        if (w >= W) {
                            const newCost = cur + (s < W ? 1 : 0) + 1;
                            const newK = key(new_m, W);
                            if (newCost < (dp.get(newK) ?? Infinity)) {
                                dp.set(newK, newCost);
                                parent.set(newK, { m, s: s < W ? W : s, act: 'W', i });
                            }
                            continue;
                        }

                        // 关键修复2：当w > s时尝试换行放置
                        if (w > s) {
                            const newCost = cur + 1;
                            const newK = key(new_m, W - w);

                            // 确保新行有足够空间
                            if (w <= W && newCost < (dp.get(newK) ?? Infinity)) {
                                dp.set(newK, newCost);
                                parent.set(newK, {
                                    m,
                                    s,  // 保持原状态s
                                    act: 'N',  // N表示换行后放置
                                    i
                                });
                                console.log("↪️ wrap section", i, "to new line, w =", w);
                            }
                            continue;
                        }

                        // 正常放置
                        const new_k = key(new_m, s - w);
                        if (cur < (dp.get(new_k) ?? Infinity)) {
                            dp.set(new_k, cur);
                            parent.set(new_k, { m, s, act: 'A', i });
                        }
                    }
                }
            }

            let best_s = 0, best_rows = Infinity;
            for (let s = 0; s <= W; s++) {
                const k = key(N - 1, s);
                const val = dp.get(k);
                if (val != null) {
                    const total = val + (s < W ? 1 : 0);
                    if (total < best_rows) {
                        best_rows = total;
                        best_s = s;
                    }
                }
            }

            if (best_rows === Infinity) {
                console.warn("⚠️ DP failed, fallback to one section per row");
                return secs.map(s => [s]);
            }

            // 回溯构建分组
            const groups = [], row = [], placed = new Set();
            let m = N - 1, s = best_s;

            while (m !== 0 || s !== W) {
                const p = parent.get(key(m, s));
                if (!p) {
                    for (let i = 0; i < n; i++) {
                        if ((m >> i) & 1) {
                            row.unshift(secs[i]);
                            placed.add(i);
                        }
                    }
                    break;
                }

                if (p.act === 'E') {
                    groups.unshift([...row]);
                    row.length = 0;
                } else if (p.act === 'W') {
                    if (row.length) groups.unshift([...row]);
                    groups.unshift([secs[p.i]]);
                    placed.add(p.i);
                    row.length = 0;
                } else if (p.act === 'N') {  // 关键修复3：处理换行放置
                    if (row.length) groups.unshift([...row]);
                    row.length = 0;
                    row.unshift(secs[p.i]);  // 在新行中放置
                    placed.add(p.i);
                } else { // 'A'
                    row.unshift(secs[p.i]);
                    placed.add(p.i);
                }

                m = p.m;
                s = p.s;
            }

            if (row.length) groups.unshift([...row]);

            // 回溯修复
            if (placed.size < n) {
                console.warn("⚠️ Backtracking incomplete, adding missing sections");
                for (let i = 0; i < n; i++) {
                    if (!placed.has(i)) groups.push([secs[i]]);
                }
            }

            if (!unsorted) {
                groups.forEach(g => g.sort((a, b) => a.origIndex - b.origIndex));
            }

            return shape === 'triangle'
                ? groups.map((g, i) => i % 2 ? g.reverse() : g)
                : groups;
        }




        function heuristic(secs, W, shape, unsorted) {
            // 简洁处理边界情况
            if (secs.length <= 1) return secs.length === 0 ? [] : [secs];

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

            // 确保至少返回一行
            if (rows.length === 0) {
                return secs.map(s => [s]);
            }

            if (!unsorted) rows.forEach(r => r.sort((a, b) => a.origIndex - b.origIndex));
            if (shape === 'triangle') return rows.map((r, i) => i % 2 ? r.reverse() : r);
            return rows;
        }

        self.onmessage = function (e) {
            const { items, cfg } = e.data;
            // 确保至少返回每个section一行
            if (items.length === 0) {
                postMessage([]);
                return;
            }

            const secs = items.map((o, i) => ({ min_w: o.min_w, origIndex: i }));
            let groups = secs.length > 15
                ? heuristic(secs, cfg.W, cfg.shape, cfg.unsorted)
                : pack_dp(secs, cfg.W, cfg.unsorted, cfg.overflow, cfg.maxr, cfg.shape);

            // 最终保障：如果算法失败，回退到每行一个section
            if (groups.length === 0) {
                groups = secs.map(s => [s]);
            }

            postMessage(groups);
        };
    }

    function compute_in_worker(items, cfg) {
        return new Promise((resolve) => {
            // 空输入处理
            if (items.length === 0) {
                resolve([]);
                return;
            }

            try {
                const blob = new Blob(["(" + worker_main.toString() + ")()"], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                const worker = new Worker(url);
                worker.postMessage({ items, cfg });
                worker.onmessage = e => {
                    resolve(e.data);
                    worker.terminate();
                    URL.revokeObjectURL(url);
                };
                worker.onerror = err => {
                    console.error('Worker error:', err);
                    // 回退：每行一个section
                    resolve(items.map((_, i) => [{ origIndex: i }]));
                    worker.terminate();
                    URL.revokeObjectURL(url);
                };
            } catch (e) {
                console.error('Worker creation failed:', e);
                // 回退：每行一个section
                resolve(items.map((_, i) => [{ origIndex: i }]));
            }
        });
    }

    function render_layout(wrapper_id, groups, shape, container = 'div') {
        let wrap = document.getElementById(wrapper_id);
        const is_new = !wrap;
        if (is_new) {
            wrap = document.createElement(container);
            wrap.id = wrapper_id;
            wrap.className = 'horizontal-section-container';
        }
        wrap.classList.toggle('triangle-layout', shape === 'triangle');

        const allSections = groups.flat().filter(Boolean).map(item => item.el);
        const existingChildren = Array.from(wrap.children);

        existingChildren.forEach(child => {
            if (child.tagName === 'SECTION' && !allSections.includes(child)) {
                wrap.removeChild(child);
            }
        });

        allSections.forEach(section => {
            if (section && !wrap.contains(section)) {
                wrap.appendChild(section);
            }
        });

        if (is_new && groups.flat()[0]?.el?.parentNode) {
            groups.flat()[0].el.parentNode.insertBefore(wrap, groups.flat()[0].el);
            console.log(`⚙️ 插入 ${container} 容器: ${wrapper_id}`);
        }
    }

    function init_section_packer(cfg) {
        inject_style();
        console.log('⚙️ Section Packer 启动');

        const {
            section_groups,
            container = 'div',
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

                if (found === 0) {
                    console.warn(`⚠️ ${wid} 未找到任何 section`);
                    continue;
                }

                if (found < sels.length) {
                    console.error(`❌ ${wid} 缺少 section`, sels.filter((s, i) => !els[i]));
                    continue;
                }

                const secs = els.map(el => ({ el, min_w: calc_min_width(el) }));

                try {
                    const groups_raw = await compute_in_worker(
                        secs.map(s => ({ min_w: s.min_w })),
                        {
                            W: w,
                            unsorted: allow_unsorted,
                            overflow: allow_overflow,
                            maxr: max_rows,
                            shape: layout_shape
                        }
                    );

                    console.log(`⚙️ ${wid} 找到 ${groups_raw.length} 组`);

                    // 确保分组有效
                    const groups = groups_raw
                        .map(g => g.map(it => ({
                            el: secs[it.origIndex]?.el || null
                        }))
                            .filter(g => g.length > 0));

                    // 调度渲染任务
                    schedule_idle(() => render_layout(wid, groups, layout_shape, container));
                } catch (err) {
                    console.warn('⚠️ worker 调度失败：', err);
                    // 回退：每行一个section
                    const fallback = secs.map(s => [s]);
                    schedule_idle(() => render_layout(wid, fallback, layout_shape, container));
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