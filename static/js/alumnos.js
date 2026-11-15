import { esc, api, showToast, openVideoModal, closeVideoModal, registerPwa, getAuthToken, setAuthToken, clearAuthToken, formatWeekLabel, formatWeekDateRange, cleanMesocycleTitle } from './common.js';

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

  // Recordar el mesociclo activo editado por el Coach o visto previamente
  const savedActiveMcId = Number(localStorage.getItem('hecthor_active_mc_id'));
  const foundActive = state.microcycles.find((m) => m.id === savedActiveMcId);
  let selectedMc = foundActive || state.microcycles[0];
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

  // Recordar la semana y día exactos que se estaban editando o viendo
  const savedWeek = Number(localStorage.getItem(`hecthor_active_week_${selectedMc.id}`)) || Number(localStorage.getItem('hecthor_active_week')) || 1;
  state.selectedWeek = (savedWeek >= 1 && savedWeek <= selectedMc.weeks_count) ? savedWeek : 1;

  const savedDayId = Number(localStorage.getItem(`hecthor_active_day_${selectedMc.id}`)) || Number(localStorage.getItem('hecthor_active_day_id'));
  const weekDays = (selectedMc.days || []).filter((d) => d.week_number === state.selectedWeek);
  const targetDay = weekDays.find((d) => d.id === savedDayId) || weekDays[0] || selectedMc.days?.[0];
  state.selectedDayId = targetDay?.id || null;

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
  localStorage.setItem('hecthor_active_mc_id', String(mc.id));

  const savedWeek = Number(localStorage.getItem(`hecthor_active_week_${mc.id}`)) || 1;
  state.selectedWeek = (savedWeek >= 1 && savedWeek <= mc.weeks_count) ? savedWeek : 1;

  const savedDayId = Number(localStorage.getItem(`hecthor_active_day_${mc.id}`));
  const weekDays = (mc.days || []).filter((d) => d.week_number === state.selectedWeek);
  const targetDay = weekDays.find((d) => d.id === savedDayId) || weekDays[0] || mc.days?.[0];
  state.selectedDayId = targetDay?.id || null;

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
  if (state.microcycle) {
    localStorage.setItem(`hecthor_active_week_${state.microcycle.id}`, String(w));
    localStorage.setItem('hecthor_active_week', String(w));
  }
  const firstDay = state.microcycle.days.find((d) => d.week_number === w);
  state.selectedDayId = firstDay?.id || null;
  if (firstDay && state.microcycle) {
    localStorage.setItem(`hecthor_active_day_${state.microcycle.id}`, String(firstDay.id));
    localStorage.setItem('hecthor_active_day_id', String(firstDay.id));
  }
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
      if (state.microcycle) {
        localStorage.setItem(`hecthor_active_day_${state.microcycle.id}`, String(d.id));
        localStorage.setItem('hecthor_active_day_id', String(d.id));
      }
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

function cleanSetsVal(val) {
  if (!val) return '';
  const s = String(val).trim();
  const m = s.match(/^(\d+)\s*(?:rondas|rounds|sets|series|r\b)?$/i);
  if (m) return m[1];
  return s;
}

function formatSpecButtonLabel(spec) {
  if (!spec) return 'Crono Pro';
  if (spec.mode === 'TABATA') {
    return `TABATA ${spec.tabataRounds || 8}R (${spec.workSec || 20}s/${spec.restSec !== undefined ? spec.restSec : 10}s)`;
  } else if (spec.mode === 'EMOM') {
    const intSec = spec.intervalSec || 60;
    return `EMOM ${spec.minutes || 10}' (cada ${intSec}s)`;
  } else if (spec.mode === 'AMRAP') {
    return `AMRAP ${spec.minutes || 8}'`;
  } else if (spec.mode === 'FOR TIME') {
    return `FOR TIME (Cap: ${spec.minutes || 10}')`;
  }
  return `${spec.mode || 'CRONO'} ${spec.minutes ? spec.minutes + "'" : ''}`;
}

