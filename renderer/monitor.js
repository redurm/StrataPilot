'use strict';

/*
 * The Monitor panel (#12, step 7): the server list, the health dot, and the metric
 * cards that stream from it.

 * The card tables (MON_CARDS, MON_STATES) stay in app.js on purpose: they are built
 * with i18nKey() while app.js loads, and a moved script that calls into app.js at
 * load time is a dead window (step 2). The cards here read them at call time.

 * Loaded before app.js; nothing here runs at load time.
 */

function renderMonitorServers() {
  if (!els.monServers) return;
  const urls = monitorServerUrls();
  const signature = `${urls.join('|')}#${monitor.baseUrl || ''}`;
  if (signature === monitor.serversSignature) return;
  monitor.serversSignature = signature;
  els.monServers.textContent = '';

  const follow = el('button', `mon-server${monitor.baseUrl ? '' : ' active'}`, tr('active tab'));
  follow.title = tr("follow the active tab's server ({url})", { url: strataBaseUrl() });
  follow.dataset.url = '';
  follow.addEventListener('click', () => {
    monitor.baseUrl = '';
    monitor.serversSignature = null;
    renderMonitorServers();
    pollMonitor();
  });
  els.monServers.appendChild(follow);

  for (const url of urls) {
    const pill = el('button', `mon-server${monitor.baseUrl && serverKey(monitor.baseUrl) === serverKey(url) ? ' active' : ''}`, serverLabel(url));
    pill.title = url;
    pill.dataset.url = url;
    const dot = el('span', 'mon-dot unknown');
    dot.title = tr('health unknown');
    pill.appendChild(dot);
    pill.addEventListener('click', () => {
      monitor.baseUrl = url;
      monitor.serversSignature = null;
      renderMonitorServers();
      pollMonitor();
    });
    if (serverKey(url) !== serverKey(strataBaseUrl())) {
      const remove = el('span', 'mon-server-x', '×');
      remove.title = tr('stop watching {url} (removes it from Settings)', { url });
      remove.addEventListener('click', async (event) => {
        event.stopPropagation();
        const kept = (Array.isArray(state.settings.strataUrls) ? state.settings.strataUrls : []).filter((entry) => serverKey(entry) !== serverKey(url));
        const merged = await api.settingsSet({ strataUrls: kept });
        state.settings = merged || { ...state.settings, strataUrls: kept };
        if (monitor.baseUrl && serverKey(monitor.baseUrl) === serverKey(url)) monitor.baseUrl = '';
        monitor.serversSignature = null;
        renderMonitorServers();
        pollMonitor();
      });
      pill.appendChild(remove);
    }
    els.monServers.appendChild(pill);
    applyHealthDot(pill, url);
  }

  const add = el('button', 'mon-server mon-server-add', tr('+ add server'));
  add.title = tr('watch another Strata address (saved in Settings)');
  add.addEventListener('click', async () => {
    const answer = await openModal({ kind: 'input', title: tr('Add a Strata server'), message: tr('Base address, e.g. http://127.0.0.1:8082/v1'), placeholder: 'http://127.0.0.1:8082/v1', okLabel: tr('Watch it') });
    if (!answer || answer.cancelled || !String(answer.value || '').trim()) return;
    const url = String(answer.value).trim();
    const current = Array.isArray(state.settings.strataUrls) ? state.settings.strataUrls : [];
    const merged = await api.settingsSet({ strataUrls: [...new Set([...current, url])] });
    state.settings = merged || { ...state.settings, strataUrls: [...current, url] };
    monitor.baseUrl = url;
    monitor.serversSignature = null;
    renderMonitorServers();
    pollMonitor();
    toast(tr('watching {url}', { url }), 'info', 3000);
  });
  els.monServers.appendChild(add);
}

function applyHealthDot(pill, url) {
  const dot = pill.querySelector('.mon-dot');
  if (!dot) return;
  const health = monitor.health.get(serverKey(url));
  if (!health) {
    dot.className = 'mon-dot unknown';
    dot.title = tr('health not checked yet');
    return;
  }
  if (health.ok) {
    dot.className = 'mon-dot ok';
    dot.title = tr('reachable in {ms}ms', { ms: health.ms });
  } else {
    dot.className = 'mon-dot bad';
    dot.title = health.error ? tr(health.error) : tr('not reachable');
  }
}

