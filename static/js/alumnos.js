import { esc, api, showToast, openVideoModal, closeVideoModal, registerPwa, getAuthToken, setAuthToken, clearAuthToken, formatWeekLabel } from './common.js';

registerPwa();

const $ = (id) => document.getElementById(id);

const state = {
  student: null,
  microcycles: [],
  microcycle: null,
  microcycleHash: '',
  selectedWeek: 1,
  selectedDayId: null,
  userExitedBrowserFs: false,
};

// ================= FULLSCREEN APP SHELL (START FULLSCREEN ON MOBILE) =================
function isBrowserFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function isStandalonePwa() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

async function enterBrowserFullscreen() {
  if (isBrowserFullscreen()) return;
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } catch {
        await el.requestFullscreen();
      }
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    }
  } catch {
    // Ignore if browser blocks outside gesture
  }
  updateFullscreenBtn();
}

async function exitBrowserFullscreen() {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
  } catch {}
  updateFullscreenBtn();
}

function updateFullscreenBtn() {
  const btn = $('btnFullscreen');
  if (!btn) return;
  if (isStandalonePwa()) {
    btn.classList.add('hidden');
    return;
  }
  btn.textContent = isBrowserFullscreen() ? '✕ Salir pantalla completa' : '⛶ Pantalla completa';
}

$('btnFullscreen').addEventListener('click', () => {
  if (!isBrowserFullscreen()) {
    state.userExitedBrowserFs = false;
    enterBrowserFullscreen();
  } else {
    state.userExitedBrowserFs = true;
    exitBrowserFullscreen();
  }
});
document.addEventListener('fullscreenchange', updateFullscreenBtn);
updateFullscreenBtn();

// ================= VIDEO MODAL =================
$('btnCloseVideo').addEventListener('click', closeVideoModal);
$('btnCloseVideoBottom').addEventListener('click', closeVideoModal);
$('videoModal').addEventListener('click', (e) => {
  if (e.target.id === 'videoModal') closeVideoModal();
});

// ================= LOGIN, REGISTRATION & LIVE SYNC =================
let syncIntervalId = null;

function setAuthTab(tab) {
  const isLogin = tab === 'login';
  $('tabLoginBtn').classList.toggle('active-tab', isLogin);
  $('tabRegisterBtn').classList.toggle('active-tab', !isLogin);
  $('studentLoginBox').classList.toggle('hidden', !isLogin);
  $('studentRegisterBox').classList.toggle('hidden', isLogin);
  $('loginError').textContent = '';
  $('regStatusMsg').textContent = '';
}

$('tabLoginBtn').addEventListener('click', () => setAuthTab('login'));
$('tabRegisterBtn').addEventListener('click', () => setAuthTab('register'));