function renderCronoProLinkHtml(spec) {
  if (!spec) return '';
  const id = spec.id;
  const label = formatSpecButtonLabel(spec);
  return `
    <div class="crono-pro-link-wrap no-print" style="margin-top:12px; display:flex; justify-content:flex-end;">
      <button class="btn-crono-pro-action" type="button" data-crono-action="pro" data-crono-id="${id}" title="Abrir cronómetro oficial para este ejercicio">
        ⏱ Crono Pro (${esc(label)}) ↗
      </button>
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

  (day.warmup_exercises || []).forEach((item, itemIdx) => {
    if (item.is_timed_section) {
      currentDaySpecs[`wu-timed-${itemIdx}`] = {
        id: `wu-timed-${itemIdx}`,
        label: item.name || `${item.timer_type || 'AMRAP'} (${item.timer_minutes || 10} min)`,
        mode: item.timer_type || 'AMRAP',
        minutes: Number(item.timer_minutes) || 10,
        workSec: Number(item.tabata_work !== undefined ? item.tabata_work : 20),
        restSec: Number(item.tabata_rest !== undefined ? item.tabata_rest : 10),
        tabataRounds: Number(item.tabata_rounds !== undefined ? item.tabata_rounds : 8),
        intervalSec: Number(item.emom_interval !== undefined ? item.emom_interval : 60),
        rounds: Number(item.emom_rounds !== undefined ? item.emom_rounds : 10),
      };
    }
  });

  const parts = day.parts || [];
  parts.forEach((p, idx) => {
    const pSpec = getPartTimerSpec(p, idx);
    if (pSpec) currentDaySpecs[`part-${idx}`] = pSpec;
    (p.exercises || []).forEach((ex, exIdx) => {
      if (ex.is_timed_section) {
        currentDaySpecs[`part-${idx}-timed-${exIdx}`] = {
          id: `part-${idx}-timed-${exIdx}`,
          label: ex.name || `${ex.timer_type || 'AMRAP'} (${ex.timer_minutes || 10} min)`,
          mode: ex.timer_type || 'AMRAP',
          minutes: Number(ex.timer_minutes) || 10,
          workSec: Number(ex.tabata_work !== undefined ? ex.tabata_work : 20),
          restSec: Number(ex.tabata_rest !== undefined ? ex.tabata_rest : 10),
          tabataRounds: Number(ex.tabata_rounds !== undefined ? ex.tabata_rounds : 8),
          intervalSec: Number(ex.emom_interval !== undefined ? ex.emom_interval : 60),
          rounds: Number(ex.emom_rounds !== undefined ? ex.emom_rounds : 10),
        };
      }
    });
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

  const cleanMcTitleStr = cleanMesocycleTitle(state.microcycle);
  const weekDateRangeStr = formatWeekDateRange(state.microcycle, day.week_number);
  const dateRangeLong = weekDateRangeStr ? ` · SEMANA del ${weekDateRangeStr}` : '';
  const dateRangeShort = weekDateRangeStr ? ` · S. del ${weekDateRangeStr}` : '';

  // Warmup work description line right under WARM UP
  let wuWorkType = '';
  if (wuSpec) {
    if (wuSpec.mode === 'TABATA') {
      wuWorkType = `TABATA (${wuSpec.tabataRounds || 8} rondas · ${wuSpec.workSec || 20}s Trabajo / ${wuSpec.restSec !== undefined ? wuSpec.restSec : 10}s Descanso)`;
    } else if (wuSpec.mode === 'EMOM') {
      wuWorkType = `EMOM (${wuSpec.rounds || 8} rondas · cada ${wuSpec.intervalSec || 60}s)`;
    } else if (wuSpec.mode === 'FOR TIME') {
      wuWorkType = `FOR TIME (Cap: ${wuSpec.minutes || 8} min)`;
    } else {
      wuWorkType = `${esc(wuSpec.mode)} (${wuSpec.minutes || 8} min)`;
    }
  } else {
    wuWorkType = esc(warmupType);
  }

  // WOD Final summary formatting (SOLO ENCABEZADO WOD FINAL, TITULO Y FORMATO, Y CAP SOLO SI EL COACH LO SELECCIONA)
  const rawWodTitle = (wod.title || '').trim();
  let rawWodType = (wod.type || 'WOD').trim();
  const hasTimeCap = wod.has_time_cap !== false && wod.has_time_cap !== 0 && Boolean(wod.time_cap && wod.time_cap.trim());
  const rawWodTimeCap = hasTimeCap ? wod.time_cap.trim() : '';

  let wodHeaderLine = '';
  if (rawWodTitle && rawWodType && rawWodTitle.toLowerCase() !== rawWodType.toLowerCase()) {
    if (rawWodTitle.toLowerCase().includes(rawWodType.toLowerCase())) {
      wodHeaderLine = rawWodTitle;
    } else {
      wodHeaderLine = `${rawWodTitle} · ${rawWodType}`;
    }
  } else {
    wodHeaderLine = rawWodTitle || rawWodType || 'WOD';
  }

  // El CAP solo sale en el encabezado si fue seleccionado por el coach
  if (rawWodTimeCap) {
    const cleanCap = rawWodTimeCap.replace(/^CAP\s*:?\s*/i, '').trim();
    if (!wodHeaderLine.toUpperCase().includes('CAP') && !wodHeaderLine.includes(cleanCap)) {
      wodHeaderLine += ` (CAP: ${cleanCap})`;
    }
  }

  const wodExercises = Array.isArray(wod.exercises) && wod.exercises.length > 0
    ? wod.exercises
    : (Array.isArray(wod.movements) ? wod.movements : []);

  // Limpiar descripciones para que no repitan en la primera línea el título o tipo de WOD
  let wodDescLines = (wod.description || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (wodDescLines.length > 0) {
    const firstLineLow = wodDescLines[0].toLowerCase().replace(/[:\-_*#]/g, '').trim();
    const tLow = rawWodTitle.toLowerCase().replace(/[:\-_*#]/g, '').trim();
    const typeLow = rawWodType.toLowerCase().replace(/[:\-_*#]/g, '').trim();
    if (
      firstLineLow === tLow ||
      firstLineLow === typeLow ||
      (tLow && firstLineLow.startsWith(tLow)) ||
      (typeLow && firstLineLow.startsWith(typeLow)) ||
      (firstLineLow.startsWith('amrap') && wodHeaderLine.toLowerCase().includes('amrap')) ||
      (firstLineLow.startsWith('emom') && wodHeaderLine.toLowerCase().includes('emom')) ||
      (firstLineLow.startsWith('for time') && wodHeaderLine.toLowerCase().includes('for time')) ||
      (firstLineLow.startsWith('tabata') && wodHeaderLine.toLowerCase().includes('tabata'))
    ) {
      wodDescLines.shift();
    }
  }
  const cleanWodDesc = wodDescLines.join('\n');

  let html = `
    <!-- HEADER BLOCK (APPEARS EXACTLY ONCE IN SCREEN AND PDF - MAX 2 CLEAN LINES) -->
    <div class="card card-session-sheet session-header-card">
      <h1 class="session-main-header">
        ${esc(cleanMcTitleStr)}
      </h1>
      <h2 class="session-sub-header">
        <span class="sub-header-desktop">MICROCICLO ${day.week_number} · DÍA ${day.day_number}${esc(dateRangeLong)}</span>
        <span class="sub-header-mobile">MICROCICLO ${day.week_number} · D ${day.day_number}${esc(dateRangeShort)}</span>
      </h2>
      ${day.coaching_tips ? `<div class="session-body-text" style="margin-top:8px; font-size:0.9rem;">💡 <strong>Consejo del Coach:</strong> ${esc(day.coaching_tips)}</div>` : ''}
      <div class="session-header-actions no-print" style="margin-top:10px; display:flex; justify-content:flex-end;">
        <button class="btn btn-sm btn-celeste-matte" id="btnPrintDayPdf" style="display:inline-flex; align-items:center; gap:6px; white-space:nowrap;">
          🖨️ Imprimir / Guardar en PDF
        </button>
      </div>
    </div>

    <!-- 1. WARM UP (BANNER AZUL CON LETRAS NEGRAS, DEBAJO EL TIPO DE TRABAJO EN NEGRO) -->
    <div class="card card-session-sheet">
      <div class="section-badge-banner">WARM UP</div>
      <div class="session-subheading">${wuWorkType}</div>
      ${day.warmup_notes ? `<div class="session-body-text" style="margin-bottom:8px;">${esc(day.warmup_notes)}</div>` : ''}
      ${wu.length === 0 ? '<div class="session-body-text">Sin movimientos listados en el calentamiento.</div>' : `
        <div class="ex-clean-list" id="stuWarmupList"></div>
      `}
      ${wuSpec ? renderCronoProLinkHtml(wuSpec) : ''}
    </div>

    <!-- 2. BLOQUES (BANNER AZUL CON LETRAS NEGRAS, DEBAJO EL TÍTULO DEL BLOQUE EN NEGRO) -->
    ${parts.map((p, idx) => {
      const pSpec = currentDaySpecs[`part-${idx}`];
      const blockTitle = p.title || `Trabajo Bloque ${idx + 1}`;
      const blockSub = `${esc(blockTitle)}${p.type ? ' · ' + esc(p.type) : ''}`;
      return `
        <div class="card card-session-sheet">
          <div class="section-badge-banner">BLOQUE ${idx + 1}</div>
          <div class="session-subheading">${blockSub}</div>
          ${p.description ? `<div class="session-body-text" style="margin-bottom:8px;">${esc(p.description)}</div>` : ''}
          ${(p.exercises || []).length > 0 ? `
            <div class="ex-clean-list stu-part-ex" data-part-idx="${idx}"></div>
          ` : ''}
          ${p.has_score ? `
            <div class="block-score-box no-print" style="margin-top:12px; background:rgba(255,255,255,0.06); border:1.5px dashed rgba(255,255,255,0.3); border-radius:8px; padding:10px 14px;">
              <div style="font-size:0.85rem; font-weight:800; color:#ffffff; text-transform:uppercase; margin-bottom:6px;">
                🏆 Registrar mi resultado en este bloque (${esc(blockTitle)})
              </div>
              <div class="row-wrap" style="gap:8px;">
                <input class="input" style="flex:1; min-width:180px; color:#ffffff; background:#0b111e; border-color:rgba(255,255,255,0.25);" data-block-score-input="${idx}" placeholder="Ej: 5x5 con 100 kg / Carga o marca alcanzada..." />
                <button class="btn btn-primary btn-sm" style="color:#000000; font-weight:800;" data-block-score-btn="${idx}" data-part-title="${esc(blockTitle)}">Guardar Marca</button>
              </div>
              <div data-block-score-status="${idx}" style="font-size:0.82rem; margin-top:4px; color:#ffffff;"></div>
            </div>
          ` : ''}
          ${pSpec ? renderCronoProLinkHtml(pSpec) : ''}
        </div>
      `;
    }).join('')}

    <!-- 3. WOD FINAL (SOLO ENCABEZADO WOD FINAL, TITULO DEL WOD Y TIPO, Y RESUMEN) -->
    <div class="card card-session-sheet">
      <div class="section-badge-banner">WOD FINAL</div>
      <div class="session-subheading" style="font-size:1.05rem; font-weight:800; margin-bottom:6px;">${esc(wodHeaderLine)}</div>
      ${cleanWodDesc ? `<div class="wod-pre-clean">${esc(cleanWodDesc)}</div>` : ''}
      ${wod.rx_weights ? `<div class="session-body-text" style="font-size:0.88rem; margin-top:4px;"><strong>Rx:</strong> ${esc(wod.rx_weights)}</div>` : ''}
      ${wod.scaled_weights ? `<div class="session-body-text" style="font-size:0.88rem; margin-top:2px;"><strong>Escalado:</strong> ${esc(wod.scaled_weights)}</div>` : ''}
      ${wod.strategy ? `<div class="session-body-text" style="font-size:0.88rem; margin-top:4px;"><strong>Estrategia:</strong> ${esc(wod.strategy)}</div>` : ''}
      ${wodExercises.length > 0 ? `
        <div class="ex-clean-list" id="stuWodList" style="margin-top:8px;"></div>
      ` : (!cleanWodDesc ? '<div class="session-body-text">Sin ejercicios ni descripción añadida en el WOD.</div>' : '')}
      ${wodSpec ? renderCronoProLinkHtml(wodSpec) : ''}
    </div>
  `;

  container.innerHTML = html;

  // Control student score logging card visibility & format according to wod.has_score and wod.score_type
  const logCard = $('studentLogCard');
  if (logCard) {
    const wodHasScore = wod && wod.has_score !== false && wod.has_score !== 0 && wod.has_score !== 'false';
    logCard.style.display = wodHasScore ? 'block' : 'none';

    if (wodHasScore) {
      const rawScoreType = (wod.score_type || (wod.type?.includes('TIME') ? 'TIEMPO' : (wod.type?.includes('AMRAP') ? 'RONDAS + REPS' : 'REPS'))).toUpperCase();
      
      const badgeEl = $('logScoreTypeBadge');
      const labelEl = $('logScoreLabel');
      const inputEl = $('logScore');
      const subInfoEl = $('logScoreSubInfo');

      if (badgeEl) badgeEl.textContent = `Métrica: ${rawScoreType}`;

      if (rawScoreType.includes('TIEMPO')) {
        if (labelEl) labelEl.innerHTML = '⏱ Tiempo empleado en terminar el WOD <span style="color:#ffffff; font-weight:800;">(TIEMPO)</span>';
        if (inputEl) inputEl.placeholder = 'Ej: 11:45 (Minutos : Segundos)';
        if (subInfoEl) subInfoEl.textContent = 'Apunta el tiempo exacto que has tardado en completar todo el trabajo.';
      } else if (rawScoreType.includes('RONDAS')) {
        if (labelEl) labelEl.innerHTML = '🔄 Rondas completadas + Reps extras <span style="color:#ffffff; font-weight:800;">(RONDAS + REPS)</span>';
        if (inputEl) inputEl.placeholder = 'Ej: 5 rondas + 12 reps';
        if (subInfoEl) subInfoEl.textContent = 'Apunta las rondas enteras finalizadas y las repeticiones de la ronda en curso.';
      } else if (rawScoreType.includes('REPS')) {
        if (labelEl) labelEl.innerHTML = '🔢 Total de repeticiones conseguidas <span style="color:#ffffff; font-weight:800;">(REPS)</span>';
        if (inputEl) inputEl.placeholder = 'Ej: 145 reps';
        if (subInfoEl) subInfoEl.textContent = 'Apunta la suma total de repeticiones realizadas en el tiempo límite.';
      } else if (rawScoreType.includes('PESO') || rawScoreType.includes('CARGA')) {
        if (labelEl) labelEl.innerHTML = '🏋️ Carga / Peso máximo alcanzado <span style="color:#ffffff; font-weight:800;">(KG)</span>';
        if (inputEl) inputEl.placeholder = 'Ej: 90 kg';
        if (subInfoEl) subInfoEl.textContent = 'Apunta los kilogramos de tu mejor levantamiento o serie final.';
      } else {
        if (labelEl) labelEl.innerHTML = '🏆 Resultado / Marca del WOD';
        if (inputEl) inputEl.placeholder = 'Ej: 4 rondas + 12 reps / 11:45';
        if (subInfoEl) subInfoEl.textContent = 'Introduce tu marca conseguida en la sesión de hoy.';
      }
    }
  }

  // Print Day to PDF handler
  $('btnPrintDayPdf')?.addEventListener('click', () => {
    const prevTitle = document.title;
    const cleanDayTitle = (day.title || `Dia ${day.day_number}`).replace(/[/\\?%*:|"<>]/g, '-');
    document.title = `Microciclo ${day.week_number} - Día ${day.day_number} - ${cleanDayTitle}`;
    window.print();
    setTimeout(() => {
      document.title = prevTitle;
    }, 1500);
  });

  // Función unificada para renderizar listas de ejercicios con la misma estructura (SETS | REPS | MOVE | VIDEO)
  function renderStudentExerciseRows(targetWrap, exercises, prefix = 'ex') {
    if (!targetWrap || !Array.isArray(exercises) || exercises.length === 0) return;
    const hdr = document.createElement('div');
    hdr.className = 'ex-columns-header';
    hdr.innerHTML = `
      <div class="ex-col-cell ex-col-sets">SETS</div>
      <div class="ex-col-cell ex-col-reps">REPS</div>
      <div class="ex-col-name">MOVE</div>
      <div class="ex-col-action no-print">VIDEO</div>
    `;
    targetWrap.appendChild(hdr);

    exercises.forEach((item, itemIdx) => {
      // Bloques con cronómetro incrustados (AMRAP, EMOM, TABATA, FOR TIME)
      if (item.is_timed_section) {
        const timedSpec = {
          id: `${prefix}-timed-${itemIdx}`,
          label: item.name || `${item.timer_type || 'AMRAP'} (${item.timer_minutes || 10} min)`,
          mode: item.timer_type || 'AMRAP',
          minutes: Number(item.timer_minutes) || 10,
          workSec: Number(item.tabata_work !== undefined ? item.tabata_work : 20),
          restSec: Number(item.tabata_rest !== undefined ? item.tabata_rest : 10),
          tabataRounds: Number(item.tabata_rounds !== undefined ? item.tabata_rounds : 8),
          intervalSec: Number(item.emom_interval !== undefined ? item.emom_interval : 60),
          rounds: Number(item.emom_rounds !== undefined ? item.emom_rounds : 10),
        };
        currentDaySpecs[timedSpec.id] = timedSpec;

        const timedBox = document.createElement('div');
        timedBox.className = 'timed-section-student-card';

        let subsHtml = '';
        const subs = Array.isArray(item.sub_exercises) ? item.sub_exercises : [];
        if (subs.length > 0) {
          subsHtml = `
            <div class="ex-columns-header" style="margin-top:8px;">
              <div class="ex-col-cell ex-col-sets">SETS</div>
              <div class="ex-col-cell ex-col-reps">REPS</div>
              <div class="ex-col-name">MOVE</div>
              <div class="ex-col-action no-print">VIDEO</div>
            </div>
            ${subs.map((sub) => {
              const subMeta = [];
              if (sub.load) subMeta.push(`Carga: ${esc(sub.load)}`);
              if (sub.rest) subMeta.push(`Descanso: ${esc(sub.rest)}`);
              const subMetaHtml = subMeta.length > 0 ? `<div class="ex-meta-text">🏋️ ${subMeta.join(' · ')}</div>` : '';
              return `
                <div class="ex-clean-line">
                  <div class="ex-col-cell ex-col-sets">
                    <span class="clean-pill-val">${cleanSetsVal(sub.sets) || '-'}</span>
                  </div>
                  <div class="ex-col-cell ex-col-reps">
                    <span class="clean-pill-val">${esc(sub.reps || '-')}</span>
                  </div>
                  <div class="ex-col-name">
                    <strong>${esc(sub.name)}</strong>
                    ${subMetaHtml}
                    ${sub.notes ? `<div class="ex-notes-text">${esc(sub.notes)}</div>` : ''}
                  </div>
                  <div class="ex-col-action no-print">
                    ${sub.video_url ? `
                      <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(sub.name)}" data-url="${esc(sub.video_url)}" data-notes="${esc(sub.notes || '')}" title="Ver vídeo explicativo">
                        🎬 <span class="video-btn-text">Vídeo</span>
                      </button>
                    ` : '<span style="display:inline-block; width:100%;"></span>'}
                  </div>
                </div>
              `;
            }).join('')}
          `;
        }

        timedBox.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
            <span class="timed-section-student-badge">⏱ ${esc(item.name || item.timer_type || 'AMRAP')}</span>
          </div>
          ${item.notes ? `<div class="session-body-text" style="margin-bottom:8px; font-style:italic;">${esc(item.notes)}</div>` : ''}
          ${subsHtml}
          ${renderCronoProLinkHtml(timedSpec)}
        `;
        targetWrap.appendChild(timedBox);
        return;
      }

      const hasSubs = Array.isArray(item.sub_exercises) && item.sub_exercises.length > 0;
      const meta = [];
      if (item.load) meta.push(`Carga: ${esc(item.load)}`);
      if (item.rest) meta.push(`Descanso: ${esc(item.rest)}`);
      const metaHtml = meta.length > 0 ? `<div class="ex-meta-text">🏋️ ${meta.join(' · ')}</div>` : '';

      if (!hasSubs) {
        const row = document.createElement('div');
        row.className = 'ex-clean-line';
        row.innerHTML = `
          <div class="ex-col-cell ex-col-sets">
            <span class="clean-pill-val">${cleanSetsVal(item.sets) || '-'}</span>
          </div>
          <div class="ex-col-cell ex-col-reps">
            <span class="clean-pill-val">${esc(item.reps || '-')}</span>
          </div>
          <div class="ex-col-name">
            <strong>${esc(item.name)}</strong>
            ${metaHtml}
            ${item.notes ? `<div class="ex-notes-text">${esc(item.notes)}</div>` : ''}
          </div>
          <div class="ex-col-action no-print">
            ${item.video_url ? `
              <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(item.name)}" data-url="${esc(item.video_url)}" data-notes="${esc(item.notes || '')}" title="Ver vídeo explicativo">
                🎬 <span class="video-btn-text">Vídeo</span>
              </button>
            ` : '<span style="display:inline-block; width:100%;"></span>'}
          </div>
        `;
        targetWrap.appendChild(row);
      } else {
        const box = document.createElement('div');
        box.className = 'ex-group-card';
        let subHtml = `
          <div class="ex-clean-line" style="margin-bottom:4px;">
            <div class="ex-col-cell ex-col-sets">
              <span class="clean-pill-val">${cleanSetsVal(item.sets) || '1'}</span>
            </div>
            <div class="ex-col-cell ex-col-reps">
              <span class="clean-pill-val">${esc(item.reps || '-')}</span>
            </div>
            <div class="ex-col-name">
              <strong>${esc(item.name)}</strong>
              ${metaHtml}
              ${item.notes ? `<div class="ex-notes-text">${esc(item.notes)}</div>` : ''}
            </div>
            <div class="ex-col-action no-print">
              ${item.video_url ? `
                <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(item.name)}" data-url="${esc(item.video_url)}" data-notes="${esc(item.notes || '')}" title="Ver vídeo explicativo">
                  🎬 <span class="video-btn-text">Vídeo</span>
                </button>
              ` : '<span style="display:inline-block; width:100%;"></span>'}
            </div>
          </div>
        `;
        item.sub_exercises.forEach((sub, sIdx) => {
          const subMeta = [];
          if (sub.load) subMeta.push(`Carga: ${esc(sub.load)}`);
          if (sub.rest) subMeta.push(`Descanso: ${esc(sub.rest)}`);
          const subMetaHtml = subMeta.length > 0 ? `<div class="ex-meta-text">🏋️ ${subMeta.join(' · ')}</div>` : '';
          subHtml += `
            <div class="ex-clean-line" style="margin-top:4px;">
              <div class="ex-col-cell ex-col-sets">
                <span class="clean-pill-val" style="opacity:0.75;">+ ${sIdx + 2}</span>
              </div>
              <div class="ex-col-cell ex-col-reps">
                <span class="clean-pill-val">${esc(sub.reps || '-')}</span>
              </div>
              <div class="ex-col-name">
                <strong>${esc(sub.name)}</strong>
                ${subMetaHtml}
                ${sub.notes ? `<div class="ex-notes-text">${esc(sub.notes)}</div>` : ''}
              </div>
              <div class="ex-col-action no-print">
                ${sub.video_url ? `
                  <button class="btn-video-sym" type="button" data-video-btn data-name="${esc(sub.name)}" data-url="${esc(sub.video_url)}" data-notes="${esc(sub.notes || '')}" title="Ver vídeo explicativo">
                    🎬 <span class="video-btn-text">Vídeo</span>
                  </button>
                ` : '<span style="display:inline-block; width:100%;"></span>'}
              </div>
            </div>
          `;
        });
        box.innerHTML = subHtml;
        targetWrap.appendChild(box);
      }
    });
  }

  // Populate Warmup clean rows: SETS | REPS | MOVE | VIDEO
  const wuWrap = $('stuWarmupList');
  if (wuWrap) {
    renderStudentExerciseRows(wuWrap, wu, 'wu');
  }

  // 2. Populate Parts clean rows: SETS | REPS | MOVE | VIDEO
  parts.forEach((p, idx) => {
    const pWrap = container.querySelector(`.stu-part-ex[data-part-idx="${idx}"]`);
    if (pWrap) {
      renderStudentExerciseRows(pWrap, p.exercises || [], `part-${idx}`);
    }
  });

  // 3. Populate WOD Final clean rows: SETS | REPS | MOVE | VIDEO
  const wodWrap = $('stuWodList');
  if (wodWrap) {
    renderStudentExerciseRows(wodWrap, wodExercises, 'wod');
  }

  // Fallback: Populate legacy WOD movements videos if no structured exercises
  const wodMovWrap = $('stuWodMovements');
  if (wodMovWrap && wodExercises.length === 0) {
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
        if (status) status.innerHTML = '<span style="color:#ffffff; font-weight:700;">Introduce tu marca antes de guardar.</span>';
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
        if (status) status.innerHTML = '<span style="color:#ffffff; font-weight:800;">✓ ¡Marca registrada con éxito!</span>';
        showToast(`Marca de ${blockLabel} registrada`);
        loadDayLeaderboard();
      } catch (err) {
        if (status) status.innerHTML = `<span style="color:#ffffff; font-weight:700;">Error al guardar: ${esc(err.message)}</span>`;
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
    wrap.innerHTML = '<p class="muted" style="color:#ffffff;">Sé el primero en registrar tu marca hoy.</p>';
    return;
  }
  wrap.innerHTML = '';
  logs.forEach((l) => {
    const isRx = l.rx_status === 'Rx';
    const isScaled = l.rx_status === 'Scaled';
    const rxBadge = isRx
      ? '<span class="badge" style="background:rgba(255,255,255,0.12); color:#ffffff; font-weight:800; border:1px solid rgba(255,255,255,0.35);">⚡ Rx</span>'
      : (isScaled
        ? '<span class="badge" style="background:rgba(255,255,255,0.12); color:#ffffff; font-weight:800; border:1px solid rgba(255,255,255,0.35);">🔄 Scaled</span>'
        : `<span class="badge" style="background:rgba(255,255,255,0.12); color:#ffffff; font-weight:800; border:1px solid rgba(255,255,255,0.35);">${esc(l.rx_status || '')}</span>`);

    const row = document.createElement('div');
    row.className = 'item-box';
    row.innerHTML = `
      <div class="row-between" style="align-items:center;">
        <div>
          <strong style="font-size:0.95rem; color:#ffffff;">${esc(l.student_name)}</strong>
          ${l.notes ? `<div style="font-size:0.82rem; margin-top:2px; color:#ffffff;">${esc(l.notes)}</div>` : ''}
        </div>
        <div class="row-wrap" style="gap:8px; align-items:center;">
          <strong style="font-size:1.05rem; color:#ffffff;">${esc(l.score)}</strong>
          ${rxBadge}
        </div>
      </div>
      ${l.weights_used ? `<div style="font-size:0.82rem; margin-top:4px; color:#ffffff;">Pesos/Adaptaciones: ${esc(l.weights_used)}</div>` : ''}
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