function renderMonitor(data) {
  const live = data.live || {};
  const hw = data.hardware || {};
  const st = data.hardware_static || {};
  const eng = data.engine || {};
  const history = data.history || {};
  const requests = data.requests || [];
  const last = requests[0];

  // model state
  const on = live.queued > 0 ? 'queued' : live.state;
  for (const badge of els.monBadges.children) {
    badge.classList.toggle('on', badge.dataset.s === on || badge.dataset.s === live.state);
  }
  let label = tr('Waiting for a request');
  let detail = '';
  let pct = 0;
  if (live.state === 'reading') {
    label = tr('Reading prompt');
    if (live.prompt_total) {
      pct = (100 * live.prompt_read) / live.prompt_total;
      detail = tr('{read} / {total} tokens · {pct}%', { read: nfmt(live.prompt_read), total: nfmt(live.prompt_total), pct: nfmt(pct) });
    } else {
      detail = tr('{n} tokens', { n: nfmt(live.prompt_tokens) });
    }
  } else if (live.state === 'generating') {
    label = live.phase ? tr(live.phase[0].toUpperCase() + live.phase.slice(1)) : tr('Generating');
    pct = live.max_tokens ? Math.min(100, (100 * live.generated) / live.max_tokens) : 0;
    detail = tr('{n} tokens · {rate} tok/s', { n: nfmt(live.generated), rate: nfmt(live.tok_s, 1) });
  } else if (last) {
    detail = tr('last: {n} tokens{at}', { n: nfmt(last.output_tokens), at: last.decode_tok_s ? tr(' at {rate} tok/s', { rate: nfmt(last.decode_tok_s, 1) }) : '' });
  }
  els.monStateLabel.textContent = live.queued > 0 ? tr('{label} · {n} queued', { label, n: live.queued }) : label;
  els.monStateDetail.textContent = detail;
  els.monStateBar.style.width = `${pct}%`;
  els.monStateBar.classList.toggle('info', live.state === 'reading');

  // metric cards
  const speed = live.state === 'generating' ? live.tok_s : last ? last.decode_tok_s : null;
  setMetric('speed', speed == null ? null : nfmt(speed, 1), 't/s', live.state === 'generating' ? tr('Decode now') : last ? tr('Decode last request') : tr('Decode'));
  const prefill =
    live.state !== 'idle' ? live.prefill_tok_s_mean : last && last.prompt_ms > 0 ? Math.max(0, last.prompt_tokens - (last.reused || 0)) / (last.prompt_ms / 1000) : null;
  setMetric('prefill', prefill == null ? null : nfmt(prefill), 't/s', live.state === 'reading' ? tr('Prefill now') : live.state === 'generating' ? tr('Prefill this request') : last ? tr('Prefill last request') : tr('Prefill'));
  drawSpark('sp-speed', history.tok_s);
  drawSpark('sp-prefill', history.prefill_tok_s_mean);

  const gpus = hw.gpus || [];
  const multi = gpus.length > 1;
  const perGpu = (fn) => gpus.map((g) => `${tr('GPU')} ${g.index} ${fn(g)}`).join(' · ');
  setMetric('gpu', hw.gpu_util == null ? null : nfmt(hw.gpu_util), '%', multi ? perGpu((g) => (g.util == null ? '–' : `${nfmt(g.util)}%`)) : st.gpu_name || (st.gpu_note ? tr('not available') : ''));
  drawSpark('sp-gpu', history.gpu_util, 100);
  setMetric(
    'vram',
    hw.gpu_mem_used == null ? null : gb(hw.gpu_mem_used),
    hw.gpu_mem_total ? `/ ${gb(hw.gpu_mem_total, 0)} GB` : 'GB',
    multi ? perGpu((g) => (g.mem_used == null ? '–' : `${gb(g.mem_used)} GB`)) : eng.expert_slots ? tr('{n} experts cached', { n: nfmt(eng.expert_slots) }) : st.gpu_note ? tr('not available on Windows AMD yet') : '',
  );
  drawSpark('sp-vram', history.gpu_mem_used, hw.gpu_mem_total);
  setMetric('temp', hw.gpu_temp == null ? null : nfmt(hw.gpu_temp), '°C', multi ? perGpu((g) => (g.temp == null ? '–' : `${nfmt(g.temp)}°`)) : '');
  drawSpark('sp-temp', history.gpu_temp, 90);
  setMetric('power', hw.gpu_power == null ? null : nfmt(hw.gpu_power), 'W', hw.gpu_power_limit ? tr('of {n} W limit', { n: nfmt(hw.gpu_power_limit) }) : '');
  drawSpark('sp-power', history.gpu_power, hw.gpu_power_limit);
  const gen = hw.gpu_pcie_gen_max || hw.gpu_pcie_gen;
  setMetric(
    'pcie',
    gen ? `Gen${gen}` : null,
    hw.gpu_pcie_width ? `x${hw.gpu_pcie_width}` : '',
    hw.gpu_pcie_rx_mb == null
      ? ''
      : `${tr('to GPU')} ${nfmt(hw.gpu_pcie_rx_mb, hw.gpu_pcie_rx_mb < 10 ? 1 : 0)} MB/s` + (hw.gpu_pcie_gen && gen && hw.gpu_pcie_gen < gen ? ` · ${tr('idle')} Gen${hw.gpu_pcie_gen}` : ''),
  );
  drawSpark('sp-pcie', history.gpu_pcie_rx_mb);
  setMetric('cpu', hw.cpu == null ? null : nfmt(hw.cpu), '%', st.threads ? `${st.cores ? `${st.cores} ${tr('cores')} · ` : ''}${st.threads} ${tr('threads')}` : '');
  drawSpark('sp-cpu', history.cpu, 100);
  if (hw.disk_read_mb == null) {
    setMetric('disk', null, '', st.psutil ? '' : tr('needs psutil'));
  } else {
    const big = hw.disk_read_mb >= 1000;
    setMetric(
      'disk',
      big ? nfmt(hw.disk_read_mb / 1024, 2) : nfmt(hw.disk_read_mb, hw.disk_read_mb < 10 ? 1 : 0),
      big ? 'GB/s' : 'MB/s',
      hw.disk_write_mb == null ? '' : `${tr('write')} ${nfmt(hw.disk_write_mb, 1)} MB/s`,
    );
  }
  drawSpark('sp-disk', history.disk_read_mb);

  // context fill ring
  const ctx = eng.max_context || 0;
  let used = 0;
  if (live.state !== 'idle') used = (live.prompt_tokens || 0) + (live.generated || 0);
  else if (last) used = (last.prompt_tokens || 0) + (last.output_tokens || 0);
  const frac = ctx ? Math.min(1, used / ctx) : 0;
  const arc = RING_C * frac;
  // inline style, NOT setAttribute: `.ring-fill { stroke-dasharray: 0 ... }` in the
  // stylesheet is a real CSS declaration, so it overrode the presentation attribute
  // and the arc stayed zero-length (a lone round dot while the label said 50%)
  els.monCtxFill.style.strokeDasharray = `${arc.toFixed(1)} ${RING_C.toFixed(1)}`;
  els.monCtxFill.style.opacity = arc >= 3 ? '1' : '0';
  els.monCtxFill.classList.toggle('warn', frac >= 0.75 && frac < 0.9);
  els.monCtxFill.classList.toggle('crit', frac >= 0.9);
  els.monCtxPct.textContent = `${Math.round(frac * 100)}%`;
  els.monCtxSub.textContent = ctx ? `${kfmt(used)} / ${ctxfmt(ctx)}` : '–';

  const cacheBytes = (eng.expert_cache_mib || 0) * 1048576;
  els.monSlotsText.textContent = eng.expert_slots ? `${nfmt(eng.expert_slots)} · ${gb(cacheBytes)} GB` : '–';
  els.monSlotsBar.style.width = hw.gpu_mem_total ? `${Math.min(100, (100 * cacheBytes) / hw.gpu_mem_total)}%` : '0%';
  els.monRamText.textContent = hw.ram_total ? `${gb(hw.ram_used)} / ${gb(hw.ram_total, 0)} GB` : '–';
  els.monRamBar.style.width = hw.ram_total ? `${Math.min(100, (100 * hw.ram_used) / hw.ram_total)}%` : '0%';
  els.monTempText.textContent = hw.gpu_temp == null ? '–' : `${nfmt(hw.gpu_temp)} °C`;
  els.monTempBar.style.width = hw.gpu_temp == null ? '0%' : `${Math.min(100, hw.gpu_temp)}%`;
  els.monEngineText.textContent = `${eng.model || '?'} · ctx ${ctxfmt(eng.max_context)} · kv ${eng.kv || '?'}${eng.version ? ` · ${eng.version}` : ''}`;

  // recent requests
  if (!requests.length) {
    els.monReqBody.innerHTML = `<tr><td colspan="9" class="muted">${tr('No requests yet')}</td></tr>`;
  } else {
    const badge = {
      stop: ['ok', tr('Done')],
      length: ['warn', tr('Max tokens')],
      cancel: ['warn', tr('Stopped')],
      disconnect: ['warn', tr('Closed')],
      error: ['error', tr('Error')],
    };
    const MON_MAX_ROWS = 150;
    const shown = monitor.showAll ? requests.slice(0, MON_MAX_ROWS) : requests.slice(0, 12);
    els.monReqBody.innerHTML = shown
      .map((r) => {
        const [cls, text] = badge[r.finish] || ['', r.finish || '–'];
        const time = new Date(r.time * 1000).toLocaleTimeString(i18nInfo.lang === 'en' ? [] : i18nInfo.lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const hit =
          r.hit_rate == null
            ? '–'
            : `${(r.hit_rate * 100).toFixed(1)}%` +
              (r.pcie_share
                ? ` <span class="muted" title="${tr('routed experts the GPU read over PCIe (--pcie-frac) or another GPU computed')}">+${(r.pcie_share * 100).toFixed(1)}%P</span>`
                : '');
        const fresh = r.prompt_tokens == null ? null : Math.max(0, r.prompt_tokens - (r.reused || 0));
        const prefillRate = fresh > 0 && r.prompt_ms > 0 ? fresh / (r.prompt_ms / 1000) : null;
        return `<tr><td>${window.escapeHtml(time)}</td><td><span class="req-badge ${cls}">${window.escapeHtml(text)}</span></td><td class="num">${nfmt(r.prompt_tokens)}</td><td class="num">${nfmt(r.reused)}</td><td class="num">${nfmt(r.output_tokens)}</td><td class="num">${nfmt(prefillRate)}</td><td class="num">${nfmt(r.decode_tok_s, 1)}</td><td class="num">${hit}</td><td class="num">${nfmt(r.duration_s, 1)} s</td></tr>`;
      })
      .join('');
    if (monitor.showAll && requests.length > shown.length) {
      els.monReqBody.insertAdjacentHTML(
        'beforeend',
        `<tr><td colspan="9" class="muted">${tr('newest {shown} of {total} shown (the rest are hidden to keep the UI light)', { shown: shown.length, total: requests.length })}</td></tr>`,
      );
    }
  }
  const kept = data.requests_kept == null ? requests.length : data.requests_kept;
  els.monReqAll.hidden = kept <= 12;
  els.monReqAll.textContent = monitor.showAll ? tr('Show fewer') : tr('Show all ({n})', { n: kept });
  els.monReqBody.closest('.req-wrap').classList.toggle('all', monitor.showAll);
  els.monTotals.textContent = monitorTotalsLine(data.totals);
}

function applyMonitorWidth() {
  const width = Math.min(900, Math.max(340, Number(state.settings.monitorWidth) || 500));
  document.documentElement.style.setProperty('--mon-w', `${width}px`);
}

function buildMonitorCards() {
  if (monitor.built) return;
  els.monBadges.textContent = '';
  for (const s of MON_STATES) {
    const badge = el('span', 'st-badge', tr(MON_STATE_BADGE_LABELS[s] || s));
    badge.dataset.s = s;
    els.monBadges.appendChild(badge);
  }
  els.monCards.textContent = '';
  for (const card of MON_CARDS) {
    const node = el('div', 'mcard');
    node.appendChild(el('div', 'mcard-head', tr(card.label)));
    node.innerHTML +=
      card.key === 'speed'
        ? `<div class="m-pair">
             <div><span class="m-value" id="mv-speed">&ndash;</span><span class="m-sub" id="ms-speed">${tr('Decode')}</span></div>
             <div><span class="m-value" id="mv-prefill">&ndash;</span><span class="m-sub" id="ms-prefill">${tr('Prefill')}</span></div>
           </div>
           <svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none">
             <g id="sp-prefill" class="pair2"><path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor" stroke-width="1.4"/></g>
             <g id="sp-speed"><path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor" stroke-width="1.6"/></g>
           </svg>`
        : `<span class="m-value" id="mv-${card.key}">&ndash;</span>
           <span class="m-sub" id="ms-${card.key}"></span>
           <svg class="spark" id="sp-${card.key}" data-tone="${card.tone || ''}" viewBox="0 0 100 32" preserveAspectRatio="none">
             <path class="area" fill="currentColor" opacity=".12"/><path class="line" fill="none" stroke="currentColor" stroke-width="1.6"/>
           </svg>`;
    els.monCards.appendChild(node);
  }
  monitor.built = true;
}