function openStudentDashboard(student, microcycles, preferredCode = '') {
  state.student = student;
  state.microcycles = microcycles || [];

  if (state.microcycles.length === 0) {
    $('loginError').textContent = 'Tu entrenador aún no tiene ningún microciclo activo publicado.';
    return;
  }

  let selectedMc = state.microcycles[0];
  if (preferredCode) {
    const match = state.microcycles.find((m) => (m.access_code || '').toUpperCase() === preferredCode.toUpperCase());
    if (match) selectedMc = match;
  }

  const mcSelect = $('studentMcSelect');
  const mcWrap = $('studentMcSelectWrap');
  if (state.microcycles.length > 1) {
    mcWrap.classList.remove('hidden');
    mcSelect.innerHTML = '';
    state.microcycles.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} (${m.weeks_count || 4} sem · ${m.days_per_week || 5} días/sem)`;
      mcSelect.appendChild(opt);
    });
    mcSelect.value = String(selectedMc.id);
  } else {
    mcWrap.classList.add('hidden');
  }

  if (student?.full_name) {
    $('logName').value = student.full_name;
    localStorage.setItem('crossfit_student_name', student.full_name);
  }

  state.microcycle = selectedMc;
  state.microcycleHash = JSON.stringify(selectedMc);
  state.selectedWeek = 1;
  state.selectedDayId = selectedMc.days?.[0]?.id || null;

  $('loginSection').classList.add('hidden');
  $('studentApp').classList.remove('hidden');
  $('btnStudentLogout').classList.remove('hidden');
  $('syncBadge').classList.remove('hidden');
  renderStudentApp(true);
  startSyncLoop();
}

$('studentMcSelect')?.addEventListener('change', (e) => {
  const mc = state.microcycles.find((m) => Number(m.id) === Number(e.target.value));
  if (!mc) return;
  state.microcycle = mc;
  state.microcycleHash = JSON.stringify(mc);
  state.selectedWeek = 1;
  state.selectedDayId = mc.days?.[0]?.id || null;
  renderStudentApp(true);
});

async function submitStudentLogin() {
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  $('loginError').textContent = '';
  if (!email || !password) {
    $('loginError').textContent = 'Introduce tu correo (o usuario de Coach) y contraseña.';
    return;
  }
  try {
    const res = await api('/api/student/login', {
      method: 'POST',
      token: '',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token, 'student');
    if (res.student?.role === 'coach') {
      setAuthToken(res.token, 'coach');
    }
    $('loginPassword').value = '';
    const urlCode = new URLSearchParams(location.search).get('code') || '';
    openStudentDashboard(res.student, res.microcycles, urlCode);
  } catch (err) {
    $('loginError').textContent = err.message;
  }
}

async function submitStudentRegister() {
  const full_name = $('regName').value.trim();
  const email = $('regEmail').value.trim().toLowerCase();
  const phone = $('regPhone').value.trim();
  const password = $('regPassword').value;
  const msgEl = $('regStatusMsg');
  msgEl.textContent = '';

  if (full_name.length < 2 || !email.includes('@') || password.length < 4) {
    msgEl.style.color = '#fda4af';
    msgEl.textContent = 'Rellena nombre completo, email válido y contraseña (mín. 4 caracteres).';
    return;
  }

  try {
    const res = await api('/api/student/register', {
      method: 'POST',
      token: '',
      body: JSON.stringify({ full_name, email, phone, password }),
    });
    msgEl.style.color = 'var(--ground)';
    msgEl.textContent = res.message;
    $('regPassword').value = '';
    $('loginEmail').value = email;
  } catch (err) {
    msgEl.style.color = '#fda4af';
    msgEl.textContent = err.message;
  }
}

function logoutStudent(msg = '') {
  clearInterval(syncIntervalId);
  clearAuthToken('student');
  state.student = null;
  state.microcycle = null;
  $('studentApp').classList.add('hidden');
  $('loginSection').classList.remove('hidden');
  $('btnStudentLogout').classList.add('hidden');
  $('syncBadge').classList.add('hidden');
  if (msg) $('loginError').textContent = msg;
}

async function syncFromServer() {
  if (!state.microcycle?.access_code) return;
  try {
    const mc = await api(`/api/microcycles/code/${encodeURIComponent(state.microcycle.access_code)}`);
    const nextHash = JSON.stringify(mc);
    $('syncBadge').textContent = '● Sincronizado';
    if (nextHash !== state.microcycleHash) {
      state.microcycle = mc;
      state.microcycleHash = nextHash;
      const stillExists = (mc.days || []).some((d) => d.id === state.selectedDayId);
      if (!stillExists) {
        state.selectedWeek = 1;
        state.selectedDayId = mc.days?.[0]?.id || null;
      }
      renderStudentApp(!timerState.running && !timerState.preCounting);
    }
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      logoutStudent(err.message);
      return;
    }
    $('syncBadge').textContent = '○ Reconectando...';
  }
}

function startSyncLoop() {
  clearInterval(syncIntervalId);
  syncIntervalId = setInterval(syncFromServer, 15000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.microcycle) {
    syncFromServer();
  }
});
window.addEventListener('focus', () => {
  if (state.microcycle) syncFromServer();
});

$('btnStudentLogin').addEventListener('click', (e) => {
  autoFullscreenOnFirstTouch(e);
  submitStudentLogin();
});
$('loginPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitStudentLogin();
});
$('btnStudentRegister').addEventListener('click', submitStudentRegister);
$('btnStudentLogout').addEventListener('click', () => logoutStudent());

// ================= RENDERING =================
function renderStudentApp(resetTimer = true) {
  const mc = state.microcycle;
  $('mcGoalBadge').textContent = mc.primary_goal;
  $('mcTitle').textContent = mc.name;
  $('mcDesc').textContent = mc.description || '';
  $('headerSub').textContent = state.student?.full_name
    ? `Hola, ${state.student.full_name}`
    : `Programa: ${mc.name}`;
  renderWeekSelect();
  renderDayTabs();
  renderCurrentDay(resetTimer);
}

function renderWeekSelect() {
  const sel = $('weekSelect');
  if (!sel || !state.microcycle) return;
  sel.innerHTML = '';
  for (let w = 1; w <= state.microcycle.weeks_count; w++) {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = formatWeekLabel(state.microcycle, w);
    if (w === state.selectedWeek) opt.selected = true;
    sel.appendChild(opt);
  }
}

$('weekSelect')?.addEventListener('change', (e) => {
  const w = Number(e.target.value);
  state.selectedWeek = w;
  const firstDay = state.microcycle.days.find((d) => d.week_number === w);
  state.selectedDayId = firstDay?.id || null;
  renderDayTabs();
  renderCurrentDay(true);
});

function renderDayTabs() {
  const wrap = $('dayTabs');
  wrap.innerHTML = '';
  const weekDays = state.microcycle.days.filter((d) => d.week_number === state.selectedWeek);
  weekDays.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = `btn btn-sm ${d.id === state.selectedDayId ? 'active-tab' : ''}`;
    btn.textContent = `Día ${d.day_number}`;
    btn.addEventListener('click', () => {
      state.selectedDayId = d.id;
      renderDayTabs();
      renderCurrentDay(true);
    });
    wrap.appendChild(btn);
  });
}

function getTimedBlockMode(raw) {
  const t = (raw || '').toUpperCase().trim();
  if (!t || t.includes('SIN CRONO') || t === 'SIN' || t === 'FUERZA' || t === 'LIBRE') return null;
  if (t.includes('TABATA')) return 'TABATA';
  if (t.includes('EMOM') || t.includes('EMON')) return 'EMOM';
  if (t.includes('AMRAP')) return 'AMRAP';
  if (t.includes('FOR TIME') || t.includes('CHIPPER') || t.includes('RFT')) return 'FOR TIME';
  if (t.includes('CRONO')) return 'CRONO';
  return null;
}

function buildExerciseNameHtml(name, videoUrl) {
  if (videoUrl) {
    return `<a href="${esc(videoUrl)}" class="ex-video-link" data-video-link>${esc(name)}</a>`;
  }
  return `<strong>${esc(name)}</strong>`;
}

let currentDaySpecs = {};

function getWarmupTimerSpec(day) {
  const wt = day.warmup_timer || {};
  const rawType = (wt.type || day.warmup_type || '').toUpperCase();
  const mode = getTimedBlockMode(rawType);
  if (!mode || rawType.includes('SIN CRONO')) return null;

  let workSec = wt.tabata_work !== undefined && wt.tabata_work !== '' ? Number(wt.tabata_work) : 20;
  let restSec = wt.tabata_rest !== undefined && wt.tabata_rest !== '' ? Number(wt.tabata_rest) : 10;
  let tabataRounds = wt.tabata_rounds !== undefined && wt.tabata_rounds !== '' ? Number(wt.tabata_rounds) : 8;
  let intervalSec = wt.emom_interval !== undefined && wt.emom_interval !== '' ? Number(wt.emom_interval) : 60;
  const emomRounds = wt.emom_rounds !== undefined && wt.emom_rounds !== '' ? Number(wt.emom_rounds) : 8;
  let minutes = Number(wt.minutes) || 8;

  if (mode === 'TABATA') {
    minutes = Math.ceil(((workSec + restSec) * tabataRounds) / 60);
  } else if (mode === 'EMOM') {
    minutes = Math.round((intervalSec * emomRounds) / 60);
  }

  return {
    id: 'wu',
    sectionTitle: `WARM UP · ${day.warmup_type || 'Calentamiento'}`,
    mode,
    minutes,
    workSec,
    restSec,
    tabataRounds,
    intervalSec,
    emomRounds,
  };
}

function getPartTimerSpec(part, idx) {
  const rawType = (part.timer_type !== undefined && part.timer_type !== '' ? part.timer_type : part.type || '').toUpperCase();
  const mode = getTimedBlockMode(rawType);
  if (!mode || rawType.includes('SIN CRONO')) return null;

  let workSec = part.tabata_work !== undefined && part.tabata_work !== '' ? Number(part.tabata_work) : 20;
  let restSec = part.tabata_rest !== undefined && part.tabata_rest !== '' ? Number(part.tabata_rest) : 10;
  let tabataRounds = part.tabata_rounds !== undefined && part.tabata_rounds !== '' ? Number(part.tabata_rounds) : 8;
  let intervalSec = part.emom_interval !== undefined && part.emom_interval !== '' ? Number(part.emom_interval) : 60;
  const emomRounds = part.emom_rounds !== undefined && part.emom_rounds !== '' ? Number(part.emom_rounds) : 10;
  let minutes = Number(part.timer_minutes) || 12;

  if (mode === 'TABATA') {
    minutes = Math.ceil(((workSec + restSec) * tabataRounds) / 60);
  } else if (mode === 'EMOM') {
    minutes = Math.round((intervalSec * emomRounds) / 60);
  }

  const blockLabel = `BLOQUE ${idx + 1}`;
  return {
    id: `part-${idx}`,
    sectionTitle: `${blockLabel}: ${part.title || part.type || ''}`,
    mode,
    minutes,
    workSec,
    restSec,
    tabataRounds,
    intervalSec,
    emomRounds,
  };
}

function getWodTimerSpec(wod) {
  const rawType = (wod?.type || '').toUpperCase();
  if (!rawType || rawType.includes('SIN CRONO') || rawType === 'SIN') return null;
  const mode = getTimedBlockMode(rawType) || 'AMRAP';

  let workSec = wod?.tabata_work !== undefined && wod?.tabata_work !== '' ? Number(wod.tabata_work) : 20;
  let restSec = wod?.tabata_rest !== undefined && wod?.tabata_rest !== '' ? Number(wod.tabata_rest) : 10;
  let tabataRounds = wod?.tabata_rounds !== undefined && wod?.tabata_rounds !== '' ? Number(wod.tabata_rounds) : 8;
  let intervalSec = wod?.emom_interval !== undefined && wod?.emom_interval !== '' ? Number(wod.emom_interval) : 60;
  const emomRounds = wod?.emom_rounds !== undefined && wod?.emom_rounds !== '' ? Number(wod.emom_rounds) : 10;

  const capStr = `${wod?.time_cap || ''} ${wod?.description || ''} ${wod?.title || ''}`;
  const minMatch = capStr.match(/(\d+)\s*(?:min|minutos|'|m\b)/i);
  let minutes = minMatch ? Math.max(1, Math.min(90, parseInt(minMatch[1], 10))) : 12;
  if (wod?.minutes && !isNaN(Number(wod.minutes))) {
    minutes = Math.max(1, Math.min(90, Number(wod.minutes)));
  }

  if (mode === 'TABATA') {
    minutes = Math.ceil(((workSec + restSec) * tabataRounds) / 60);
  } else if (mode === 'EMOM') {
    minutes = Math.round((intervalSec * emomRounds) / 60);
  }

  return {
    id: 'wod',
    sectionTitle: `WOD FINAL · ${wod?.title || 'WOD'}`,
    mode,
    minutes,
    workSec,
    restSec,
    tabataRounds,
    intervalSec,
    emomRounds,
  };
}

function formatSpecSummary(spec) {
  if (!spec) return '';
  if (spec.mode === 'TABATA') {
    const cycleSec = (spec.workSec || 20) + (spec.restSec !== undefined ? spec.restSec : 10);
    const totalSec = cycleSec * (spec.tabataRounds || 8);
    const totalM = Math.floor(totalSec / 60);
    const totalS = totalSec % 60;
    const tStr = totalS > 0 ? `${totalM}m ${totalS}s` : `${totalM} min`;
    return `⚡ ${spec.tabataRounds || 8} rondas · ${spec.workSec || 20}s Trabajo (Azul) / ${spec.restSec !== undefined ? spec.restSec : 10}s Descanso (Verde) · Total: ${tStr}`;
  } else if (spec.mode === 'EMOM') {
    const intSec = spec.intervalSec || 60;
    const r = spec.emomRounds || Math.max(1, Math.round(((spec.minutes || 10) * 60) / intSec));
    return `⚡ Cada ${intSec}s · ${r} rondas (${spec.minutes} min en total)`;
  } else if (spec.mode === 'AMRAP') {
    return `⚡ ${spec.minutes} min de trabajo continuado (AMRAP)`;
  } else if (spec.mode === 'FOR TIME') {
    return `⚡ Time Cap: ${spec.minutes} min`;
  }
  return `⚡ Cronómetro listo (${spec.minutes} min)`;
}

function renderCronoWodHtml(spec, canFinish = false) {
  if (!spec) return '';
  const id = spec.id;
  const initialMs = spec.mode === 'AMRAP'
    ? (spec.minutes || 12) * 60 * 1000
    : (spec.mode === 'EMOM'
      ? (spec.intervalSec || 60) * 1000
      : (spec.mode === 'TABATA'
        ? (spec.workSec || 20) * 1000
        : 0));

  return `
    <div class="crono-wod-box no-print" data-crono-box="${id}" style="margin-top:14px; background:#080b10; border:1px solid rgba(2,132,199,0.35); border-radius:10px; padding:14px 16px;">
      <div class="row-between" style="align-items:flex-start; margin-bottom:8px; gap:8px;">
        <div>
          <span class="badge badge-celeste-matte">⏱ CRONO OFICIAL · ${esc(spec.mode)}</span>
          <div data-crono-sub="${id}" style="font-size:0.88rem; font-weight:700; color:#38bdf8; margin-top:4px;">
            ${esc(formatSpecSummary(spec))}
          </div>
        </div>
        <div class="row-wrap" style="gap:6px;">
          <button class="btn btn-sm btn-outline" data-crono-action="pro" data-crono-id="${id}" title="Abrir app oficial Crono CrossFit Pro en grande">⚡ Crono Pro ↗</button>
          <button class="btn btn-sm" data-crono-action="fullscreen" data-crono-id="${id}">⛶ Pantalla Completa</button>
        </div>
      </div>

      <div class="crono-status-line" data-crono-status="${id}" style="text-align:center; font-weight:900; font-size:1.15rem; min-height:26px; letter-spacing:0.5px; margin-bottom:4px;"></div>

      <div style="text-align:center; margin-bottom:10px;">
        <div class="timer-display" data-crono-display="${id}" title="Toca para ampliar en pantalla completa" style="cursor:pointer; margin:8px auto;">
          ${renderColoredDigitsHtml(initialMs)}
        </div>
      </div>

      <div class="row-wrap" style="justify-content:center; gap:8px;">
        <button class="btn btn-primary" data-crono-action="start" data-crono-id="${id}">▶ Iniciar</button>
        <button class="btn" data-crono-action="pause" data-crono-id="${id}">⏸ Pausar</button>
        <button class="btn btn-orange" data-crono-action="round" data-crono-id="${id}">+1 Ronda (<span data-crono-rounds="${id}">0</span>)</button>
        ${canFinish ? `<button class="btn btn-ground hidden" data-crono-action="finish" data-crono-id="${id}">🏁 ¡Terminado!</button>` : ''}
        <button class="btn btn-danger btn-sm" data-crono-action="reset" data-crono-id="${id}">↺ Reiniciar</button>
      </div>
    </div>
  `;
}

function renderCurrentDay(resetTimer = true) {
  const day = state.microcycle.days.find((d) => d.id === state.selectedDayId);
  const container = $('dayContent');
  if (!day) {
    container.innerHTML = '<div class="card"><p class="muted">No hay sesión configurada para este día.</p></div>';
    return;
  }

  const warmupType = day.warmup_type || 'Movilidad GROUND';
  const wu = day.warmup_exercises || [];
  currentDaySpecs = {};

  const wuSpec = getWarmupTimerSpec(day);
  if (wuSpec) currentDaySpecs['wu'] = wuSpec;

  const parts = day.parts || [];
  parts.forEach((p, idx) => {
    const pSpec = getPartTimerSpec(p, idx);
    if (pSpec) currentDaySpecs[`part-${idx}`] = pSpec;
  });

  const wod = day.wod || {};
  const wodSpec = getWodTimerSpec(wod);
  if (wodSpec) currentDaySpecs['wod'] = wodSpec;

  if (resetTimer || !timerState.activeId || !currentDaySpecs[timerState.activeId]) {
    const firstSpecKey = wuSpec?.id || (parts.length > 0 && currentDaySpecs['part-0']?.id) || wodSpec?.id || null;
    if (firstSpecKey && currentDaySpecs[firstSpecKey]) {
      loadSpecIntoTimer(currentDaySpecs[firstSpecKey]);
    }
  }

  let html = `
    <div class="print-header-brand">
      <div style="display:flex; justify-content:space-between; align-items:flex-end;">
        <div>
          <h1 style="margin:0; font-size:1.45rem; color:#0369a1; font-weight:900;">⚡ hecTHOR WOD</h1>
          <div style="font-size:0.88rem; color:#475569; margin-top:2px;">MESOCICLO: <strong>${esc(state.microcycle?.name || 'Crossfit Training')}</strong></div>
        </div>
        <div style="text-align:right; font-size:0.9rem; color:#0369a1; font-weight:800;">
          MICROCICLO ${day.week_number} · Día ${day.day_number}
        </div>
      </div>
    </div>

    <div class="card card-block-celeste">
      <div class="row-between" style="align-items:flex-start;">
        <div>
          <span class="badge badge-celeste-matte">MICROCICLO ${day.week_number} · Día ${day.day_number}</span>
          <h2 style="margin:8px 0 4px;">${esc(day.title)}</h2>
          ${day.coaching_tips ? `<p class="muted" style="margin:0;">💡 <strong>Coach:</strong> ${esc(day.coaching_tips)}</p>` : ''}
        </div>
        <button class="btn btn-sm btn-celeste-matte no-print" id="btnPrintDayPdf" style="display:inline-flex; align-items:center; gap:6px; white-space:nowrap; margin-top:2px;">
          🖨️ Imprimir / Guardar en PDF
        </button>
      </div>
    </div>

    <!-- 1. WARM UP CARD -->
    <div class="card card-block-celeste">
      <div class="section-header">
        <span class="badge badge-celeste-matte">WARM UP · ${esc(warmupType)}</span>
        ${wuSpec ? `<span class="badge badge-celeste-matte">${esc(wuSpec.mode)} · ${esc(wuSpec.minutes)} min</span>` : ''}
      </div>
      ${day.warmup_notes ? `<p class="muted" style="margin-top:0;">${esc(day.warmup_notes)}</p>` : ''}
      ${wu.length === 0 ? '<p class="muted">Sin movimientos listados en el calentamiento.</p>' : `
        <div class="ex-clean-list" id="stuWarmupList"></div>
      `}
      ${wuSpec ? renderCronoWodHtml(wuSpec, false) : ''}
    </div>

    <!-- 2. DAILY BLOCKS -->
    ${parts.map((p, idx) => {
      const pSpec = currentDaySpecs[`part-${idx}`];
      const blockLabel = `BLOQUE ${idx + 1}`;
      return `
        <div class="card card-block-celeste">
          <div class="section-header">
            <div>
              <span class="badge badge-celeste-matte">${esc(blockLabel)}${p.type ? ' · ' + esc(p.type) : ''}</span>
              <h3 class="section-title" style="margin-top:6px;">${esc(p.title || `Trabajo ${blockLabel}`)}</h3>
            </div>
            ${pSpec ? `<span class="badge badge-celeste-matte">${esc(pSpec.mode)} · ${esc(pSpec.minutes)} min</span>` : ''}
          </div>
          ${p.description ? `<p class="muted" style="margin-top:0;">${esc(p.description)}</p>` : ''}
          ${(p.exercises || []).length > 0 ? `
            <div class="ex-clean-list stu-part-ex" data-part-idx="${idx}"></div>
          ` : ''}
          ${p.has_score ? `
            <div class="block-score-box" style="margin-top:12px; background:rgba(255,107,53,0.08); border:1px dashed rgba(255,107,53,0.4); border-radius:8px; padding:10px 14px;">
              <div style="font-size:0.82rem; font-weight:800; color:var(--accent); text-transform:uppercase; margin-bottom:6px;">
                🏆 Registrar mi resultado en este bloque (${esc(p.title || blockLabel)})
              </div>
              <div class="row-wrap" style="gap:8px;">
                <input class="input" style="flex:1; min-width:180px;" data-block-score-input="${idx}" placeholder="Ej: 5x5 con 100 kg / Carga o marca alcanzada..." />
                <button class="btn btn-primary btn-sm" data-block-score-btn="${idx}" data-part-title="${esc(p.title || blockLabel)}">Guardar Marca</button>
              </div>
              <div data-block-score-status="${idx}" style="font-size:0.82rem; margin-top:4px;"></div>
            </div>
          ` : ''}
          ${pSpec ? renderCronoWodHtml(pSpec, false) : ''}
        </div>
      `;
    }).join('')}

    <!-- 3. WOD FINAL -->
    <div class="card card-block-celeste">
      <div class="section-header">
        <span class="badge badge-celeste-matte">WOD FINAL · ${esc(wod.type || 'WOD')}</span>
        ${wod.time_cap ? `<span class="badge badge-celeste-matte">${esc(wod.time_cap)}</span>` : ''}
      </div>
      <h3 style="margin:4px 0 8px;">${esc(wod.title || 'Entrenamiento del día')}</h3>
      ${wod.description ? `<div class="wod-pre">${esc(wod.description)}</div>` : '<p class="muted">Sin descripción.</p>'}
      ${wod.rx_weights ? `<p style="margin:6px 0;"><strong>Rx:</strong> ${esc(wod.rx_weights)}</p>` : ''}
      ${wod.scaled_weights ? `<p style="margin:6px 0;" class="muted"><strong>Escalado:</strong> ${esc(wod.scaled_weights)}</p>` : ''}
      ${wod.target_score ? `<p style="margin:6px 0;" class="muted"><strong>Objetivo:</strong> ${esc(wod.target_score)}</p>` : ''}
      ${wod.strategy ? `<p style="margin:6px 0;" class="muted"><strong>Estrategia:</strong> ${esc(wod.strategy)}</p>` : ''}
      ${(wod.movements || []).length > 0 ? `
        <div class="wod-videos-box no-print">
          <div class="muted" style="font-size:0.8rem; font-weight:800; text-transform:uppercase;">🎬 Vídeos de movimientos del WOD</div>
          <div id="stuWodMovements"></div>
        </div>
      ` : ''}
      ${wodSpec ? renderCronoWodHtml(wodSpec, true) : ''}
    </div>
  `;

  container.innerHTML = html;

  // Control student score logging card visibility according to wod.has_score
  const logCard = $('studentLogCard');
  if (logCard) {
    const wodHasScore = wod && wod.has_score !== false && wod.has_score !== 0 && wod.has_score !== 'false';
    logCard.style.display = wodHasScore ? 'block' : 'none';
  }

  // Print Day to PDF handler
  $('btnPrintDayPdf')?.addEventListener('click', () => {
    const prevTitle = document.title;
    const cleanDayTitle = (day.title || `Dia ${day.day_number}`).replace(/[/\\?%*:|"<>]/g, '-');
    document.title = `hecTHOR WOD - Microciclo ${day.week_number} - Día ${day.day_number} - ${cleanDayTitle}`;
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 1500);
  });

  // Populate Warmup clean rows: Badges on left + Exercise name + Video symbol button on right (Supports superseries)
  const wuWrap = $('stuWarmupList');
  if (wuWrap) {
    wu.forEach((item) => {
      const hasSubs = Array.isArray(item.sub_exercises) && item.sub_exercises.length > 0;
      if (!hasSubs) {
        const row = document.createElement('div');
        row.className = 'ex-clean-line';
        row.innerHTML = `
          <div class="ex-clean-left">
            <div class="ex-clean-badges">
              ${item.sets ? `<span class="badge badge-celeste-matte">${esc(item.sets)}</span>` : ''}
              ${item.reps ? `<span class="badge badge-accent">${esc(item.reps)}</span>` : ''}
            </div>
            <div class="ex-clean-title">
              <strong>${esc(item.name)}</strong>
              ${item.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(item.notes)}</div>` : ''}
            </div>
          </div>
          ${item.video_url ? `
            <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(item.name)}" data-url="${esc(item.video_url)}" data-notes="${esc(item.notes || '')}" title="Ver vídeo explicativo">
              🎬 <span class="video-btn-text">Vídeo</span>
            </button>
          ` : ''}
        `;
        wuWrap.appendChild(row);
      } else {
        const totalEx = 1 + item.sub_exercises.length;
        const box = document.createElement('div');
        box.className = 'ex-group-card';
        box.style.cssText = 'border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:10px 12px; margin-bottom:8px; background:rgba(56,189,248,0.03);';
        
        let subHtml = `
          ${item.sets ? `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span class="badge badge-celeste-matte" style="font-size:0.78rem; font-weight:800;">${esc(item.sets)}</span>
            </div>
          ` : ''}
          <div class="ex-clean-line" style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed rgba(255,255,255,0.08);">
            <div class="ex-clean-left">
              <div class="ex-clean-badges">
                <span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800;">1</span>
                ${item.reps ? `<span class="badge badge-accent">${esc(item.reps)}</span>` : ''}
              </div>
              <div class="ex-clean-title">
                <strong>${esc(item.name)}</strong>
                ${item.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(item.notes)}</div>` : ''}
              </div>
            </div>
            ${item.video_url ? `
              <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(item.name)}" data-url="${esc(item.video_url)}" data-notes="${esc(item.notes || '')}" title="Ver vídeo explicativo">
                🎬 <span class="video-btn-text">Vídeo</span>
              </button>
            ` : ''}
          </div>
        `;

        item.sub_exercises.forEach((sub, sIdx) => {
          const isLast = sIdx === item.sub_exercises.length - 1;
          subHtml += `
            <div class="ex-clean-line" style="${!isLast ? 'margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed rgba(255,255,255,0.08);' : ''}">
              <div class="ex-clean-left">
                <div class="ex-clean-badges">
                  <span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800;">${sIdx + 2}</span>
                  ${sub.reps ? `<span class="badge badge-accent">${esc(sub.reps)}</span>` : ''}
                </div>
                <div class="ex-clean-title">
                  <strong>${esc(sub.name)}</strong>
                  ${sub.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(sub.notes)}</div>` : ''}
                </div>
              </div>
              ${sub.video_url ? `
                <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(sub.name)}" data-url="${esc(sub.video_url)}" data-notes="${esc(sub.notes || '')}" title="Ver vídeo explicativo">
                  🎬 <span class="video-btn-text">Vídeo</span>
                </button>
              ` : ''}
            </div>
          `;
        });

        box.innerHTML = subHtml;
        wuWrap.appendChild(box);
      }
    });
  }

  // Populate Parts clean rows: Badges on left + Exercise name + Video symbol button on right (Supports superseries)
  parts.forEach((p, idx) => {
    const pWrap = container.querySelector(`.stu-part-ex[data-part-idx="${idx}"]`);
    if (pWrap) {
      (p.exercises || []).forEach((ex) => {
        const hasSubs = Array.isArray(ex.sub_exercises) && ex.sub_exercises.length > 0;
        if (!hasSubs) {
          const row = document.createElement('div');
          row.className = 'ex-clean-line';
          row.innerHTML = `
            <div class="ex-clean-left">
              <div class="ex-clean-badges">
                ${ex.sets ? `<span class="badge badge-celeste-matte">${esc(ex.sets)}</span>` : ''}
                ${ex.reps ? `<span class="badge badge-accent">${esc(ex.reps)}</span>` : ''}
                ${ex.load ? `<span class="badge" style="background:rgba(255,255,255,0.08); color:#f8fafc;">${esc(ex.load)}</span>` : ''}
                ${ex.rest ? `<span class="badge" style="background:rgba(255,255,255,0.05); color:#94a3b8;">⏱ ${esc(ex.rest)}</span>` : ''}
              </div>
              <div class="ex-clean-title">
                <strong>${esc(ex.name)}</strong>
                ${ex.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(ex.notes)}</div>` : ''}
              </div>
            </div>
            ${ex.video_url ? `
              <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(ex.name)}" data-url="${esc(ex.video_url)}" data-notes="${esc(ex.notes || '')}" title="Ver vídeo explicativo">
                🎬 <span class="video-btn-text">Vídeo</span>
              </button>
            ` : ''}
          `;
          pWrap.appendChild(row);
        } else {
          const totalEx = 1 + ex.sub_exercises.length;
          const box = document.createElement('div');
          box.className = 'ex-group-card';
          box.style.cssText = 'border:1px solid rgba(56,189,248,0.25); border-radius:8px; padding:10px 12px; margin-bottom:8px; background:rgba(56,189,248,0.03);';
          
          let subHtml = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              ${ex.sets ? `<span class="badge badge-celeste-matte" style="font-size:0.78rem; font-weight:800;">${esc(ex.sets)} series</span>` : '<span></span>'}
              ${ex.rest ? `<span class="badge" style="background:rgba(255,255,255,0.05); color:#94a3b8;">⏱ ${esc(ex.rest)}</span>` : ''}
            </div>
            <div class="ex-clean-line" style="margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed rgba(255,255,255,0.08);">
              <div class="ex-clean-left">
                <div class="ex-clean-badges">
                  <span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800;">1</span>
                  ${ex.reps ? `<span class="badge badge-accent">${esc(ex.reps)}</span>` : ''}
                  ${ex.load ? `<span class="badge" style="background:rgba(255,255,255,0.08); color:#f8fafc;">${esc(ex.load)}</span>` : ''}
                </div>
                <div class="ex-clean-title">
                  <strong>${esc(ex.name)}</strong>
                  ${ex.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(ex.notes)}</div>` : ''}
                </div>
              </div>
              ${ex.video_url ? `
                <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(ex.name)}" data-url="${esc(ex.video_url)}" data-notes="${esc(ex.notes || '')}" title="Ver vídeo explicativo">
                  🎬 <span class="video-btn-text">Vídeo</span>
                </button>
              ` : ''}
            </div>
          `;

          ex.sub_exercises.forEach((sub, sIdx) => {
            const isLast = sIdx === ex.sub_exercises.length - 1;
            subHtml += `
              <div class="ex-clean-line" style="${!isLast ? 'margin-bottom:6px; padding-bottom:6px; border-bottom:1px dashed rgba(255,255,255,0.08);' : ''}">
                <div class="ex-clean-left">
                  <div class="ex-clean-badges">
                    <span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; font-weight:800;">${sIdx + 2}</span>
                    ${sub.reps ? `<span class="badge badge-accent">${esc(sub.reps)}</span>` : ''}
                    ${sub.load ? `<span class="badge" style="background:rgba(255,255,255,0.08); color:#f8fafc;">${esc(sub.load)}</span>` : ''}
                  </div>
                  <div class="ex-clean-title">
                    <strong>${esc(sub.name)}</strong>
                    ${sub.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(sub.notes)}</div>` : ''}
                  </div>
                </div>
                ${sub.video_url ? `
                  <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(sub.name)}" data-url="${esc(sub.video_url)}" data-notes="${esc(sub.notes || '')}" title="Ver vídeo explicativo">
                    🎬 <span class="video-btn-text">Vídeo</span>
                  </button>
                ` : ''}
              </div>
            `;
          });

          box.innerHTML = subHtml;
          pWrap.appendChild(box);
        }
      });
    }
  });

  // Populate WOD movements videos
  const wodMovWrap = $('stuWodMovements');
  if (wodMovWrap) {
    (wod.movements || []).forEach((m) => {
      const box = document.createElement('div');
      box.className = 'wod-video-item';
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'space-between';
      box.style.gap = '10px';
      box.innerHTML = `
        <div>
          <strong>${esc(m.name || 'Movimiento')}</strong>
          ${m.notes ? `<div class="muted" style="font-size:0.82rem; margin-top:2px;">${esc(m.notes)}</div>` : ''}
        </div>
        ${m.video_url ? `
          <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(m.name || 'Movimiento')}" data-url="${esc(m.video_url)}" data-notes="${esc(m.notes || '')}" title="Ver vídeo explicativo">
            🎬 <span class="video-btn-text">Vídeo</span>
          </button>
        ` : ''}
      `;
      wodMovWrap.appendChild(box);
    });
  }

  // Handle all video buttons
  container.querySelectorAll('[data-video-btn]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openVideoModal(btn.dataset.name, btn.dataset.url, btn.dataset.notes || '');
    });
  });

  // Attach Crono WOD action handlers (Iniciar, Pausar, Rondas, Reiniciar, Pantalla Completa, Crono Pro)
  container.querySelectorAll('[data-crono-action="start"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      startTimerForSection(btn.dataset.cronoId);
    });
  });
  container.querySelectorAll('[data-crono-action="pause"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      pauseTimer();
    });
  });
  container.querySelectorAll('[data-crono-action="round"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      addRoundForSection(btn.dataset.cronoId);
    });
  });
  container.querySelectorAll('[data-crono-action="finish"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      finishTimer();
    });
  });
  container.querySelectorAll('[data-crono-action="reset"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      resetTimerForSection(btn.dataset.cronoId);
    });
  });
  container.querySelectorAll('[data-crono-action="fullscreen"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cid = btn.dataset.cronoId;
      if (cid && currentDaySpecs[cid]) {
        loadSpecIntoTimer(currentDaySpecs[cid]);
      }
      openFsClock();
    });
  });
  container.querySelectorAll('[data-crono-action="pro"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cid = btn.dataset.cronoId;
      const spec = cid && currentDaySpecs[cid] ? currentDaySpecs[cid] : null;
      openCronoProModal(spec);
    });
  });
  container.querySelectorAll('[data-crono-display]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cid = el.dataset.cronoDisplay;
      if (cid && currentDaySpecs[cid]) {
        loadSpecIntoTimer(currentDaySpecs[cid]);
      }
      openFsClock();
    });
  });

  // Handle Block Score submissions
  container.querySelectorAll('[data-block-score-btn]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = btn.dataset.blockScoreBtn;
      const input = container.querySelector(`[data-block-score-input="${idx}"]`);
      const status = container.querySelector(`[data-block-score-status="${idx}"]`);
      const scoreVal = (input?.value || '').trim();
      if (!scoreVal) {
        if (status) status.innerHTML = '<span style="color:#f87171;">Introduce tu marca antes de guardar.</span>';
        return;
      }
      const day = state.microcycle.days.find((d) => d.id === state.selectedDayId);
      const part = (day?.parts || [])[idx];
      const blockLabel = `BLOQUE ${Number(idx) + 1}`;
      const blockTitle = btn.dataset.partTitle || part?.title || blockLabel;

      btn.disabled = true;
      btn.textContent = 'Guardando...';
      try {
        const studentName = state.student?.full_name || $('logName')?.value || 'Alumno';
        await apiFetch('/api/student/log', {
          method: 'POST',
          body: JSON.stringify({
            microcycle_id: state.microcycle.id,
            day_id: day.id,
            student_name: studentName,
            score: scoreVal,
            rx_status: 'Bloque',
            weights_used: '',
            notes: `[${blockLabel}] ${blockTitle}`,
          }),
        });
        if (status) status.innerHTML = '<span style="color:#22c55e; font-weight:800;">✓ ¡Marca registrada con éxito!</span>';
        showToast(`Marca de ${blockLabel} registrada`);
        loadDayLeaderboard();
      } catch (err) {
        if (status) status.innerHTML = `<span style="color:#f87171;">Error al guardar: ${esc(err.message)}</span>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar Marca';
      }
    });
  });

  loadDayLeaderboard();
}

async function loadDayLeaderboard() {
  if (!state.microcycle || !state.selectedDayId) return;
  const logs = await api(`/api/student/logs/${state.microcycle.id}?day_id=${state.selectedDayId}`);
  const wrap = $('dayLeaderboard');
  if (logs.length === 0) {
    wrap.innerHTML = '<p class="muted">Sé el primero en registrar tu marca hoy.</p>';
    return;
  }
  wrap.innerHTML = '';
  logs.forEach((l) => {
    const row = document.createElement('div');
    row.className = 'item-box';
    row.innerHTML = `
      <div class="row-between">
        <strong>${esc(l.student_name)}</strong>
        <span class="badge badge-accent">${esc(l.score)} (${esc(l.rx_status)})</span>
      </div>
      ${l.weights_used ? `<div class="muted">Pesos: ${esc(l.weights_used)}</div>` : ''}
      ${l.notes ? `<div class="muted">${esc(l.notes)}</div>` : ''}
    `;
    wrap.appendChild(row);
  });
}

$('btnSubmitLog').addEventListener('click', async () => {
  const name = $('logName').value.trim();
  const score = $('logScore').value.trim();
  if (!name || !score) return showToast('Introduce tu nombre y tu marca');
  try {
    await api('/api/student/log', {
      method: 'POST',
      body: JSON.stringify({
        microcycle_id: state.microcycle.id,
        day_id: state.selectedDayId,
        student_name: name,
        score,
        rx_status: $('logRx').value,
        weights_used: $('logWeights').value.trim(),
        notes: $('logNotes').value.trim(),
      }),
    });
    $('logScore').value = '';
    $('logNotes').value = '';
    localStorage.setItem('crossfit_student_name', name);
    await loadDayLeaderboard();
    showToast('¡Resultado guardado!');
  } catch (err) {
    showToast(err.message);
  }
});

// ================= HIGH-PRECISION SMART GYM TIMER =================
let rafId = null;
let audioCtx = null;
let lastWholeSecMark = -1;
let lastPreCountWhole = -1;
let autoOpenedByLandscape = false;

const timerState = {
  mode: 'AMRAP',       // AMRAP | EMOM | TABATA | FOR TIME | CRONO
  totalMinutes: 12,
  intervalSec: 60,
  tabataRounds: 8,
  workSec: 20,
  restSec: 10,
  elapsedMs: 0,
  displayMs: 12 * 60 * 1000,
  rounds: 0,
  running: false,
  preCounting: false,
  preCountMs: 0,
  lastTickTs: 0,
  soundStyle: 'pitido',
  preCountSeconds: 3,
  wodTitle: 'WOD',
};

function playTone(kind = 'tick') {
  const style = timerState.soundStyle;
  if (style === 'silencio') return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    const makeOsc = (freq, dur, type = 'sine', gainVal = 0.25, delay = 0) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + delay);
      gain.gain.setValueAtTime(gainVal, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + dur);
    };

    if (style === 'bocina') {
      const f = kind === 'go' || kind === 'finish' ? 420 : 320;
      const d = kind === 'finish' ? 0.55 : kind === 'go' ? 0.35 : 0.14;
      makeOsc(f, d, 'sawtooth', 0.22);
      makeOsc(f * 1.25, d, 'sawtooth', 0.15);
    } else if (style === 'campana') {
      const base = kind === 'finish' ? 1180 : 920;
      const d = kind === 'tick' ? 0.2 : 0.65;
      makeOsc(base, d, 'triangle', 0.28);
      makeOsc(base * 1.5, d * 0.8, 'sine', 0.16);
    } else if (style === 'suave') {
      const f = kind === 'go' || kind === 'finish' ? 784 : 523;
      makeOsc(f, kind === 'finish' ? 0.45 : 0.15, 'sine', 0.18);
    } else {
      // pitido clásico gimnasio
      if (kind === 'finish') {
        makeOsc(1046, 0.22, 'square', 0.2, 0);
        makeOsc(1046, 0.22, 'square', 0.2, 0.26);
        makeOsc(1318, 0.45, 'square', 0.22, 0.52);
      } else if (kind === 'go' || kind === 'phase') {
        makeOsc(1046, 0.3, 'square', 0.22);
      } else {
        makeOsc(740, 0.12, 'square', 0.16);
      }
    }
  } catch {}
}

function renderColoredDigitsHtml(ms) {
  const clamped = Math.max(0, Math.floor(ms));
  const totalCs = Math.floor(clamped / 10);
  const cs = String(totalCs % 100).padStart(2, '0');
  const totalSec = Math.floor(totalCs / 100);
  const sec = String(totalSec % 60).padStart(2, '0');
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  return `<span class="tm-min">${min}</span><span class="tm-sep">:</span><span class="tm-sec">${sec}</span><span class="tm-dot">.</span><span class="tm-cs">${cs}</span>`;
}

function parseWodSpec(wod) {
  const rawType = (wod?.type || '').toUpperCase();
  const capStr = `${wod?.time_cap || ''} ${wod?.description || ''} ${wod?.title || ''}`;
  const minMatch = capStr.match(/(\d+)\s*(?:min|minutos|'|m\b)/i);
  let minutes = minMatch ? Math.max(1, Math.min(90, parseInt(minMatch[1], 10))) : 12;
  if (wod?.minutes && !isNaN(Number(wod.minutes))) {
    minutes = Math.max(1, Math.min(90, Number(wod.minutes)));
  }

  let mode = 'AMRAP';
  if (rawType.includes('EMOM')) mode = 'EMOM';
  else if (rawType.includes('TABATA')) mode = 'TABATA';
  else if (rawType.includes('TIME') || rawType.includes('CHIPPER') || rawType.includes('RFT')) mode = 'FOR TIME';
  else if (rawType.includes('AMRAP')) mode = 'AMRAP';
  else if (capStr.toUpperCase().includes('EMOM')) mode = 'EMOM';
  else if (capStr.toUpperCase().includes('TABATA')) mode = 'TABATA';
  else if (capStr.toUpperCase().includes('FOR TIME')) mode = 'FOR TIME';

  let workSec = wod?.tabata_work !== undefined && wod?.tabata_work !== '' ? Number(wod.tabata_work) : 20;
  let restSec = wod?.tabata_rest !== undefined && wod?.tabata_rest !== '' ? Number(wod.tabata_rest) : 10;
  let tabataRounds = wod?.tabata_rounds !== undefined && wod?.tabata_rounds !== '' ? Number(wod.tabata_rounds) : 8;
  let intervalSec = wod?.emom_interval !== undefined && wod?.emom_interval !== '' ? Number(wod.emom_interval) : 60;
  const emomRounds = wod?.emom_rounds !== undefined && wod?.emom_rounds !== '' ? Number(wod.emom_rounds) : 10;

  if (mode === 'TABATA') {
    if (wod?.tabata_work === undefined) {
      const wrMatch = capStr.match(/(\d+)\s*(?:s|seg)?\s*[/x]\s*(\d+)\s*(?:s|seg)?/i);
      if (wrMatch) {
        workSec = Math.max(5, parseInt(wrMatch[1], 10));
        restSec = Math.max(0, parseInt(wrMatch[2], 10));
      }
    }
    if (wod?.tabata_rounds === undefined) {
      const rMatch = capStr.match(/(\d+)\s*(?:rondas|rounds|r\b|intervalos)/i);
      if (rMatch) {
        tabataRounds = Math.max(1, Math.min(50, parseInt(rMatch[1], 10)));
      }
    }
    minutes = Math.ceil(((workSec + restSec) * tabataRounds) / 60);
  } else if (mode === 'EMOM') {
    if (wod?.emom_interval === undefined) {
      const everyMatch = capStr.match(/(?:cada|every)\s*(\d+)\s*(?:min|minutos|m\b)/i);
      if (everyMatch) intervalSec = Math.max(1, parseInt(everyMatch[1], 10)) * 60;
    }
    if (wod?.emom_rounds !== undefined) {
      minutes = Math.round((intervalSec * emomRounds) / 60);
    }
  }

  return {
    mode,
    minutes,
    intervalSec,
    workSec,
    restSec,
    tabataRounds,
    wodTitle: wod?.title || 'WOD del día',
  };
}

function loadSpecIntoTimer(spec) {
  if (!spec) return;
  stopTimer();
  timerState.activeId = spec.id;
  timerState.mode = spec.mode || 'AMRAP';
  timerState.totalMinutes = spec.minutes || 12;
  timerState.intervalSec = spec.intervalSec || 60;
  timerState.emomRounds = spec.emomRounds || 10;
  timerState.tabataRounds = spec.tabataRounds || 8;
  timerState.workSec = spec.workSec !== undefined ? spec.workSec : 20;
  timerState.restSec = spec.restSec !== undefined ? spec.restSec : 10;
  timerState.wodTitle = spec.sectionTitle || 'Cronómetro';
  resetTimerState();
}

function startTimerForSection(id) {
  const spec = currentDaySpecs[id];
  if (!spec) return;
  if (timerState.activeId !== id) {
    loadSpecIntoTimer(spec);
  }
  startTimer();
}

function pauseTimer() {
  stopTimer();
  renderTimerUI();
}

function resetTimerForSection(id) {
  const spec = currentDaySpecs[id];
  if (spec) {
    loadSpecIntoTimer(spec);
  } else {
    resetTimerState();
  }
}

function addRoundForSection(id) {
  if (timerState.activeId !== id && currentDaySpecs[id]) {
    loadSpecIntoTimer(currentDaySpecs[id]);
  }
  addRound(1);
}

function openCronoProModal(spec) {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  if (modal && iframe) {
    let url = '/crono/';
    if (spec) {
      const p = new URLSearchParams();
      if (spec.mode) p.set('mode', spec.mode);
      if (spec.workSec !== undefined) p.set('work', spec.workSec);
      if (spec.restSec !== undefined) p.set('rest', spec.restSec);
      if (spec.tabataRounds !== undefined) p.set('rounds', spec.tabataRounds);
      if (spec.minutes !== undefined) p.set('time', spec.minutes);
      if (spec.intervalSec !== undefined) p.set('interval', spec.intervalSec);
      url += `?${p.toString()}`;
    }
    const newTab = modal.querySelector('a[href^="/crono"]');
    if (newTab) newTab.href = url;
    iframe.src = url;
    modal.classList.add('open');
  }
}

function resetTimerState() {
  stopTimer();
  timerState.elapsedMs = 0;
  timerState.rounds = 0;
  timerState.preCounting = false;
  timerState.preCountMs = 0;
  lastWholeSecMark = -1;
  lastPreCountWhole = -1;

  if (timerState.mode === 'AMRAP') {
    timerState.displayMs = (timerState.totalMinutes || 12) * 60 * 1000;
  } else if (timerState.mode === 'EMOM') {
    timerState.displayMs = (timerState.intervalSec || 60) * 1000;
  } else if (timerState.mode === 'TABATA') {
    timerState.displayMs = (timerState.workSec || 20) * 1000;
  } else {
    timerState.displayMs = 0;
  }

  renderTimerUI();
}

function renderTimerUI() {
  const mode = timerState.mode;
  let badgeTxt = '';
  let intervalTxt = '';
  let statusClass = '';
  let phaseClass = '';

  if (timerState.preCounting) {
    const secsLeft = Math.ceil(timerState.preCountMs / 1000);
    badgeTxt = `⏳ PREPARADOS · ${mode}`;
    intervalTxt = `EMPEZAMOS EN ${secsLeft}...`;
    statusClass = 'status-prep';
    phaseClass = 'phase-prep';
  } else {
    if (mode === 'AMRAP') {
      badgeTxt = '⏱ AMRAP';
      intervalTxt = `Cap: ${timerState.totalMinutes}:00`;
    } else if (mode === 'EMOM') {
      const totalIntervals = timerState.emomRounds || Math.max(1, Math.round(((timerState.totalMinutes || 10) * 60) / (timerState.intervalSec || 60)));
      const currentInterval = Math.min(totalIntervals, Math.floor(timerState.elapsedMs / ((timerState.intervalSec || 60) * 1000)) + 1);
      badgeTxt = '⏱ EMOM';
      intervalTxt = `Intervalo ${currentInterval} de ${totalIntervals}`;
    } else if (mode === 'TABATA') {
      const workMs = (timerState.workSec || 20) * 1000;
      const restMs = (timerState.restSec !== undefined ? timerState.restSec : 10) * 1000;
      const cycleMs = workMs + restMs;
      const totalTabataMs = (timerState.tabataRounds || 8) * cycleMs;
      const roundIdx = Math.min(timerState.tabataRounds || 8, Math.floor(timerState.elapsedMs / cycleMs) + 1);
      const inCycle = timerState.elapsedMs % cycleMs;
      const isWork = inCycle < workMs;
      const phaseSecLeft = Math.ceil((isWork ? (workMs - inCycle) : (cycleMs - inCycle)) / 1000);

      badgeTxt = `⏱ TABATA · RONDA ${roundIdx}/${timerState.tabataRounds || 8}`;
      if (timerState.elapsedMs >= totalTabataMs) {
        intervalTxt = '¡TABATA COMPLETADO!';
        statusClass = 'status-prep';
        phaseClass = 'phase-prep';
      } else if (isWork) {
        intervalTxt = `🔵 TRABAJO (${phaseSecLeft}s) · Ronda ${roundIdx} de ${timerState.tabataRounds || 8}`;
        statusClass = 'status-work';
        phaseClass = 'phase-work';
      } else {
        intervalTxt = `🟢 DESCANSO (${phaseSecLeft}s) · Ronda ${roundIdx} de ${timerState.tabataRounds || 8}`;
        statusClass = 'status-rest';
        phaseClass = 'phase-rest';
      }
    } else if (mode === 'FOR TIME') {
      badgeTxt = '⏱ FOR TIME';
      intervalTxt = `Cap ${String(timerState.totalMinutes || 15).padStart(2, '0')}:00`;
    } else {
      badgeTxt = '⏱ CRONO LIBRE';
      intervalTxt = '';
    }
  }

  // Update Fullscreen overlay
  const fsBadge = $('fsClockBadge');
  if (fsBadge) fsBadge.textContent = badgeTxt;
  const fsTitle = $('fsClockTitle');
  if (fsTitle) fsTitle.textContent = timerState.wodTitle;
  const fsSt = $('fsClockStatus');
  if (fsSt) {
    fsSt.className = statusClass || '';
    fsSt.textContent = intervalTxt || '';
  }

  const fsDigits = $('fsClockDigits');
  if (fsDigits) {
    if (timerState.preCounting) {
      const secsLeft = Math.ceil(timerState.preCountMs / 1000);
      fsDigits.innerHTML = `<span class="fs-clock-precount">${secsLeft}</span>`;
    } else {
      fsDigits.innerHTML = renderColoredDigitsHtml(timerState.displayMs);
    }
    fsDigits.classList.remove('phase-work', 'phase-rest', 'phase-prep');
    if (phaseClass) fsDigits.classList.add(phaseClass);
  }

  const fsRounds = $('fsRoundsDisplay');
  if (fsRounds) {
    fsRounds.textContent = mode === 'TABATA'
      ? `Ronda ${Math.min(timerState.tabataRounds || 8, Math.floor(timerState.elapsedMs / ((((timerState.workSec || 20) + (timerState.restSec !== undefined ? timerState.restSec : 10))) * 1000)) + 1)} de ${timerState.tabataRounds || 8}`
      : `Rondas: ${timerState.rounds}`;
  }

  const isActive = timerState.running || timerState.preCounting;
  const fsPauseBtn = $('fsBtnTogglePause');
  if (fsPauseBtn) {
    fsPauseBtn.textContent = isActive ? '⏸' : '▶';
    fsPauseBtn.setAttribute('aria-label', isActive ? 'Pausar' : 'Iniciar');
  }

  // Update Active Inline Box
  if (timerState.activeId) {
    const aid = timerState.activeId;
    const dispEl = document.querySelector(`[data-crono-display="${aid}"]`);
    if (dispEl) {
      if (timerState.preCounting) {
        const secsLeft = Math.ceil(timerState.preCountMs / 1000);
        dispEl.innerHTML = `<span class="fs-clock-precount" style="font-size:2.8rem;">${secsLeft}</span>`;
      } else {
        dispEl.innerHTML = renderColoredDigitsHtml(timerState.displayMs);
      }
      dispEl.classList.remove('phase-work', 'phase-rest', 'phase-prep');
      if (phaseClass) dispEl.classList.add(phaseClass);
    }

    const stEl = document.querySelector(`[data-crono-status="${aid}"]`);
    if (stEl) {
      stEl.className = `crono-status-line ${statusClass || ''}`;
      stEl.textContent = intervalTxt || (timerState.rounds > 0 ? `Rondas: ${timerState.rounds}` : '');
    }

    const rEl = document.querySelector(`[data-crono-rounds="${aid}"]`);
    if (rEl) {
      rEl.textContent = timerState.rounds;
    }

    const finishBtn = document.querySelector(`[data-crono-action="finish"][data-crono-id="${aid}"]`);
    if (finishBtn) {
      const showFinish = mode === 'FOR TIME' || mode === 'CRONO';
      finishBtn.classList.toggle('hidden', !showFinish);
    }
  }
}

function stopTimer() {
  cancelAnimationFrame(rafId);
  rafId = null;
  timerState.running = false;
  timerState.preCounting = false;
}

function timerFrame(ts) {
  if (!timerState.running && !timerState.preCounting) return;
  const dt = Math.max(0, ts - timerState.lastTickTs);
  timerState.lastTickTs = ts;

  if (timerState.preCounting) {
    timerState.preCountMs -= dt;
    const whole = Math.ceil(timerState.preCountMs / 1000);
    if (whole !== lastPreCountWhole && whole > 0) {
      lastPreCountWhole = whole;
      if (whole <= 3) playTone('tick');
    }
    if (timerState.preCountMs <= 0) {
      timerState.preCounting = false;
      timerState.running = true;
      lastWholeSecMark = -1;
      playTone('go');
    }
    renderTimerUI();
    rafId = requestAnimationFrame(timerFrame);
    return;
  }

  const mode = timerState.mode;
  const totalMs = (timerState.totalMinutes || 12) * 60 * 1000;
  timerState.elapsedMs += dt;

  if (mode === 'AMRAP') {
    const rem = Math.max(0, totalMs - timerState.elapsedMs);
    timerState.displayMs = rem;
    const secLeft = Math.ceil(rem / 1000);
    if (secLeft !== lastWholeSecMark) {
      lastWholeSecMark = secLeft;
      if (secLeft <= 3 && secLeft > 0) playTone('tick');
    }
    if (rem <= 0) {
      stopTimer();
      playTone('finish');
      if (timerState.activeId === 'wod') {
        const logEl = $('logScore');
        if (logEl) logEl.value = `${timerState.rounds} rondas`;
      }
      showToast('⏱ ¡AMRAP terminado!');
    }
  } else if (mode === 'EMOM') {
    if (timerState.elapsedMs >= totalMs) {
      timerState.displayMs = 0;
      stopTimer();
      playTone('finish');
      showToast('⏱ ¡EMOM terminado!');
    } else {
      const intMs = (timerState.intervalSec || 60) * 1000;
      const mod = timerState.elapsedMs % intMs;
      const rem = intMs - mod;
      timerState.displayMs = rem;
      const wholeElapsed = Math.floor(timerState.elapsedMs / 1000);
      if (wholeElapsed !== lastWholeSecMark) {
        lastWholeSecMark = wholeElapsed;
        const secInInt = wholeElapsed % (timerState.intervalSec || 60);
        if (secInInt === 0 && wholeElapsed > 0) playTone('phase');
        else if ((timerState.intervalSec || 60) - secInInt <= 3) playTone('tick');
      }
    }
  } else if (mode === 'TABATA') {
    const workMs = (timerState.workSec || 20) * 1000;
    const restMs = (timerState.restSec !== undefined ? timerState.restSec : 10) * 1000;
    const cycleMs = workMs + restMs;
    const totalTabataMs = (timerState.tabataRounds || 8) * cycleMs;
    if (timerState.elapsedMs >= totalTabataMs) {
      timerState.displayMs = 0;
      stopTimer();
      playTone('finish');
      showToast('⏱ ¡TABATA terminado!');
    } else {
      const inCycle = timerState.elapsedMs % cycleMs;
      const isWork = inCycle < workMs;
      timerState.displayMs = isWork ? (workMs - inCycle) : (cycleMs - inCycle);

      const wholeSec = Math.floor(timerState.elapsedMs / 1000);
      if (wholeSec !== lastWholeSecMark) {
        lastWholeSecMark = wholeSec;
        const cycleSec = (timerState.workSec || 20) + (timerState.restSec !== undefined ? timerState.restSec : 10);
        const secMod = wholeSec % cycleSec;
        if (wholeSec > 0 && secMod === 0) {
          playTone('go'); // Inicio de trabajo
        } else if (wholeSec > 0 && secMod === (timerState.workSec || 20)) {
          playTone('phase'); // Inicio de descanso
        } else {
          const remInPhase = isWork ? ((timerState.workSec || 20) - (secMod % (timerState.workSec || 20))) : (cycleSec - secMod);
          if (remInPhase <= 3 && remInPhase > 0) {
            playTone('tick');
          }
        }
      }
    }
  } else {
    timerState.displayMs = timerState.elapsedMs;
    if (mode === 'FOR TIME' && timerState.elapsedMs >= totalMs) {
      timerState.displayMs = totalMs;
      stopTimer();
      playTone('finish');
      if (timerState.activeId === 'wod') {
        const logEl = $('logScore');
        if (logEl) logEl.value = `Time Cap (${String(timerState.totalMinutes || 15).padStart(2, '0')}:00)`;
      }
      showToast('⏱ ¡Time Cap alcanzado!');
    }
  }

  renderTimerUI();
  if (timerState.running || timerState.preCounting) {
    rafId = requestAnimationFrame(timerFrame);
  }
}

function startTimer() {
  if (timerState.running || timerState.preCounting) return;
  const preSec = Number(timerState.preCountSeconds) || 0;
  timerState.lastTickTs = performance.now();
  if (timerState.elapsedMs === 0 && preSec > 0) {
    timerState.preCounting = true;
    timerState.preCountMs = preSec * 1000;
    lastPreCountWhole = preSec;
    playTone('tick');
  } else {
    timerState.running = true;
    playTone('go');
  }
  renderTimerUI();
  rafId = requestAnimationFrame(timerFrame);
}

function finishTimer() {
  stopTimer();
  playTone('finish');
  const totalSec = Math.floor(timerState.elapsedMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const t = `${mm}:${ss}`;
  const logScoreEl = $('logScore');
  if (logScoreEl) logScoreEl.value = t;
  renderTimerUI();
  showToast(`🏁 Tiempo registrado: ${t}`);
}

function addRound(delta) {
  timerState.rounds = Math.max(0, timerState.rounds + delta);
  if (delta > 0) playTone('tick');
  const logScoreEl = $('logScore');
  if (logScoreEl && timerState.activeId === 'wod') {
    logScoreEl.value = `${timerState.rounds} rondas`;
  }
  renderTimerUI();
}

// ================= FULLSCREEN GYM CLOCK =================
function openFsClock() {
  const overlay = $('fsClockOverlay');
  if (overlay) {
    overlay.classList.add('open');
  }
  try {
    if (!isBrowserFullscreen() && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch {}
  renderTimerUI();
}

function closeFsClock() {
  const overlay = $('fsClockOverlay');
  if (overlay) {
    overlay.classList.remove('open');
  }
}

function handleOrientationCheck() {
  if ($('fsClockOverlay')?.classList.contains('open')) {
    renderTimerUI();
  }
}

window.addEventListener('resize', handleOrientationCheck);
screen.orientation?.addEventListener('change', handleOrientationCheck);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('fsClockOverlay')?.classList.contains('open')) {
    closeFsClock();
  }
});

$('btnCloseFsClock')?.addEventListener('click', closeFsClock);

$('fsBtnTogglePause')?.addEventListener('click', () => {
  if (timerState.running || timerState.preCounting) {
    stopTimer();
    renderTimerUI();
  } else {
    startTimer();
  }
});
$('fsBtnAddRound')?.addEventListener('click', () => addRound(1));
$('fsBtnSubRound')?.addEventListener('click', () => addRound(-1));

$('btnCloseCronoPro')?.addEventListener('click', () => {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  if (modal && iframe) {
    modal.classList.remove('open');
    iframe.src = 'about:blank';
  }
});

// Auto-resume saved student session if valid & approved
async function restoreStudentSession() {
  const savedName = localStorage.getItem('crossfit_student_name');
  if (savedName) $('logName').value = savedName;

  const stuTok = getAuthToken('student');
  const coachTok = getAuthToken('coach');
  const tok = stuTok || coachTok;
  if (!tok) return;
  try {
    const res = await api('/api/student/me', { token: tok });
    const urlCode = new URLSearchParams(location.search).get('code') || '';
    const stu = res.actor?.role === 'student'
      ? res.actor
      : { full_name: `Coach (${res.actor?.username || 'Entrenador'})`, role: 'coach' };
    if (!stuTok && coachTok) {
      setAuthToken(coachTok, 'student');
    }
    openStudentDashboard(stu, res.microcycles, urlCode);
  } catch {
    if (stuTok) clearAuthToken('student');
  }
}

restoreStudentSession();
