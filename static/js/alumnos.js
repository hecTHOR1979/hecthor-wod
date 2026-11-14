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
  const email = $('loginEmail').value.trim().toLowerCase();
  const password = $('loginPassword').value;
  $('loginError').textContent = '';
  if (!email || !password) {
    $('loginError').textContent = 'Introduce tu correo y contraseña.';
    return;
  }
  try {
    const res = await api('/api/student/login', {
      method: 'POST',
      token: '',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token, 'student');
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
  if (!t || t.includes('SIN CRONO')) return null;
  if (t.includes('AMRAP')) return 'AMRAP';
  if (t.includes('EMOM') || t.includes('EMON')) return 'EMOM';
  if (t.includes('TABATA')) return 'TABATA';
  if (t.includes('FOR TIME')) return 'FOR TIME';
  return null;
}

function buildExerciseNameHtml(name, videoUrl) {
  if (videoUrl) {
    return `<a href="${esc(videoUrl)}" class="ex-video-link" data-video-link>${esc(name)}</a>`;
  }
  return `<strong>${esc(name)}</strong>`;
}

function buildSectionTimerSpec(label, type, minutes, extraText = '') {
  const rawType = (type || 'AMRAP').toUpperCase();
  const fullText = `${rawType} ${label || ''} ${extraText || ''}`.toUpperCase();
  let mode = 'AMRAP';
  if (rawType.includes('EMOM')) mode = 'EMOM';
  else if (rawType.includes('TABATA')) mode = 'TABATA';
  else if (rawType.includes('TIME') || rawType.includes('CHIPPER')) mode = 'FOR TIME';
  else if (rawType.includes('CRONO') || rawType.includes('FUERZA') || rawType.includes('LIBRE')) mode = 'CRONO';

  let workSec = 20;
  let restSec = 10;
  let tabataRounds = 8;
  let intervalSec = 60;

  if (mode === 'TABATA') {
    const wrMatch = fullText.match(/(\d+)\s*(?:s|seg)?\s*[/x]\s*(\d+)\s*(?:s|seg)?/i);
    if (wrMatch) {
      workSec = Math.max(5, parseInt(wrMatch[1], 10));
      restSec = Math.max(0, parseInt(wrMatch[2], 10));
    }
    const rMatch = fullText.match(/(\d+)\s*(?:rondas|rounds|r\b|intervalos)/i);
    if (rMatch) {
      tabataRounds = Math.max(1, Math.min(50, parseInt(rMatch[1], 10)));
    }
  } else if (mode === 'EMOM') {
    const everyMatch = fullText.match(/(?:cada|every)\s*(\d+)\s*(?:min|minutos|m\b)/i);
    if (everyMatch) intervalSec = Math.max(1, parseInt(everyMatch[1], 10)) * 60;
  }

  return {
    mode,
    minutes: mode === 'TABATA' ? Math.ceil(((workSec + restSec) * tabataRounds) / 60) : Math.max(1, Number(minutes) || 8),
    intervalSec,
    workSec,
    restSec,
    tabataRounds,
    wodTitle: label,
    rawType: type || mode,
  };
}

function renderCurrentDay(resetTimer = true) {
  const day = state.microcycle.days.find((d) => d.id === state.selectedDayId);
  const container = $('dayContent');
  if (!day) {
    container.innerHTML = '<div class="card"><p class="muted">No hay sesión configurada para este día.</p></div>';
    return;
  }

  const warmupType = day.warmup_type || 'Movilidad GROUND';
  const warmupTimer = day.warmup_timer || { type: 'AMRAP', minutes: 8 };
  const wu = day.warmup_exercises || [];

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
  `;

  // 1. WARM UP CARD (Columnar: Rondas | Repes | Ejercicio + Warm Up Timer at bottom)
  const rawWuTimerType = (warmupTimer.type || 'AMRAP').toUpperCase();
  const wuTimerMode = getTimedBlockMode(rawWuTimerType) || (rawWuTimerType.includes('CRONO') && !rawWuTimerType.includes('SIN CRONO') ? 'CRONO' : null);
  html += `
    <div class="card card-block-celeste">
      <div class="section-header">
        <span class="badge badge-celeste-matte">WARM UP · ${esc(warmupType)}</span>
        ${wuTimerMode ? `<span class="badge badge-celeste-matte">${esc(wuTimerMode)} · ${esc(warmupTimer.minutes || 8)} min</span>` : ''}
      </div>
      ${day.warmup_notes ? `<p class="muted" style="margin-top:0;">${esc(day.warmup_notes)}</p>` : ''}
      ${wu.length === 0 ? '<p class="muted">Sin movimientos listados.</p>' : `
        <div class="ex-table">
          <div class="ex-table-head">
            <div>Rondas</div>
            <div>Repes</div>
            <div>Ejercicio</div>
          </div>
          <div id="stuWarmupList"></div>
        </div>
      `}
      ${wuTimerMode ? `
        <div class="section-timer-bar no-print" id="btnWarmupTimerBar" title="Pulsa para iniciar o ampliar en pantalla completa">
          <div>
            <span class="badge badge-celeste-matte">⏱ CRONO WARM UP · ${esc(wuTimerMode)}</span>
            <div class="muted" style="margin-top:4px;">Tiempo designado: <strong>${esc(warmupTimer.minutes || 8)} min</strong> · Toca para abrir crono</div>
          </div>
          <div class="section-timer-readout" id="wuTimerPreview">${renderColoredDigitsHtml((Number(warmupTimer.minutes) || 8) * 60000)}</div>
        </div>
      ` : ''}
    </div>
  `;

  // 2. DAILY BLOCKS (Columnar: Rondas | Repes | Ejercicio + Block Timer ONLY if AMRAP/EMOM/TABATA/FOR TIME)
  const parts = day.parts || [];
  parts.forEach((p, idx) => {
    const blockTimerMode = getTimedBlockMode(p.timer_type !== undefined && p.timer_type !== '' ? p.timer_type : p.type);
    const bMins = p.timer_minutes || 12;
    const blockLabel = `BLOQUE ${idx + 1}`;
    html += `
      <div class="card card-block-celeste">
        <div class="section-header">
          <div>
            <span class="badge badge-celeste-matte">${esc(blockLabel)}${p.type ? ' · ' + esc(p.type) : ''}</span>
            <h3 class="section-title" style="margin-top:6px;">${esc(p.title || `Trabajo ${blockLabel}`)}</h3>
          </div>
          ${blockTimerMode ? `<span class="badge badge-celeste-matte">${esc(blockTimerMode)} · ${esc(bMins)} min</span>` : ''}
        </div>
        ${p.description ? `<p class="muted" style="margin-top:0;">${esc(p.description)}</p>` : ''}
        ${(p.exercises || []).length > 0 ? `
          <div class="ex-table">
            <div class="ex-table-head">
              <div>Rondas</div>
              <div>Repes</div>
              <div>Ejercicio</div>
            </div>
            <div class="stu-part-ex" data-part-idx="${idx}"></div>
          </div>
        ` : ''}
        ${blockTimerMode ? `
          <div class="section-timer-bar no-print" data-block-timer="${idx}" title="Pulsa para iniciar o ampliar en pantalla completa">
            <div>
              <span class="badge badge-celeste-matte">⏱ CRONO ${esc(blockLabel)} · ${esc(blockTimerMode)}</span>
              <div class="muted" style="margin-top:4px;">${esc(p.type || 'Entreno')} · ${esc(bMins)} min · Toca para pantalla completa</div>
            </div>
            <div class="section-timer-readout">${renderColoredDigitsHtml((Number(bMins) || 12) * 60000)}</div>
          </div>
        ` : ''}
      </div>
    `;
  });

  // 3. WOD FINAL
  const wod = day.wod || {};
  const wodMovements = wod.movements || [];
  html += `
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
      ${wodMovements.length > 0 ? `
        <div class="wod-videos-box no-print">
          <div class="muted" style="font-size:0.8rem; font-weight:800; text-transform:uppercase;">🎬 Vídeos de movimientos del WOD</div>
          <div id="stuWodMovements"></div>
        </div>
      ` : ''}
    </div>
  `;

  container.innerHTML = html;

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

  // Populate Warmup columnar rows: Col1 Rondas | Col2 Repes | Col3 Nombre(+video) + explicación debajo
  const wuWrap = $('stuWarmupList');
  if (wuWrap) {
    wu.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'ex-table-row';
      row.innerHTML = `
        <div class="ex-cell-num ex-cell-sets">${esc(item.sets || '-')}</div>
        <div class="ex-cell-num ex-cell-reps">${esc(item.reps || '-')}</div>
        <div class="ex-cell-info">
          ${buildExerciseNameHtml(item.name, item.video_url)}
        </div>
      `;
      const link = row.querySelector('[data-video-link]');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          openVideoModal(item.name, item.video_url, item.notes || item.description || '');
        });
      }
      wuWrap.appendChild(row);
    });
  }

  // Warmup timer click
  if (wuTimerMode) {
    $('btnWarmupTimerBar')?.addEventListener('click', () => {
      const spec = buildSectionTimerSpec(
        `WARM UP · ${warmupType}`,
        wuTimerMode,
        warmupTimer.minutes || 8
      );
      activateTimerSpec(spec, true);
    });
  }

  // Populate Parts columnar rows + Block timers (only when timed mode)
  parts.forEach((p, idx) => {
    const pWrap = container.querySelector(`.stu-part-ex[data-part-idx="${idx}"]`);
    if (pWrap) {
      (p.exercises || []).forEach((ex) => {
        const expParts = [];
        if (ex.load && ex.load !== '-') expParts.push(`Carga: ${ex.load}`);
        if (ex.rest && ex.rest !== '-') expParts.push(`Descanso: ${ex.rest}`);
        const expText = expParts.join(' · ');

        const row = document.createElement('div');
        row.className = 'ex-table-row';
        row.innerHTML = `
          <div class="ex-cell-num ex-cell-sets">${esc(ex.sets || '-')}</div>
          <div class="ex-cell-num ex-cell-reps">${esc(ex.reps || '-')}</div>
          <div class="ex-cell-info">
            ${buildExerciseNameHtml(ex.name, ex.video_url)}
            ${expText ? `<div class="ex-explanation">${esc(expText)}</div>` : ''}
          </div>
        `;
        const link = row.querySelector('[data-video-link]');
        if (link) {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            openVideoModal(ex.name, ex.video_url, ex.notes || ex.description || '');
          });
        }
        pWrap.appendChild(row);
      });
    }

    const blockTimerMode = getTimedBlockMode(p.timer_type !== undefined && p.timer_type !== '' ? p.timer_type : p.type);
    if (blockTimerMode) {
      container.querySelector(`[data-block-timer="${idx}"]`)?.addEventListener('click', () => {
        const spec = buildSectionTimerSpec(
          `${p.part_label || `Bloque ${idx + 1}`}: ${p.title || p.type || ''}`,
          blockTimerMode,
          p.timer_minutes || 12
        );
        activateTimerSpec(spec, true);
      });
    }
  });

  // Populate WOD movements videos
  const wodMovWrap = $('stuWodMovements');
  if (wodMovWrap) {
    wodMovements.forEach((m) => {
      const box = document.createElement('div');
      box.className = 'wod-video-item';
      box.innerHTML = `
        ${buildExerciseNameHtml(m.name || 'Movimiento', m.video_url)}
      `;
      const link = box.querySelector('[data-video-link]');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          openVideoModal(m.name || 'Movimiento WOD', m.video_url, m.notes || m.description || '');
        });
      }
      wodMovWrap.appendChild(box);
    });
  }

  if (resetTimer) {
    configureTimerForWod(wod);
  }
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
  const minutes = minMatch ? Math.max(1, Math.min(90, parseInt(minMatch[1], 10))) : 12;

  let mode = 'AMRAP';
  if (rawType.includes('EMOM')) mode = 'EMOM';
  else if (rawType.includes('TABATA')) mode = 'TABATA';
  else if (rawType.includes('TIME') || rawType.includes('CHIPPER') || rawType.includes('RFT')) mode = 'FOR TIME';
  else if (rawType.includes('AMRAP')) mode = 'AMRAP';
  else if (capStr.toUpperCase().includes('EMOM')) mode = 'EMOM';
  else if (capStr.toUpperCase().includes('TABATA')) mode = 'TABATA';
  else if (capStr.toUpperCase().includes('FOR TIME')) mode = 'FOR TIME';

  let intervalSec = 60;
  let workSec = 20;
  let restSec = 10;
  let tabataRounds = 8;

  if (mode === 'TABATA') {
    const wrMatch = capStr.match(/(\d+)\s*(?:s|seg)?\s*[/x]\s*(\d+)\s*(?:s|seg)?/i);
    if (wrMatch) {
      workSec = Math.max(5, parseInt(wrMatch[1], 10));
      restSec = Math.max(0, parseInt(wrMatch[2], 10));
    }
    const rMatch = capStr.match(/(\d+)\s*(?:rondas|rounds|r\b|intervalos)/i);
    if (rMatch) {
      tabataRounds = Math.max(1, Math.min(50, parseInt(rMatch[1], 10)));
    }
  } else if (mode === 'EMOM') {
    const everyMatch = capStr.match(/(?:cada|every)\s*(\d+)\s*(?:min|minutos|m\b)/i);
    if (everyMatch) intervalSec = Math.max(1, parseInt(everyMatch[1], 10)) * 60;
  }

  return {
    mode,
    minutes: mode === 'TABATA' ? Math.ceil(((workSec + restSec) * tabataRounds) / 60) : minutes,
    intervalSec,
    workSec,
    restSec,
    tabataRounds,
    wodTitle: wod?.title || 'WOD del día',
  };
}

function configureTimerForWod(wod) {
  const spec = parseWodSpec(wod);
  activateTimerSpec(spec, false);
}

function updateTabataSummary() {
  const sumEl = $('tabataSummaryText');
  if (!sumEl) return;
  const cycleSec = (timerState.workSec || 20) + (timerState.restSec !== undefined ? timerState.restSec : 10);
  const totalSec = cycleSec * (timerState.tabataRounds || 8);
  const totalM = Math.floor(totalSec / 60);
  const totalS = totalSec % 60;
  const timeStr = totalS > 0 ? `${totalM}m ${totalS}s` : `${totalM} min`;
  sumEl.textContent = `⚡ ${timerState.tabataRounds || 8} rondas de ${timerState.workSec || 20}s Trabajo / ${timerState.restSec !== undefined ? timerState.restSec : 10}s Descanso (Total: ${timeStr})`;
}

function updateEmomSummary() {
  const sumEl = $('emomSummaryText');
  if (!sumEl) return;
  const rounds = Number($('emomRounds')?.value) || 10;
  const intSec = timerState.intervalSec || 60;
  const totalSec = intSec * rounds;
  const totalM = Math.round(totalSec / 60);
  sumEl.textContent = `⚡ Cada ${intSec}s durante ${rounds} intervalos (Total: ${totalM} min)`;
}

function syncTimerInputsFromState() {
  document.querySelectorAll('.timer-mode-pill').forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.mode === timerState.mode);
  });

  $('cfgTabata')?.classList.toggle('hidden', timerState.mode !== 'TABATA');
  $('cfgEmom')?.classList.toggle('hidden', timerState.mode !== 'EMOM');
  $('cfgAmrap')?.classList.toggle('hidden', timerState.mode !== 'AMRAP');
  $('cfgForTime')?.classList.toggle('hidden', timerState.mode !== 'FOR TIME');
  $('cfgCrono')?.classList.toggle('hidden', timerState.mode !== 'CRONO');

  if ($('tabataWorkSec')) $('tabataWorkSec').value = timerState.workSec || 20;
  if ($('tabataRestSec')) $('tabataRestSec').value = timerState.restSec !== undefined ? timerState.restSec : 10;
  if ($('tabataRounds')) $('tabataRounds').value = timerState.tabataRounds || 8;
  updateTabataSummary();

  if ($('emomIntervalSec')) $('emomIntervalSec').value = String(timerState.intervalSec || 60);
  if ($('emomRounds')) {
    const intSec = timerState.intervalSec || 60;
    $('emomRounds').value = Math.max(1, Math.round(((timerState.totalMinutes || 10) * 60) / intSec));
  }
  updateEmomSummary();

  if ($('amrapMinutes')) $('amrapMinutes').value = timerState.totalMinutes || 12;
  if ($('forTimeCap')) $('forTimeCap').value = timerState.totalMinutes || 15;
  if ($('timerModeSelect')) $('timerModeSelect').value = timerState.mode;
  if ($('timerMinutes')) $('timerMinutes').value = timerState.totalMinutes || 12;
}

function setTimerMode(mode) {
  stopTimer();
  timerState.mode = mode;
  if (mode === 'TABATA') {
    timerState.workSec = Number($('tabataWorkSec')?.value) || 20;
    timerState.restSec = Number($('tabataRestSec')?.value) || 10;
    timerState.tabataRounds = Number($('tabataRounds')?.value) || 8;
    timerState.totalMinutes = Math.ceil(((timerState.workSec + timerState.restSec) * timerState.tabataRounds) / 60);
  } else if (mode === 'EMOM') {
    timerState.intervalSec = Number($('emomIntervalSec')?.value) || 60;
    const rounds = Number($('emomRounds')?.value) || 10;
    timerState.totalMinutes = Math.round((timerState.intervalSec * rounds) / 60);
  } else if (mode === 'AMRAP') {
    timerState.totalMinutes = Number($('amrapMinutes')?.value) || 12;
  } else if (mode === 'FOR TIME') {
    timerState.totalMinutes = Number($('forTimeCap')?.value) || 15;
  }
  syncTimerInputsFromState();
  resetTimerState();
}

function applyTimerPreset(presetKey) {
  stopTimer();
  if (presetKey === 'tabata') {
    timerState.mode = 'TABATA';
    timerState.workSec = 20;
    timerState.restSec = 10;
    timerState.tabataRounds = 8;
    timerState.totalMinutes = 4;
    timerState.wodTitle = 'Tabata Clásico';
  } else if (presetKey === 'emom10') {
    timerState.mode = 'EMOM';
    timerState.intervalSec = 60;
    timerState.totalMinutes = 10;
    timerState.wodTitle = 'EMOM 10 Minutos';
  } else if (presetKey === 'amrap12') {
    timerState.mode = 'AMRAP';
    timerState.totalMinutes = 12;
    timerState.wodTitle = 'AMRAP 12 Minutos';
  } else if (presetKey === 'amrap15') {
    timerState.mode = 'AMRAP';
    timerState.totalMinutes = 15;
    timerState.wodTitle = 'AMRAP 15 Minutos';
  } else if (presetKey === 'fortime15') {
    timerState.mode = 'FOR TIME';
    timerState.totalMinutes = 15;
    timerState.wodTitle = 'For Time (Cap 15\')';
  }
  syncTimerInputsFromState();
  resetTimerState();
}

function activateTimerSpec(spec, openFullscreen = false) {
  stopTimer();
  timerState.mode = spec.mode || 'AMRAP';
  timerState.totalMinutes = spec.minutes || 12;
  timerState.intervalSec = spec.intervalSec || 60;
  if (spec.workSec !== undefined) timerState.workSec = spec.workSec;
  if (spec.restSec !== undefined) timerState.restSec = spec.restSec;
  if (spec.tabataRounds !== undefined) timerState.tabataRounds = spec.tabataRounds;
  timerState.wodTitle = spec.wodTitle || 'Cronómetro';

  syncTimerInputsFromState();
  resetTimerState();
  if (openFullscreen) {
    openFsClock(false);
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

  if (timerState.preCounting) {
    const secsLeft = Math.ceil(timerState.preCountMs / 1000);
    badgeTxt = `⏳ PREPARADOS · ${mode}`;
    intervalTxt = `EMPEZAMOS EN ${secsLeft}...`;
    statusClass = 'status-prep';
    $('timerDisplay').innerHTML = `<span class="fs-clock-precount" style="font-size:2.8rem;">${secsLeft}</span>`;
    $('fsClockDigits').innerHTML = `<span class="fs-clock-precount">${secsLeft}</span>`;
  } else {
    const digitsHtml = renderColoredDigitsHtml(timerState.displayMs);
    $('timerDisplay').innerHTML = digitsHtml;
    $('fsClockDigits').innerHTML = digitsHtml;

    if (mode === 'AMRAP') {
      badgeTxt = '⏱ AMRAP';
      intervalTxt = `Cap: ${timerState.totalMinutes}:00`;
    } else if (mode === 'EMOM') {
      const totalIntervals = Math.max(1, Math.round(((timerState.totalMinutes || 10) * 60) / (timerState.intervalSec || 60)));
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
      } else if (isWork) {
        intervalTxt = `🟢 TRABAJO (${phaseSecLeft}s) · Ronda ${roundIdx} de ${timerState.tabataRounds || 8}`;
        statusClass = 'status-work';
      } else {
        intervalTxt = `🔴 DESCANSO (${phaseSecLeft}s) · Ronda ${roundIdx} de ${timerState.tabataRounds || 8}`;
        statusClass = 'status-rest';
      }
    } else if (mode === 'FOR TIME') {
      badgeTxt = '⏱ FOR TIME';
      intervalTxt = `Cap ${String(timerState.totalMinutes || 15).padStart(2, '0')}:00`;
    } else {
      badgeTxt = '⏱ CRONO LIBRE';
      intervalTxt = '';
    }
  }

  $('timerWodBadge').textContent = badgeTxt;
  $('fsClockBadge').textContent = badgeTxt;
  $('timerWodTitle').textContent = timerState.wodTitle;
  $('fsClockTitle').textContent = timerState.wodTitle;

  const stLine = $('timerStatusLine');
  stLine.className = statusClass || '';
  stLine.textContent = intervalTxt || (timerState.rounds > 0 ? `Rondas: ${timerState.rounds}` : '');

  const fsSt = $('fsClockStatus');
  fsSt.className = statusClass || '';
  fsSt.textContent = intervalTxt || '';

  $('btnTimerAddRound').textContent = `+1 Ronda (${timerState.rounds})`;
  $('fsRoundsDisplay').textContent = mode === 'TABATA'
    ? `Ronda ${Math.min(timerState.tabataRounds || 8, Math.floor(timerState.elapsedMs / ((((timerState.workSec || 20) + (timerState.restSec !== undefined ? timerState.restSec : 10))) * 1000)) + 1)} de ${timerState.tabataRounds || 8}`
    : `Rondas: ${timerState.rounds}`;

  const isActive = timerState.running || timerState.preCounting;
  const fsPauseBtn = $('fsBtnTogglePause');
  if (fsPauseBtn) {
    fsPauseBtn.textContent = isActive ? '⏸' : '▶';
    fsPauseBtn.setAttribute('aria-label', isActive ? 'Pausar' : 'Iniciar');
  }

  const showFinish = mode === 'FOR TIME' || mode === 'CRONO';
  $('btnTimerFinish').classList.toggle('hidden', !showFinish);
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
      $('logScore').value = `${timerState.rounds} rondas`;
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
      $('logScore').value = `Time Cap (${String(timerState.totalMinutes || 15).padStart(2, '0')}:00)`;
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
  $('logScore').value = t;
  renderTimerUI();
  showToast(`🏁 Tiempo registrado: ${t}`);
}

function addRound(delta) {
  timerState.rounds = Math.max(0, timerState.rounds + delta);
  if (delta > 0) playTone('tick');
  $('logScore').value = `${timerState.rounds} rondas`;
  renderTimerUI();
}

// ================= FULLSCREEN GYM CLOCK =================
function openFsClock() {
  const overlay = $('fsClockOverlay');
  if (overlay) {
    overlay.classList.add('open');
  }
  renderTimerUI();
}

function closeFsClock() {
  const overlay = $('fsClockOverlay');
  if (overlay) {
    overlay.classList.remove('open');
  }
}

// When resizing / rotating, refresh digits rendering smoothly without system alerts
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

// Close button on fullscreen clock
$('btnCloseFsClock')?.addEventListener('click', closeFsClock);

// Tap inline clock or "Ampliar" -> open fullscreen clock
$('timerDisplay')?.addEventListener('click', openFsClock);
$('btnOpenFsClock')?.addEventListener('click', openFsClock);

// Fullscreen controls: ONLY "-" (left), "⏸/▶" (center), "+" (right)
$('fsBtnTogglePause').addEventListener('click', () => {
  if (timerState.running || timerState.preCounting) {
    stopTimer();
    renderTimerUI();
  } else {
    startTimer();
  }
});
$('fsBtnAddRound').addEventListener('click', () => addRound(1));
$('fsBtnSubRound').addEventListener('click', () => addRound(-1));

// Inline controls (configured before entering fullscreen)
$('btnTimerStart').addEventListener('click', startTimer);
$('btnTimerPause').addEventListener('click', () => { stopTimer(); renderTimerUI(); });
$('btnTimerReset').addEventListener('click', resetTimerState);
$('btnTimerFinish').addEventListener('click', finishTimer);
$('btnTimerAddRound').addEventListener('click', () => addRound(1));

$('timerSoundSelect').addEventListener('change', (e) => {
  timerState.soundStyle = e.target.value;
  playTone('tick');
});

$('timerPrecountSelect').addEventListener('change', (e) => {
  timerState.preCountSeconds = Number(e.target.value);
});

// Mode selector pill bar
document.querySelectorAll('.timer-mode-pill').forEach((pill) => {
  pill.addEventListener('click', () => {
    setTimerMode(pill.dataset.mode);
  });
});

// Quick presets
document.querySelectorAll('.timer-preset-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    applyTimerPreset(chip.dataset.preset);
  });
});

// Crono Crossfit Pro Modal controls
$('btnLaunchCronoPro')?.addEventListener('click', () => {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  if (modal && iframe) {
    iframe.src = '/crono/';
    modal.classList.add('open');
  }
});
$('btnCloseCronoPro')?.addEventListener('click', () => {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  if (modal && iframe) {
    modal.classList.remove('open');
    iframe.src = 'about:blank';
  }
});

// Tabata helper to set and refresh config
function setTabataConfig(work, rest, rounds) {
  stopTimer();
  if (work !== undefined) timerState.workSec = Math.max(5, Math.min(300, work));
  if (rest !== undefined) timerState.restSec = Math.max(0, Math.min(300, rest));
  if (rounds !== undefined) timerState.tabataRounds = Math.max(1, Math.min(50, rounds));
  timerState.totalMinutes = Math.ceil(((timerState.workSec + timerState.restSec) * timerState.tabataRounds) / 60);
  if ($('tabataWorkSec')) $('tabataWorkSec').value = timerState.workSec;
  if ($('tabataRestSec')) $('tabataRestSec').value = timerState.restSec;
  if ($('tabataRounds')) $('tabataRounds').value = timerState.tabataRounds;
  updateTabataSummary();
  resetTimerState();
}

// Tabata steppers
$('btnDecWork')?.addEventListener('click', () => {
  const current = Number($('tabataWorkSec')?.value) || timerState.workSec || 20;
  setTabataConfig(Math.max(5, current - 5), undefined, undefined);
});
$('btnIncWork')?.addEventListener('click', () => {
  const current = Number($('tabataWorkSec')?.value) || timerState.workSec || 20;
  setTabataConfig(current + 5, undefined, undefined);
});
$('btnDecRest')?.addEventListener('click', () => {
  const current = Number($('tabataRestSec')?.value) || (timerState.restSec !== undefined ? timerState.restSec : 10);
  setTabataConfig(undefined, Math.max(0, current - 5), undefined);
});
$('btnIncRest')?.addEventListener('click', () => {
  const current = Number($('tabataRestSec')?.value) || (timerState.restSec !== undefined ? timerState.restSec : 10);
  setTabataConfig(undefined, current + 5, undefined);
});
$('btnDecRounds')?.addEventListener('click', () => {
  const current = Number($('tabataRounds')?.value) || timerState.tabataRounds || 8;
  setTabataConfig(undefined, undefined, Math.max(1, current - 1));
});
$('btnIncRounds')?.addEventListener('click', () => {
  const current = Number($('tabataRounds')?.value) || timerState.tabataRounds || 8;
  setTabataConfig(undefined, undefined, Math.min(50, current + 1));
});

// Quick Tabata presets (chips)
document.querySelectorAll('.tabata-quick-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const w = Number(chip.dataset.work) || 20;
    const r = Number(chip.dataset.rest) !== undefined ? Number(chip.dataset.rest) : 10;
    const rounds = Number(chip.dataset.rounds) || 8;
    setTabataConfig(w, r, rounds);
  });
});

// Tabata manual inputs (change and input)
$('tabataWorkSec')?.addEventListener('change', (e) => {
  const val = Number(e.target.value);
  if (!isNaN(val) && val >= 5) setTabataConfig(val, undefined, undefined);
});
$('tabataRestSec')?.addEventListener('change', (e) => {
  const val = Number(e.target.value);
  if (!isNaN(val) && val >= 0) setTabataConfig(undefined, val, undefined);
});
$('tabataRounds')?.addEventListener('change', (e) => {
  const val = Number(e.target.value);
  if (!isNaN(val) && val >= 1) setTabataConfig(undefined, undefined, val);
});

// EMOM manual inputs
$('emomIntervalSec')?.addEventListener('change', (e) => {
  timerState.intervalSec = Number(e.target.value) || 60;
  const rounds = Number($('emomRounds')?.value) || 10;
  timerState.totalMinutes = Math.round((timerState.intervalSec * rounds) / 60);
  updateEmomSummary();
  resetTimerState();
});
$('emomRounds')?.addEventListener('input', (e) => {
  const rounds = Math.max(1, Number(e.target.value) || 10);
  timerState.totalMinutes = Math.round(((timerState.intervalSec || 60) * rounds) / 60);
  updateEmomSummary();
  resetTimerState();
});

// AMRAP manual inputs
$('amrapMinutes')?.addEventListener('input', (e) => {
  timerState.totalMinutes = Math.max(1, Math.min(90, Number(e.target.value) || 12));
  resetTimerState();
});
document.querySelectorAll('[data-set-amrap]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mins = Number(btn.dataset.setAmrap) || 12;
    if ($('amrapMinutes')) $('amrapMinutes').value = mins;
    timerState.totalMinutes = mins;
    resetTimerState();
  });
});

// FOR TIME manual inputs
$('forTimeCap')?.addEventListener('input', (e) => {
  timerState.totalMinutes = Math.max(1, Math.min(90, Number(e.target.value) || 15));
  resetTimerState();
});
document.querySelectorAll('[data-set-cap]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mins = Number(btn.dataset.setCap) || 15;
    if ($('forTimeCap')) $('forTimeCap').value = mins;
    timerState.totalMinutes = mins;
    resetTimerState();
  });
});

$('timerModeSelect').addEventListener('change', (e) => {
  setTimerMode(e.target.value);
});
$('timerMinutes').addEventListener('change', (e) => {
  timerState.totalMinutes = Math.max(1, Math.min(90, Number(e.target.value) || 12));
  resetTimerState();
});

// Auto-resume saved student session if valid & approved
async function restoreStudentSession() {
  const savedName = localStorage.getItem('crossfit_student_name');
  if (savedName) $('logName').value = savedName;

  const tok = getAuthToken('student');
  if (!tok) return;
  try {
    const res = await api('/api/student/me');
    const urlCode = new URLSearchParams(location.search).get('code') || '';
    const stu = res.actor?.role === 'student' ? res.actor : { full_name: 'Entrenador' };
    openStudentDashboard(stu, res.microcycles, urlCode);
  } catch {
    clearAuthToken('student');
  }
}

restoreStudentSession();
syncTimerInputsFromState();
renderTimerUI();
