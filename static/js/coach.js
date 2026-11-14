import { esc, api, showToast, openVideoModal, closeVideoModal, registerPwa, getAuthToken, setAuthToken, clearAuthToken, getDefaultMondayIso, formatWeekLabel } from './common.js';

registerPwa();

const EQUIPMENT_LIST = [
  'Barra olímpica', 'Discos', 'Mancuernas', 'Kettlebells',
  'Barra de dominadas', 'Cajón', 'Remo', 'EcoBike',
  'Balón medicinal', 'Wall Ball', 'Sled', 'Rope', 'Ski Erg', 'Bike Erg', 'Yoke', 'Farmers',
  'Anillas', 'Comba / Cuerda', 'Sin material'
];

const state = {
  coachConfigured: true,
  students: [],
  microcycles: [],
  currentMicrocycle: null,
  selectedWeek: 1,
  currentDay: null,
  exercises: [],
  warmupTypes: [],
  selectedEquipment: new Set(['Barra olímpica', 'Discos', 'Cajón', 'Sin material']),
  pickerTarget: null, // { type: 'warmup' } | { type: 'part', partIdx: number } | { type: 'wod' }
  pickerGroundOnly: false,
  qrMode: 'student',
  serverInfo: null,
};

const $ = (id) => document.getElementById(id);

function openModal(id) {
  $(id)?.classList.add('open');
}
function closeModal(id) {
  $(id)?.classList.remove('open');
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
$('btnCloseVideo').addEventListener('click', closeVideoModal);
$('btnCloseVideoBottom').addEventListener('click', closeVideoModal);
$('videoModal').addEventListener('click', (e) => {
  if (e.target.id === 'videoModal') closeVideoModal();
});

// Tabs
document.querySelectorAll('[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('active-tab'));
    btn.classList.add('active-tab');
    ['planner', 'library', 'students', 'logs'].forEach((t) => {
      $(`tab-${t}`).classList.toggle('hidden', t !== btn.dataset.tab);
    });
    if (btn.dataset.tab === 'library') renderLibrary();
    if (btn.dataset.tab === 'students') loadStudents();
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

// ================= COACH AUTHENTICATION =================
function showCoachLoginScreen(status) {
  state.coachConfigured = Boolean(status.coach_configured);
  $('coachAppContent').classList.add('hidden');
  $('coachNavPills').classList.add('hidden');
  $('coachAuthSection').classList.remove('hidden');
  $('coachAuthError').textContent = '';

  if (status.coach_username) {
    $('coachAuthUser').value = status.coach_username;
  }

  if (!state.coachConfigured) {
    $('coachAuthBadge').textContent = 'PRIMER ARRANQUE · CONFIGURACIÓN SEGURA';
    $('coachAuthTitle').textContent = 'Crea tu contraseña privada de Entrenador';
    $('coachAuthDesc').textContent = 'Nadie podrá entrar al panel de edición ni aprobar alumnos sin esta contraseña.';
    $('coachAuthConfirmWrap').classList.remove('hidden');
    $('btnCoachAuthSubmit').textContent = 'Guardar clave y Entrar';
  } else {
    $('coachAuthBadge').textContent = 'ACCESO PRIVADO DEL ENTRENADOR';
    $('coachAuthTitle').textContent = 'Iniciar sesión';
    $('coachAuthDesc').textContent = 'Introduce tu contraseña privada para gestionar entrenamientos y aprobar alumnos.';
    $('coachAuthConfirmWrap').classList.add('hidden');
    $('btnCoachAuthSubmit').textContent = 'Entrar al Panel';
  }
}

async function submitCoachAuth() {
  const username = $('coachAuthUser').value.trim() || 'coach';
  const password = $('coachAuthPass').value;
  $('coachAuthError').textContent = '';

  if (!password || password.length < 4) {
    $('coachAuthError').textContent = 'La contraseña debe tener al menos 4 caracteres.';
    return;
  }

  if (!state.coachConfigured) {
    const confirmPw = $('coachAuthPassConfirm').value;
    if (password !== confirmPw) {
      $('coachAuthError').textContent = 'Las contraseñas no coinciden.';
      return;
    }
  }

  try {
    const endpoint = state.coachConfigured ? '/api/auth/coach/login' : '/api/auth/coach/setup';
    const res = await api(endpoint, {
      method: 'POST',
      token: '',
      body: JSON.stringify({ username, password }),
    });
    setAuthToken(res.token, 'coach');
    $('coachAuthPass').value = '';
    $('coachAuthPassConfirm').value = '';
    $('coachAuthSection').classList.add('hidden');
    $('coachNavPills').classList.remove('hidden');
    $('coachAppContent').classList.remove('hidden');
    await init();
  } catch (err) {
    $('coachAuthError').textContent = err.message;
  }
}

$('btnCoachAuthSubmit').addEventListener('click', submitCoachAuth);
$('coachAuthPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.coachConfigured) submitCoachAuth();
});
$('coachAuthPassConfirm').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitCoachAuth();
});

$('btnCoachLogout').addEventListener('click', async () => {
  clearAuthToken('coach');
  const status = await api('/api/auth/status', { token: '' }).catch(() => ({ coach_configured: true }));
  showCoachLoginScreen(status);
});

$('btnCoachChangePw').addEventListener('click', () => {
  $('curCoachPw').value = '';
  $('newCoachPw').value = '';
  openModal('coachPwModal');
});

$('btnSaveCoachPw').addEventListener('click', async () => {
  const current_password = $('curCoachPw').value;
  const new_password = $('newCoachPw').value;
  if (!current_password || new_password.length < 4) {
    return showToast('Introduce tu clave actual y la nueva (mín. 4 caracteres)');
  }
  try {
    const res = await api('/api/auth/coach/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password, new_password }),
    });
    if (res.token) setAuthToken(res.token, 'coach');
    closeModal('coachPwModal');
    showToast('Contraseña actualizada');
  } catch (err) {
    showToast(err.message);
  }
});

// Init
async function checkAuthAndBoot() {
  try {
    const status = await api('/api/auth/status');
    if (status.actor?.role === 'coach') {
      $('coachAuthSection').classList.add('hidden');
      $('coachNavPills').classList.remove('hidden');
      $('coachAppContent').classList.remove('hidden');
      await init();
    } else {
      clearAuthToken('coach');
      showCoachLoginScreen(status);
    }
  } catch {
    showCoachLoginScreen({ coach_configured: true, coach_username: 'coach' });
  }
}

async function init() {
  loadCustomGoals();
  loadCustomWodTypes();
  loadCustomWodGoals();
  renderEquipmentChips();
  await Promise.all([loadExercises(), loadWarmupTypes(), loadMicrocycles(), loadServerInfo(), loadStudents()]);
}

async function loadWarmupTypes(selectedName = null) {
  try {
    state.warmupTypes = await api('/api/warmup-types');
  } catch {
    state.warmupTypes = [
      { id: 1, name: 'Movilidad GROUND' },
      { id: 2, name: 'Calentamiento General' },
    ];
  }
  renderWarmupTypeSelect(selectedName);
}

function renderWarmupTypeSelect(selectedName = null) {
  const sel = $('warmupTypeSelect');
  if (!sel) return;
  const current = selectedName || sel.value || state.currentDay?.warmup_type || 'Movilidad GROUND';
  sel.innerHTML = '';
  const names = state.warmupTypes.map((t) => t.name);
  if (current && !names.includes(current) && current !== '__new__') names.push(current);
  names.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
  const addOpt = document.createElement('option');
  addOpt.value = '__new__';
  addOpt.textContent = '+ Añadir nuevo tipo...';
  sel.appendChild(addOpt);

  sel.value = current;
  $('warmupTypeHeaderBadge').textContent = current === '__new__' ? 'Movilidad' : current;
}

$('warmupTypeSelect').addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newWarmupTypeBox').classList.remove('hidden');
    $('newWarmupTypeInput').focus();
    return;
  }
  $('newWarmupTypeBox').classList.add('hidden');
  $('warmupTypeHeaderBadge').textContent = e.target.value;
  if (state.currentDay) state.currentDay.warmup_type = e.target.value;
});

$('btnToggleNewWarmupType').addEventListener('click', () => {
  $('newWarmupTypeBox').classList.toggle('hidden');
  if (!$('newWarmupTypeBox').classList.contains('hidden')) {
    $('newWarmupTypeInput').focus();
  }
});

$('newWarmupTypeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('btnSaveWarmupType').click();
  }
});

$('btnSaveWarmupType').addEventListener('click', async () => {
  const name = $('newWarmupTypeInput').value.trim();
  if (!name) return showToast('Escribe el nombre del tipo de Warm Up');
  try {
    await api('/api/warmup-types', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    $('newWarmupTypeInput').value = '';
    $('newWarmupTypeBox').classList.add('hidden');
    await loadWarmupTypes(name);
    if (state.currentDay) state.currentDay.warmup_type = name;
    showToast(`Tipo "${name}" añadido`);
  } catch (err) {
    showToast(err.message);
  }
});

async function loadServerInfo() {
  try {
    state.serverInfo = await api('/api/server-info');
  } catch {
    state.serverInfo = { coach_url: location.origin + '/', student_url: location.origin + '/alumnos' };
  }
}

async function loadExercises() {
  state.exercises = await api('/api/exercises');
}

async function loadMicrocycles(selectId = null) {
  state.microcycles = await api('/api/microcycles');
  const sel = $('microcycleSelect');
  sel.innerHTML = '';
  if (state.microcycles.length === 0) {
    sel.innerHTML = '<option value="">Sin mesociclos (crea uno nuevo)</option>';
    state.currentMicrocycle = null;
    $('microcycleMeta').innerHTML = '';
    if ($('coachWeekSelect')) $('coachWeekSelect').innerHTML = '';
    $('daysGrid').innerHTML = '<p class="muted">Pulsa "+ Nuevo Mesociclo" para empezar.</p>';
    $('dayEditorCard').classList.add('hidden');
    return;
  }
  state.microcycles.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.weeks_count || 4} sem · ${m.days_per_week || 5} días/sem · Código: ${m.access_code})`;
    sel.appendChild(opt);
  });
  const targetId = selectId || state.microcycles[0].id;
  sel.value = String(targetId);
  await selectMicrocycle(targetId);
}

$('microcycleSelect').addEventListener('change', (e) => {
  if (e.target.value) selectMicrocycle(Number(e.target.value));
});

async function selectMicrocycle(id) {
  const mc = await api(`/api/microcycles/${id}`);
  state.currentMicrocycle = mc;
  state.selectedWeek = 1;
  renderMicrocycleMeta();
  renderWeekSelect();
  renderDaysGrid();
  if (mc.days && mc.days.length > 0) {
    openDayEditor(mc.days[0].id);
  } else {
    $('dayEditorCard').classList.add('hidden');
  }
}

function renderMicrocycleMeta() {
  const mc = state.currentMicrocycle;
  if (!mc) return;
  const startVal = (mc.start_date || '').trim() || getDefaultMondayIso(mc.created_at || '');
  $('microcycleMeta').innerHTML = `
    <span class="badge badge-accent">Objetivo: ${esc(mc.primary_goal)}</span>
    <span class="badge">${mc.weeks_count} Semanas · ${mc.days_per_week} días/sem</span>
    <span class="badge badge-blue">Código: <strong>${esc(mc.access_code)}</strong></span>
    <label class="row-wrap" style="gap:6px; font-size:0.82rem; color:var(--text-muted);">
      Inicio Sem. 1:
      <input id="editMcStartDate" type="date" class="input" style="width:auto; padding:4px 8px; font-size:0.82rem;" value="${esc(startVal)}" />
    </label>
    ${mc.description ? `<span class="muted">${esc(mc.description)}</span>` : ''}
  `;
  $('editMcStartDate')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (!val) return;
    try {
      await api(`/api/microcycles/${mc.id}`, {
        method: 'PUT',
        body: JSON.stringify({ start_date: val }),
      });
      mc.start_date = val;
      renderWeekSelect();
      if (state.currentDay) {
        $('editorDayBadge').textContent = `MICROCICLO ${state.currentDay.week_number} · Día ${state.currentDay.day_number}`;
      }
      showToast('Fecha de inicio actualizada');
    } catch (err) {
      showToast(err.message);
    }
  });
}

function renderWeekSelect() {
  const mc = state.currentMicrocycle;
  const sel = $('coachWeekSelect');
  if (!sel || !mc) return;
  sel.innerHTML = '';
  for (let w = 1; w <= mc.weeks_count; w++) {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = formatWeekLabel(mc, w);
    if (w === state.selectedWeek) opt.selected = true;
    sel.appendChild(opt);
  }
}

$('coachWeekSelect')?.addEventListener('change', (e) => {
  state.selectedWeek = Number(e.target.value);
  renderDaysGrid();
  const weekDays = (state.currentMicrocycle?.days || []).filter((d) => d.week_number === state.selectedWeek);
  if (weekDays.length > 0) {
    openDayEditor(weekDays[0].id);
  }
});

function renderDaysGrid() {
  const mc = state.currentMicrocycle;
  const grid = $('daysGrid');
  grid.innerHTML = '';
  const weekDays = (mc.days || []).filter((d) => d.week_number === state.selectedWeek);

  weekDays.forEach((d) => {
    const hasGround = (d.warmup_exercises || []).some((x) =>
      (x.name || '').toLowerCase().includes('ground')
    );
    const card = document.createElement('div');
    card.className = `day-card ${state.currentDay && state.currentDay.id === d.id ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="row-between">
        <span class="badge">Día ${d.day_number}</span>
        ${hasGround ? '<span class="badge badge-ground">GROUND</span>' : ''}
      </div>
      <div style="font-weight:800;">${esc(d.title)}</div>
      <div class="muted">Warm Up: ${(d.warmup_exercises || []).length} mov · Bloques: ${(d.parts || []).length}</div>
      <div class="badge badge-orange" style="align-self:flex-start;">
        ${esc(d.wod?.type || 'WOD')}: ${esc(d.wod?.title || 'Sin definir')}
      </div>
    `;
    card.addEventListener('click', () => openDayEditor(d.id));
    grid.appendChild(card);
  });
}

function openDayEditor(dayId) {
  const mc = state.currentMicrocycle;
  const day = (mc.days || []).find((d) => d.id === dayId);
  if (!day) return;
  state.currentDay = JSON.parse(JSON.stringify(day));
  $('dayEditorCard').classList.remove('hidden');
  $('editorDayBadge').textContent = `MICROCICLO ${day.week_number} · Día ${day.day_number}`;
  $('dayTitle').value = day.title || '';
  $('dayCoachingTips').value = day.coaching_tips || '';
  renderWarmupTypeSelect(day.warmup_type || 'Movilidad GROUND');
  $('warmupNotes').value = day.warmup_notes || '';
  const wt = day.warmup_timer || { type: 'AMRAP', minutes: 8 };
  $('warmupTimerType').value = wt.type || 'AMRAP';
  $('warmupTimerMinutes').value = wt.minutes || 8;
  if ($('warmupTabataWork')) $('warmupTabataWork').value = wt.tabata_work !== undefined ? wt.tabata_work : 20;
  if ($('warmupTabataRest')) $('warmupTabataRest').value = wt.tabata_rest !== undefined ? wt.tabata_rest : 10;
  if ($('warmupTabataRounds')) $('warmupTabataRounds').value = wt.tabata_rounds !== undefined ? wt.tabata_rounds : 8;
  if ($('warmupEmomInterval')) $('warmupEmomInterval').value = wt.emom_interval !== undefined ? wt.emom_interval : 60;
  if ($('warmupEmomRounds')) $('warmupEmomRounds').value = wt.emom_rounds !== undefined ? wt.emom_rounds : 8;
  updateWarmupTimerUI();

  // Copy target dropdown - format strictly as S2/D2
  const copySel = $('copyTargetDay');
  copySel.innerHTML = '';
  mc.days.forEach((other) => {
    if (other.id !== day.id) {
      const opt = document.createElement('option');
      opt.value = other.id;
      opt.textContent = `S${other.week_number}/D${other.day_number}`;
      opt.title = `Semana ${other.week_number} - Día ${other.day_number}: ${other.title || 'Sin título'}`;
      copySel.appendChild(opt);
    }
  });

  // WOD
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.movements)) state.currentDay.wod.movements = [];
  const wod = state.currentDay.wod;
  $('wodTitle').value = wod.title || '';
  $('wodType').value = wod.type || 'AMRAP';
  $('wodTimeCap').value = wod.time_cap || '';
  delete $('wodTimeCap').dataset.manualEdited;
  $('wodTarget').value = wod.target_score || '';
  $('wodDescription').value = wod.description || '';
  $('wodRx').value = wod.rx_weights || '';
  $('wodScaled').value = wod.scaled_weights || '';
  $('wodStrategy').value = wod.strategy || '';

  if ($('wodTabataWork')) $('wodTabataWork').value = wod.tabata_work || 20;
  if ($('wodTabataRest')) $('wodTabataRest').value = wod.tabata_rest !== undefined ? wod.tabata_rest : 10;
  if ($('wodTabataRounds')) $('wodTabataRounds').value = wod.tabata_rounds || 8;
  if ($('wodEmomInterval')) $('wodEmomInterval').value = wod.emom_interval || 60;
  if ($('wodEmomRounds')) $('wodEmomRounds').value = wod.emom_rounds || 10;
  if ($('wodMinutes')) $('wodMinutes').value = wod.minutes || 12;
  updateWodTimerUI();

  renderWarmupList();
  renderPartsList();
  renderWodMovementsList();
  renderDaysGrid();
}

async function saveExerciseToLibrary({ name, video_url = '', notes = '', category = 'Fuerza', is_ground = 0, ground_flow_level = 'N/A' }) {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    showToast('El ejercicio debe tener un nombre');
    return false;
  }
  const cleanVideo = (video_url || '').trim();
  const cleanNotes = (notes || '').trim();
  const existing = state.exercises.find((item) => (item.name || '').toLowerCase() === cleanName.toLowerCase());
  try {
    if (existing) {
      await api(`/api/exercises/${existing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          video_url: cleanVideo,
          coaching_cues: cleanNotes || existing.coaching_cues,
        }),
      });
      existing.video_url = cleanVideo;
      if (cleanNotes) existing.coaching_cues = cleanNotes;
      showToast(`Vídeo de "${cleanName}" actualizado en la biblioteca.`);
    } else {
      const created = await api('/api/exercises', {
        method: 'POST',
        body: JSON.stringify({
          name: cleanName,
          category: category || 'Fuerza',
          equipment: [],
          description: '',
          coaching_cues: cleanNotes,
          video_url: cleanVideo,
          is_ground: is_ground,
          ground_flow_level: ground_flow_level || 'N/A',
        }),
      });
      state.exercises.push(created);
      showToast(`"${cleanName}" guardado en la biblioteca.`);
    }
    await loadExercises();
    renderLibrary();
    return true;
  } catch (err) {
    showToast('Error al guardar en biblioteca: ' + err.message);
    return false;
  }
}

function renderWarmupList() {
  const list = $('warmupList');
  const items = state.currentDay.warmup_exercises || [];
  if (items.length === 0) {
    list.innerHTML = '<p class="muted">Sin ejercicios añadidos en Warm Up. Usa "+ Añadir GROUND" para movilidad.</p>';
    return;
  }
  list.innerHTML = '';
  items.forEach((item, idx) => {
    const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent((item.name || '').replace(/\(GROUND\)/gi, '').trim() + ' crossfit tutorial')}`;
    const row = document.createElement('div');
    row.className = 'item-box';
    row.innerHTML = `
      <div class="row-between" style="margin-bottom:8px;">
        <strong>${esc(item.name)}</strong>
        <div class="row-wrap">
          ${item.video_url ? `<button class="btn btn-sm" data-play="${idx}">▶ Vídeo</button>` : ''}
          <a class="btn btn-sm" href="${ytSearch}" target="_blank" rel="noopener">🔍 YouTube</a>
          <button class="btn btn-sm btn-outline" data-save-lib-wu title="Guardar este ejercicio y su enlace de vídeo en la biblioteca">💾 Guardar en biblioteca</button>
          <button class="btn btn-danger btn-sm" data-del-wu="${idx}">Quitar</button>
        </div>
      </div>
      <div class="grid-2">
        <div class="field" style="margin-bottom:0;">
          <label>Repeticiones</label>
          <input class="input" data-wu-field="reps" data-idx="${idx}" placeholder="Reps / Tiempo (ej: 8 por lado)" value="${esc(item.reps || '')}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Rondas</label>
          <input class="input" data-wu-field="sets" data-idx="${idx}" placeholder="Rondas (ej: 3 rondas)" value="${esc(item.sets || '')}" />
        </div>
      </div>
      <input class="input" style="margin-top:8px;" data-wu-field="notes" data-idx="${idx}" placeholder="Notas técnicas..." value="${esc(item.notes || '')}" />
      <input class="input" style="margin-top:8px;" data-wu-field="video_url" data-idx="${idx}" placeholder="URL del vídeo (YouTube)..." value="${esc(item.video_url || '')}" />
    `;
    row.querySelector('[data-del-wu]').addEventListener('click', () => {
      state.currentDay.warmup_exercises.splice(idx, 1);
      renderWarmupList();
    });
    const playBtn = row.querySelector('[data-play]');
    if (playBtn) {
      playBtn.addEventListener('click', () => openVideoModal(item.name, state.currentDay.warmup_exercises[idx].video_url));
    }
    row.querySelector('[data-save-lib-wu]')?.addEventListener('click', async () => {
      const cur = state.currentDay.warmup_exercises[idx];
      const isG = (cur.name || '').includes('(GROUND)') ? 1 : 0;
      const ok = await saveExerciseToLibrary({
        name: cur.name,
        video_url: cur.video_url,
        notes: cur.notes,
        category: isG ? 'GROUND Flow' : 'Calentamiento',
        is_ground: isG,
      });
      if (ok) renderWarmupList();
    });
    row.querySelectorAll('[data-wu-field]').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.currentDay.warmup_exercises[idx][inp.dataset.wuField] = inp.value;
      });
    });
    list.appendChild(row);
  });
}

function renderPartsList() {
  const list = $('partsList');
  const parts = state.currentDay.parts || [];
  if (parts.length === 0) {
    list.innerHTML = '<p class="muted">Sin bloques añadidos (p. ej. BLOQUE 1: Fuerza, BLOQUE 2: Halterofilia). Pulsa "+ Añadir Bloque".</p>';
    return;
  }
  list.innerHTML = '';
  parts.forEach((part, pIdx) => {
    const box = document.createElement('div');
    box.className = 'item-box item-box-celeste';
    const blockLabel = `BLOQUE ${pIdx + 1}`;
    const curTimer = (part.timer_type || 'SIN CRONO').toUpperCase();
    const normalizedTimer = ['AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].includes(curTimer) ? curTimer : (curTimer === 'EMON' ? 'EMOM' : 'SIN CRONO');

    box.innerHTML = `
      <div class="row-between" style="margin-bottom:8px;">
        <span class="badge badge-celeste-matte">${esc(blockLabel)}</span>
        <div class="row-wrap" style="gap:6px;">
          ${normalizedTimer !== 'SIN CRONO' ? `<button class="btn btn-sm btn-outline" type="button" data-launch-part-crono="${pIdx}" title="Probar en Crono Oficial">⚡ Crono Oficial ↗</button>` : ''}
          <button class="btn btn-sm" data-add-ex="${pIdx}">+ Ejercicio</button>
          <button class="btn btn-danger btn-sm" data-del-part="${pIdx}">Eliminar bloque</button>
        </div>
      </div>
      <div class="grid-2">
        <div class="field" style="margin-bottom:0;">
          <label>Título del bloque</label>
          <input class="input" data-part-field="title" placeholder="Título (ej: Fuerza Back Squat)" value="${esc(part.title || '')}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Tipo de ejercicio / trabajo</label>
          <input class="input" data-part-field="type" placeholder="Fuerza, Halterofilia, Gimnásticos..." value="${esc(part.type || '')}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Formato de crono del bloque (solo si aplica)</label>
          <select class="input" data-part-field="timer_type">
            ${['SIN CRONO', 'AMRAP', 'EMOM', 'TABATA', 'FOR TIME'].map((opt) => {
              return `<option value="${opt}" ${normalizedTimer === opt ? 'selected' : ''}>${opt === 'SIN CRONO' ? 'Sin crono (Fuerza / Técnica)' : opt}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Tiempo de trabajo / Cap (min)</label>
          <input class="input" type="number" min="1" max="60" data-part-field="timer_minutes" value="${esc(part.timer_minutes || 12)}" />
        </div>
      </div>
      ${normalizedTimer === 'TABATA' ? `
        <div class="grid-3" style="background:rgba(2,132,199,0.06); border:1px solid rgba(2,132,199,0.22); border-radius:6px; padding:8px 10px; margin-top:8px;">
          <div class="field" style="margin-bottom:0;">
            <label style="color:#0284c7; font-weight:700;">🔵 Trabajo (segundos)</label>
            <input class="input" type="number" min="5" max="300" step="5" data-part-field="tabata_work" value="${esc(part.tabata_work !== undefined ? part.tabata_work : 20)}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="color:#10b981; font-weight:700;">🟢 Descanso (segundos)</label>
            <input class="input" type="number" min="0" max="300" step="5" data-part-field="tabata_rest" value="${esc(part.tabata_rest !== undefined ? part.tabata_rest : 10)}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="color:var(--text-main); font-weight:700;">Rondas (intervalos)</label>
            <input class="input" type="number" min="1" max="50" data-part-field="tabata_rounds" value="${esc(part.tabata_rounds !== undefined ? part.tabata_rounds : 8)}" />
          </div>
        </div>
      ` : ''}
      ${normalizedTimer === 'EMOM' ? `
        <div class="grid-2" style="background:rgba(2,132,199,0.06); border:1px solid rgba(2,132,199,0.22); border-radius:6px; padding:8px 10px; margin-top:8px;">
          <div class="field" style="margin-bottom:0;">
            <label style="color:#0284c7; font-weight:700;">Intervalo (segundos)</label>
            <input class="input" type="number" min="10" max="300" step="10" data-part-field="emom_interval" value="${esc(part.emom_interval !== undefined ? part.emom_interval : 60)}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label style="color:var(--text-main); font-weight:700;">Rondas (intervalos)</label>
            <input class="input" type="number" min="1" max="60" data-part-field="emom_rounds" value="${esc(part.emom_rounds !== undefined ? part.emom_rounds : 10)}" />
          </div>
        </div>
      ` : ''}
      <textarea class="input" style="margin-top:8px;" data-part-field="description" placeholder="Esquema de series, %RM, descansos...">${esc(part.description || '')}</textarea>
      <div data-part-ex-list="${pIdx}" style="margin-top:8px;"></div>
    `;

    box.querySelector('[data-del-part]').addEventListener('click', () => {
      state.currentDay.parts.splice(pIdx, 1);
      renderPartsList();
    });
    box.querySelector('[data-add-ex]').addEventListener('click', () => {
      openExercisePicker({ type: 'part', partIdx: pIdx }, false);
    });
    box.querySelector('[data-launch-part-crono]')?.addEventListener('click', () => {
      const mode = (part.timer_type || 'SIN CRONO').toUpperCase();
      if (mode === 'SIN CRONO') return showToast('El bloque no tiene formato de crono');
      const spec = {
        mode,
        minutes: Number(part.timer_minutes) || 12,
        workSec: Number(part.tabata_work !== undefined ? part.tabata_work : 20),
        restSec: Number(part.tabata_rest !== undefined ? part.tabata_rest : 10),
        tabataRounds: Number(part.tabata_rounds !== undefined ? part.tabata_rounds : 8),
        intervalSec: Number(part.emom_interval !== undefined ? part.emom_interval : 60),
      };
      openCoachCronoProModal(spec);
    });
    box.querySelectorAll('[data-part-field]').forEach((inp) => {
      const handler = () => {
        const field = inp.dataset.partField;
        const val = inp.value;
        state.currentDay.parts[pIdx][field] = val;
        if (field === 'timer_type') {
          if (val === 'TABATA') {
            if (part.tabata_work === undefined) part.tabata_work = 20;
            if (part.tabata_rest === undefined) part.tabata_rest = 10;
            if (part.tabata_rounds === undefined) part.tabata_rounds = 8;
            part.timer_minutes = Math.ceil(((Number(part.tabata_work) + Number(part.tabata_rest)) * Number(part.tabata_rounds)) / 60);
          } else if (val === 'EMOM') {
            if (part.emom_interval === undefined) part.emom_interval = 60;
            if (part.emom_rounds === undefined) part.emom_rounds = 10;
            part.timer_minutes = Math.round((Number(part.emom_interval) * Number(part.emom_rounds)) / 60);
          }
          renderPartsList();
        } else if (field === 'tabata_work' || field === 'tabata_rest' || field === 'tabata_rounds') {
          const w = Number(part.tabata_work !== undefined ? part.tabata_work : 20);
          const r = Number(part.tabata_rest !== undefined ? part.tabata_rest : 10);
          const rounds = Number(part.tabata_rounds !== undefined ? part.tabata_rounds : 8);
          part.timer_minutes = Math.ceil(((w + r) * rounds) / 60);
          const minInp = box.querySelector('[data-part-field="timer_minutes"]');
          if (minInp) minInp.value = part.timer_minutes;
        } else if (field === 'emom_interval' || field === 'emom_rounds') {
          const intSec = Number(part.emom_interval !== undefined ? part.emom_interval : 60);
          const rounds = Number(part.emom_rounds !== undefined ? part.emom_rounds : 10);
          part.timer_minutes = Math.round((intSec * rounds) / 60);
          const minInp = box.querySelector('[data-part-field="timer_minutes"]');
          if (minInp) minInp.value = part.timer_minutes;
        }
      };
      inp.addEventListener('input', handler);
      inp.addEventListener('change', handler);
    });

    const exWrap = box.querySelector(`[data-part-ex-list="${pIdx}"]`);
    (part.exercises || []).forEach((ex, eIdx) => {
      const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent((ex.name || '').replace(/\(GROUND\)/gi, '').trim() + ' crossfit tutorial')}`;
      const exRow = document.createElement('div');
      exRow.className = 'item-box';
      exRow.style.background = 'var(--bg-elev)';
      exRow.innerHTML = `
        <div class="row-between" style="margin-bottom:6px;">
          <strong>${esc(ex.name)}</strong>
          <div class="row-wrap">
            ${ex.video_url ? `<button class="btn btn-sm" data-play-ex>▶ Vídeo</button>` : ''}
            <a class="btn btn-sm" href="${ytSearch}" target="_blank" rel="noopener">🔍 YouTube</a>
            <button class="btn btn-sm btn-outline" data-save-lib title="Guardar este ejercicio y su enlace de vídeo en la biblioteca">💾 Guardar en biblioteca</button>
            <button class="btn btn-danger btn-sm" data-del-ex>✕</button>
          </div>
        </div>
        <div class="grid-2">
          <div class="field" style="margin-bottom:0;">
            <label>Series</label>
            <input class="input" data-ex-f="sets" placeholder="Ej: 5" value="${esc(ex.sets || '')}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Repeticiones</label>
            <input class="input" data-ex-f="reps" placeholder="Ej: 5 o 8-10" value="${esc(ex.reps || '')}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Porcentaje / Carga (%RM / kg)</label>
            <input class="input" data-ex-f="load" placeholder="Ej: 75% 1RM o 60 kg" value="${esc(ex.load || '')}" />
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>Descanso</label>
            <input class="input" data-ex-f="rest" placeholder="Ej: 120 seg" value="${esc(ex.rest || '')}" />
          </div>
        </div>
        <input class="input" style="margin-top:8px;" data-ex-f="notes" placeholder="Explicación opcional (técnica, estímulo...)" value="${esc(ex.notes || '')}" />
        <input class="input" style="margin-top:8px;" data-ex-f="video_url" placeholder="URL del vídeo (YouTube)..." value="${esc(ex.video_url || '')}" />
      `;
      exRow.querySelector('[data-del-ex]').addEventListener('click', () => {
        state.currentDay.parts[pIdx].exercises.splice(eIdx, 1);
        renderPartsList();
      });
      const play = exRow.querySelector('[data-play-ex]');
      if (play) play.addEventListener('click', () => openVideoModal(ex.name, state.currentDay.parts[pIdx].exercises[eIdx].video_url));
      exRow.querySelector('[data-save-lib]')?.addEventListener('click', async () => {
        const cur = state.currentDay.parts[pIdx].exercises[eIdx];
        const ok = await saveExerciseToLibrary({
          name: cur.name,
          video_url: cur.video_url,
          notes: cur.notes,
          category: part.type || 'Fuerza',
        });
        if (ok) renderPartsList();
      });
      exRow.querySelectorAll('[data-ex-f]').forEach((inp) => {
        inp.addEventListener('input', () => {
          state.currentDay.parts[pIdx].exercises[eIdx][inp.dataset.exF] = inp.value;
        });
      });
      exWrap.appendChild(exRow);
    });

    list.appendChild(box);
  });
}

function renderWodMovementsList() {
  const list = $('wodMovementsList');
  if (!list || !state.currentDay) return;
  if (!state.currentDay.wod) state.currentDay.wod = {};
  const moves = state.currentDay.wod.movements || [];
  if (moves.length === 0) {
    list.innerHTML = '<p class="muted" style="margin:0;">Sin vídeos añadidos aún. Añade movimientos desde la biblioteca o manualmente si requieren explicación.</p>';
    return;
  }
  list.innerHTML = '';
  moves.forEach((m, idx) => {
    const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent((m.name || 'crossfit').trim() + ' crossfit tutorial')}`;
    const row = document.createElement('div');
    row.className = 'item-box';
    row.innerHTML = `
      <div class="row-between" style="margin-bottom:6px;">
        <strong>Movimiento ${idx + 1}</strong>
        <div class="row-wrap">
          ${m.video_url ? `<button class="btn btn-sm" data-play-wod>▶ Vídeo</button>` : ''}
          <a class="btn btn-sm" href="${ytSearch}" target="_blank" rel="noopener">🔍 YouTube</a>
          <button class="btn btn-sm btn-outline" data-save-lib-wod title="Guardar este ejercicio y su enlace de vídeo en la biblioteca">💾 Guardar en biblioteca</button>
          <button class="btn btn-danger btn-sm" data-del-wod>Quitar</button>
        </div>
      </div>
      <div class="grid-2">
        <div class="field" style="margin-bottom:0;">
          <label>Nombre del ejercicio</label>
          <input class="input" data-wm="name" placeholder="Ej: Thruster / Double Unders" value="${esc(m.name || '')}" />
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>URL del vídeo</label>
          <input class="input" data-wm="video_url" placeholder="https://www.youtube.com/..." value="${esc(m.video_url || '')}" />
        </div>
      </div>
      <input class="input" style="margin-top:8px;" data-wm="notes" placeholder="Explicación opcional para el alumno..." value="${esc(m.notes || '')}" />
    `;
    row.querySelector('[data-del-wod]').addEventListener('click', () => {
      state.currentDay.wod.movements.splice(idx, 1);
      renderWodMovementsList();
    });
    row.querySelector('[data-play-wod]')?.addEventListener('click', () => {
      openVideoModal(m.name || 'Movimiento WOD', state.currentDay.wod.movements[idx].video_url);
    });
    row.querySelector('[data-save-lib-wod]')?.addEventListener('click', async () => {
      const cur = state.currentDay.wod.movements[idx];
      const ok = await saveExerciseToLibrary({
        name: cur.name,
        video_url: cur.video_url,
        notes: cur.notes,
        category: 'WOD',
      });
      if (ok) renderWodMovementsList();
    });
    row.querySelectorAll('[data-wm]').forEach((inp) => {
      inp.addEventListener('input', () => {
        state.currentDay.wod.movements[idx][inp.dataset.wm] = inp.value;
      });
    });
    list.appendChild(row);
  });
}

$('btnAddWodMovementLib').addEventListener('click', () => {
  if (!state.currentDay) return;
  openExercisePicker({ type: 'wod' }, false);
});
$('btnAddWodMovementManual').addEventListener('click', () => {
  if (!state.currentDay) return;
  if (!state.currentDay.wod) state.currentDay.wod = {};
  if (!Array.isArray(state.currentDay.wod.movements)) state.currentDay.wod.movements = [];
  state.currentDay.wod.movements.push({ name: '', notes: '', video_url: '' });
  renderWodMovementsList();
});

$('btnAddWarmupGround').addEventListener('click', () => openExercisePicker({ type: 'warmup' }, true));
$('btnAddWarmupAny').addEventListener('click', () => openExercisePicker({ type: 'warmup' }, false));
$('btnAddPart').addEventListener('click', () => {
  if (!state.currentDay) return;
  const idx = (state.currentDay.parts || []).length;
  state.currentDay.parts.push({
    part_label: `BLOQUE ${idx + 1}`,
    title: '',
    type: 'Fuerza',
    description: '',
    exercises: [],
  });
  renderPartsList();
});

$('btnCoachPrintDay')?.addEventListener('click', () => {
  if (!state.currentDay) {
    alert('Selecciona un día en la planificación primero.');
    return;
  }
  window.open(`/alumnos#day=${state.currentDay.id}`, '_blank');
});

// Exercise picker & target insertion
function pickExerciseIntoTarget(ex) {
  if (!state.pickerTarget || !state.currentDay) return;
  if (state.pickerTarget.type === 'warmup') {
    state.currentDay.warmup_exercises.push({
      name: ex.name,
      sets: '2-3 rondas',
      reps: '8-10 reps / lado',
      notes: ex.coaching_cues || '',
      video_url: ex.video_url || '',
    });
    renderWarmupList();
  } else if (state.pickerTarget.type === 'wod') {
    if (!state.currentDay.wod) state.currentDay.wod = {};
    if (!Array.isArray(state.currentDay.wod.movements)) state.currentDay.wod.movements = [];
    state.currentDay.wod.movements.push({
      name: ex.name,
      notes: ex.coaching_cues || '',
      video_url: ex.video_url || '',
    });
    renderWodMovementsList();
  } else if (state.pickerTarget.type === 'part') {
    const part = state.currentDay.parts[state.pickerTarget.partIdx];
    if (part) {
      if (!Array.isArray(part.exercises)) part.exercises = [];
      part.exercises.push({
        name: ex.name,
        sets: '4',
        reps: '6-8',
        load: '75% 1RM',
        rest: '90 seg',
        notes: ex.coaching_cues || '',
        video_url: ex.video_url || '',
      });
      renderPartsList();
    }
  }
}

function openExercisePicker(target, groundOnly) {
  state.pickerTarget = target;
  state.pickerGroundOnly = groundOnly;
  $('pickerTitle').textContent = groundOnly
    ? 'Ejercicios GROUND'
    : 'Seleccionar Ejercicio';
  $('pickerGroundToggle').classList.toggle('selected', groundOnly);
  $('pickerSearch').value = '';
  renderPickerList();
  openModal('pickerModal');
}

$('btnPickerAddNewEx')?.addEventListener('click', () => {
  const query = $('pickerSearch').value.trim();
  openExerciseModal(null);
  if (query) $('exName').value = query;
  if (state.pickerGroundOnly) {
    $('exIsGround').checked = true;
    $('exLevel').disabled = false;
  }
});

$('pickerGroundToggle').addEventListener('click', () => {
  state.pickerGroundOnly = !state.pickerGroundOnly;
  $('pickerGroundToggle').classList.toggle('selected', state.pickerGroundOnly);
  renderPickerList();
});
$('pickerSearch').addEventListener('input', renderPickerList);

function renderPickerList() {
  const q = $('pickerSearch').value.trim().toLowerCase();
  const list = $('pickerList');
  const filtered = state.exercises.filter((ex) => {
    if (state.pickerGroundOnly && !ex.is_ground) return false;
    if (q && !ex.name.toLowerCase().includes(q) && !(ex.description || '').toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
  list.innerHTML = '';
  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted">No se encontraron ejercicios con ese filtro. Usa "+ Crear nuevo" arriba para añadirlo a la biblioteca.</p>';
    return;
  }
  filtered.forEach((ex) => {
    const row = document.createElement('div');
    row.className = 'item-box';
    row.innerHTML = `
      <div class="row-between">
        <div>
          <strong>${esc(ex.name)}</strong>
          <div class="row-wrap" style="margin-top:4px;">
            ${ex.is_ground ? `<span class="badge badge-ground">GROUND · ${esc(ex.ground_flow_level)}</span>` : `<span class="badge">${esc(ex.category)}</span>`}
          </div>
        </div>
        <div class="row-wrap">
          ${ex.video_url ? `<button class="btn btn-sm" data-preview>▶</button>` : ''}
          <button class="btn btn-primary btn-sm" data-pick>Añadir</button>
        </div>
      </div>
    `;
    row.querySelector('[data-preview]')?.addEventListener('click', () => openVideoModal(ex.name, ex.video_url));
    row.querySelector('[data-pick]').addEventListener('click', () => {
      pickExerciseIntoTarget(ex);
      closeModal('pickerModal');
    });
    list.appendChild(row);
  });
}

// WOD Generator
function renderEquipmentChips() {
  const wrap = $('genEquipmentChips');
  wrap.innerHTML = '';
  EQUIPMENT_LIST.forEach((eq) => {
    const chip = document.createElement('span');
    chip.className = `chip ${state.selectedEquipment.has(eq) ? 'selected' : ''}`;
    chip.textContent = eq;
    chip.addEventListener('click', () => {
      if (state.selectedEquipment.has(eq)) state.selectedEquipment.delete(eq);
      else state.selectedEquipment.add(eq);
      renderEquipmentChips();
    });
    wrap.appendChild(chip);
  });
}

function loadCustomWodTypes() {
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_types') || '[]');
    const sel = $('genWodType');
    const dl = $('wodTypeList');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    saved.forEach((t) => {
      if (!existing.has(t)) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        const newMarker = sel.querySelector('option[value="__new__"]');
        if (newMarker) sel.insertBefore(opt, newMarker);
        else sel.appendChild(opt);
      }
      if (dl && !Array.from(dl.options).some((o) => o.value === t)) {
        const dlOpt = document.createElement('option');
        dlOpt.value = t;
        dl.appendChild(dlOpt);
      }
    });
  } catch (_) {}
}

$('genWodType')?.addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newWodTypeBox')?.classList.remove('hidden');
    $('newWodTypeInput')?.focus();
  } else {
    $('newWodTypeBox')?.classList.add('hidden');
  }
});
$('btnNewWodType')?.addEventListener('click', () => {
  $('newWodTypeBox')?.classList.toggle('hidden');
  if (!$('newWodTypeBox')?.classList.contains('hidden')) {
    $('newWodTypeInput')?.focus();
  }
});
function addCustomWodType() {
  const val = ($('newWodTypeInput')?.value || '').trim().toUpperCase();
  if (!val) return;
  const sel = $('genWodType');
  const dl = $('wodTypeList');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    const newMarker = sel.querySelector('option[value="__new__"]');
    if (newMarker) sel.insertBefore(opt, newMarker);
    else sel.appendChild(opt);
    sel.value = val;
  }
  if (dl && !Array.from(dl.options).some((o) => o.value === val)) {
    const dlOpt = document.createElement('option');
    dlOpt.value = val;
    dl.appendChild(dlOpt);
  }
  if ($('newWodTypeInput')) $('newWodTypeInput').value = '';
  $('newWodTypeBox')?.classList.add('hidden');
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_types') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_wod_types', JSON.stringify(saved));
    }
  } catch (_) {}
}
$('btnSaveWodType')?.addEventListener('click', addCustomWodType);
$('newWodTypeInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomWodType();
  }
});

// ================= COACH CRONO PRO MODAL =================
function openCoachCronoProModal(spec) {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  const newTabBtn = $('cronoProNewTabBtn');
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
    iframe.src = url;
    if (newTabBtn) newTabBtn.href = url;
    modal.classList.add('open');
  }
}

$('btnCloseCronoPro')?.addEventListener('click', () => {
  const modal = $('cronoProModal');
  const iframe = $('cronoProIframe');
  if (modal && iframe) {
    modal.classList.remove('open');
    iframe.src = 'about:blank';
  }
});

// ================= COACH WARM UP TIMER CONTROLS =================
function updateWarmupTimerUI() {
  const raw = ($('warmupTimerType')?.value || 'AMRAP').toUpperCase();
  const isSin = raw.includes('SIN CRONO');
  const isTabata = !isSin && raw.includes('TABATA');
  const isEmom = !isSin && raw.includes('EMOM');
  const isCap = !isSin && (raw.includes('AMRAP') || raw.includes('FOR TIME') || raw.includes('TIME') || raw.includes('CRONO'));

  $('warmupTimerConfigCard')?.classList.toggle('hidden', isSin);
  $('warmupCfgTabata')?.classList.toggle('hidden', !isTabata);
  $('warmupCfgEmom')?.classList.toggle('hidden', !isEmom);
  $('warmupCfgCap')?.classList.toggle('hidden', !isCap);

  const sumEl = $('warmupTimerSummary');
  if (isSin) {
    if (sumEl) sumEl.textContent = 'Sin crono configurado para el Warm Up';
  } else if (isTabata) {
    const w = Number($('warmupTabataWork')?.value) || 20;
    const r = $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10;
    const rounds = Number($('warmupTabataRounds')?.value) || 8;
    const totalSec = (w + r) * rounds;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const tStr = s > 0 ? `${m}m ${s}s` : `${m} min`;
    if (sumEl) sumEl.innerHTML = `⚡ <strong>${rounds} rondas</strong>: <span style="color:#38bdf8; font-weight:800;">${w}s Trabajo (Azul)</span> / <span style="color:#22c55e; font-weight:800;">${r}s Descanso (Verde)</span> (Total: ${tStr})`;
    if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = Math.ceil(totalSec / 60);
  } else if (isEmom) {
    const intSec = Number($('warmupEmomInterval')?.value) || 60;
    const rounds = Number($('warmupEmomRounds')?.value) || 8;
    const totalM = Math.round((intSec * rounds) / 60);
    if (sumEl) sumEl.innerHTML = `⚡ <strong>EMOM</strong>: Cada ${intSec}s durante ${rounds} rondas (Total: ${totalM} min)`;
    if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = totalM;
  } else if (isCap) {
    const mins = Number($('warmupTimerMinutes')?.value) || 8;
    if (sumEl) sumEl.innerHTML = `⚡ Duración / Cap: <strong>${mins} minutos</strong>`;
  }
}

function initCoachWarmupTimerControls() {
  $('warmupTimerType')?.addEventListener('change', updateWarmupTimerUI);

  // Tabata coach steppers for Warm Up
  $('btnCoachDecWarmupWork')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataWork')?.value) || 20;
    if ($('warmupTabataWork')) $('warmupTabataWork').value = Math.max(5, cur - 5);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupWork')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataWork')?.value) || 20;
    if ($('warmupTabataWork')) $('warmupTabataWork').value = cur + 5;
    updateWarmupTimerUI();
  });
  $('btnCoachDecWarmupRest')?.addEventListener('click', () => {
    const cur = $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10;
    if ($('warmupTabataRest')) $('warmupTabataRest').value = Math.max(0, cur - 5);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupRest')?.addEventListener('click', () => {
    const cur = $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10;
    if ($('warmupTabataRest')) $('warmupTabataRest').value = cur + 5;
    updateWarmupTimerUI();
  });
  $('btnCoachDecWarmupRounds')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataRounds')?.value) || 8;
    if ($('warmupTabataRounds')) $('warmupTabataRounds').value = Math.max(1, cur - 1);
    updateWarmupTimerUI();
  });
  $('btnCoachIncWarmupRounds')?.addEventListener('click', () => {
    const cur = Number($('warmupTabataRounds')?.value) || 8;
    if ($('warmupTabataRounds')) $('warmupTabataRounds').value = Math.min(50, cur + 1);
    updateWarmupTimerUI();
  });

  // Presets Tabata for Warm Up
  document.querySelectorAll('.coach-warmup-tabata-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ($('warmupTabataWork')) $('warmupTabataWork').value = btn.dataset.work;
      if ($('warmupTabataRest')) $('warmupTabataRest').value = btn.dataset.rest;
      if ($('warmupTabataRounds')) $('warmupTabataRounds').value = btn.dataset.rounds;
      updateWarmupTimerUI();
    });
  });

  // Quick minutes for AMRAP / FOR TIME in Warm Up
  document.querySelectorAll('[data-set-coach-warmup-mins]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ($('warmupTimerMinutes')) $('warmupTimerMinutes').value = btn.dataset.setCoachWarmupMins;
      updateWarmupTimerUI();
    });
  });

  ['warmupTabataWork', 'warmupTabataRest', 'warmupTabataRounds', 'warmupEmomInterval', 'warmupEmomRounds', 'warmupTimerMinutes'].forEach((id) => {
    $(id)?.addEventListener('input', updateWarmupTimerUI);
    $(id)?.addEventListener('change', updateWarmupTimerUI);
  });

  // Launch Crono Pro for Warm Up
  $('btnLaunchWarmupCronoPro')?.addEventListener('click', () => {
    const raw = ($('warmupTimerType')?.value || 'AMRAP').toUpperCase();
    if (raw.includes('SIN CRONO')) {
      return showToast('Elige un formato de crono para el Warm Up');
    }
    const mode = raw.includes('TABATA') ? 'TABATA' : (raw.includes('EMOM') ? 'EMOM' : (raw.includes('TIME') ? 'FOR TIME' : 'AMRAP'));
    const spec = {
      mode,
      minutes: Number($('warmupTimerMinutes')?.value) || 8,
      workSec: Number($('warmupTabataWork')?.value) || 20,
      restSec: Number($('warmupTabataRest')?.value) || 10,
      tabataRounds: Number($('warmupTabataRounds')?.value) || 8,
      intervalSec: Number($('warmupEmomInterval')?.value) || 60,
    };
    openCoachCronoProModal(spec);
  });
}
initCoachWarmupTimerControls();

// ================= COACH WOD TIMER CONTROLS =================
function updateWodTimerUI() {
  const rawType = ($('wodType')?.value || '').toUpperCase();
  const isSin = rawType.includes('SIN CRONO');
  const isTabata = !isSin && rawType.includes('TABATA');
  const isEmom = !isSin && rawType.includes('EMOM');
  const isCap = !isSin && (rawType.includes('AMRAP') || rawType.includes('FOR TIME') || rawType.includes('TIME') || rawType.includes('CHIPPER') || rawType.includes('ENDURANCE'));

  $('wodTimerConfigCard')?.classList.toggle('hidden', isSin);
  $('wodCfgTabata')?.classList.toggle('hidden', !isTabata);
  $('wodCfgEmom')?.classList.toggle('hidden', !isEmom);
  $('wodCfgCap')?.classList.toggle('hidden', !isCap);

  const sumEl = $('wodTimerSummary');
  if (isSin) {
    if (sumEl) sumEl.textContent = 'Sin crono configurado para el WOD';
  } else if (isTabata) {
    const work = Number($('wodTabataWork')?.value) || 20;
    const rest = $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10;
    const rounds = Number($('wodTabataRounds')?.value) || 8;
    const totalSec = (work + rest) * rounds;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const tStr = s > 0 ? `${m}m ${s}s` : `${m} min`;
    if (sumEl) sumEl.innerHTML = `⚡ <strong>${rounds} rondas</strong>: <span style="color:#38bdf8; font-weight:800;">${work}s Trabajo (Azul)</span> / <span style="color:#22c55e; font-weight:800;">${rest}s Descanso (Verde)</span> (Total: ${tStr})`;
    if ($('wodTimeCap') && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = `${rounds} rondas · ${work}s/${rest}s (${tStr})`;
    }
  } else if (isEmom) {
    const intSec = Number($('wodEmomInterval')?.value) || 60;
    const rounds = Number($('wodEmomRounds')?.value) || 10;
    const totalM = Math.round((intSec * rounds) / 60);
    if (sumEl) sumEl.innerHTML = `⚡ <strong>EMOM</strong>: Cada ${intSec}s durante ${rounds} intervalos (Total: ${totalM} min)`;
    if ($('wodTimeCap') && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = `EMOM ${rounds}' (cada ${intSec}s)`;
    }
  } else if (isCap) {
    const mins = Number($('wodMinutes')?.value) || 12;
    if (sumEl) sumEl.innerHTML = `⚡ Duración / Time Cap: <strong>${mins} minutos</strong>`;
    if ($('wodTimeCap') && !$('wodTimeCap').dataset.manualEdited) {
      $('wodTimeCap').value = `${mins} Minutos`;
    }
  } else {
    if (sumEl) sumEl.textContent = 'Configura el formato de entrenamiento';
  }
}

function initCoachWodTimerControls() {
  $('wodType')?.addEventListener('input', () => {
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('wodType')?.addEventListener('change', () => {
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('wodTimeCap')?.addEventListener('input', () => {
    $('wodTimeCap').dataset.manualEdited = 'true';
  });

  // Tabata coach steppers
  $('btnCoachDecWork')?.addEventListener('click', () => {
    const cur = Number($('wodTabataWork')?.value) || 20;
    if ($('wodTabataWork')) $('wodTabataWork').value = Math.max(5, cur - 5);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncWork')?.addEventListener('click', () => {
    const cur = Number($('wodTabataWork')?.value) || 20;
    if ($('wodTabataWork')) $('wodTabataWork').value = cur + 5;
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachDecRest')?.addEventListener('click', () => {
    const cur = $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10;
    if ($('wodTabataRest')) $('wodTabataRest').value = Math.max(0, cur - 5);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncRest')?.addEventListener('click', () => {
    const cur = $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10;
    if ($('wodTabataRest')) $('wodTabataRest').value = cur + 5;
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachDecRounds')?.addEventListener('click', () => {
    const cur = Number($('wodTabataRounds')?.value) || 8;
    if ($('wodTabataRounds')) $('wodTabataRounds').value = Math.max(1, cur - 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });
  $('btnCoachIncRounds')?.addEventListener('click', () => {
    const cur = Number($('wodTabataRounds')?.value) || 8;
    if ($('wodTabataRounds')) $('wodTabataRounds').value = Math.min(50, cur + 1);
    delete $('wodTimeCap').dataset.manualEdited;
    updateWodTimerUI();
  });

  // Presets
  document.querySelectorAll('.coach-tabata-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if ($('wodTabataWork')) $('wodTabataWork').value = btn.dataset.work;
      if ($('wodTabataRest')) $('wodTabataRest').value = btn.dataset.rest;
      if ($('wodTabataRounds')) $('wodTabataRounds').value = btn.dataset.rounds;
      delete $('wodTimeCap').dataset.manualEdited;
      updateWodTimerUI();
    });
  });

  // Direct inputs
  ['wodTabataWork', 'wodTabataRest', 'wodTabataRounds', 'wodEmomInterval', 'wodEmomRounds', 'wodMinutes'].forEach((id) => {
    $(id)?.addEventListener('input', () => {
      delete $('wodTimeCap').dataset.manualEdited;
      updateWodTimerUI();
    });
    $(id)?.addEventListener('change', () => {
      delete $('wodTimeCap').dataset.manualEdited;
      updateWodTimerUI();
    });
  });

  document.querySelectorAll('[data-set-coach-mins]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mins = Number(btn.dataset.setCoachMins) || 12;
      if ($('wodMinutes')) $('wodMinutes').value = mins;
      delete $('wodTimeCap').dataset.manualEdited;
      updateWodTimerUI();
    });
  });

  $('btnLaunchWodCronoPro')?.addEventListener('click', () => {
    const rawType = ($('wodType')?.value || '').toUpperCase();
    if (rawType.includes('SIN CRONO') || rawType === 'SIN') {
      return showToast('Elige un formato de crono para el WOD');
    }
    const mode = rawType.includes('TABATA') ? 'TABATA' : (rawType.includes('EMOM') ? 'EMOM' : (rawType.includes('TIME') ? 'FOR TIME' : 'AMRAP'));
    const spec = {
      mode,
      minutes: Number($('wodMinutes')?.value) || 12,
      workSec: Number($('wodTabataWork')?.value) || 20,
      restSec: Number($('wodTabataRest')?.value) || 10,
      tabataRounds: Number($('wodTabataRounds')?.value) || 8,
      intervalSec: Number($('wodEmomInterval')?.value) || 60,
    };
    openCoachCronoProModal(spec);
  });
}
initCoachWodTimerControls();

function loadCustomWodGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_goals') || '[]');
    const sel = $('genGoal');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    saved.forEach((g) => {
      if (!existing.has(g)) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        const newMarker = sel.querySelector('option[value="__new__"]');
        if (newMarker) sel.insertBefore(opt, newMarker);
        else sel.appendChild(opt);
      }
    });
  } catch (_) {}
}

$('genGoal')?.addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newGenGoalBox')?.classList.remove('hidden');
    $('newGenGoalInput')?.focus();
  } else {
    $('newGenGoalBox')?.classList.add('hidden');
  }
});
$('btnNewGenGoal')?.addEventListener('click', () => {
  $('newGenGoalBox')?.classList.toggle('hidden');
  if (!$('newGenGoalBox')?.classList.contains('hidden')) {
    $('newGenGoalInput')?.focus();
  }
});
function addCustomGenGoal() {
  const val = ($('newGenGoalInput')?.value || '').trim();
  if (!val) return;
  const sel = $('genGoal');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    const newMarker = sel.querySelector('option[value="__new__"]');
    if (newMarker) sel.insertBefore(opt, newMarker);
    else sel.appendChild(opt);
    sel.value = val;
  }
  if ($('newGenGoalInput')) $('newGenGoalInput').value = '';
  $('newGenGoalBox')?.classList.add('hidden');
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_wod_goals') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_wod_goals', JSON.stringify(saved));
    }
  } catch (_) {}
}
$('btnSaveGenGoal')?.addEventListener('click', addCustomGenGoal);
$('newGenGoalInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomGenGoal();
  }
});

$('btnToggleWodGen').addEventListener('click', () => {
  $('wodGeneratorBox').classList.toggle('hidden');
});

$('btnRunWodGen').addEventListener('click', async () => {
  try {
    let wodType = $('genWodType').value;
    if (wodType === '__new__') {
      wodType = $('newWodTypeInput')?.value.trim() || 'AMRAP';
    }
    let goal = $('genGoal').value;
    if (goal === '__new__') {
      goal = $('newGenGoalInput')?.value.trim() || 'Híbrido';
    }
    const wod = await api('/api/generate-wod', {
      method: 'POST',
      body: JSON.stringify({
        equipment: Array.from(state.selectedEquipment),
        time_minutes: Number($('genTime').value) || 15,
        wod_type: wodType,
        goal: goal,
      }),
    });
    $('wodTitle').value = wod.title || '';
    $('wodType').value = wod.type || '';
    $('wodTimeCap').value = wod.time_cap || '';
    $('wodTarget').value = wod.target_score || '';
    $('wodDescription').value = wod.description || '';
    $('wodRx').value = wod.rx_weights || '';
    $('wodScaled').value = wod.scaled_weights || '';
    $('wodStrategy').value = wod.strategy || '';
    showToast('WOD generado. Pulsa Guardar Sesión para aplicarlo.');
  } catch (err) {
    showToast(err.message);
  }
});

// Save day
async function saveCurrentDay() {
  if (!state.currentDay) return;
  const payload = {
    title: $('dayTitle').value.trim() || `Día ${state.currentDay.day_number}`,
    warmup_type: $('warmupTypeSelect').value || 'Movilidad GROUND',
    warmup_notes: $('warmupNotes').value.trim(),
    warmup_timer: {
      type: $('warmupTimerType').value || 'SIN CRONO',
      minutes: Number($('warmupTimerMinutes').value) || 8,
      tabata_work: Number($('warmupTabataWork')?.value) || 20,
      tabata_rest: $('warmupTabataRest') && $('warmupTabataRest').value !== '' ? Number($('warmupTabataRest').value) : 10,
      tabata_rounds: Number($('warmupTabataRounds')?.value) || 8,
      emom_interval: Number($('warmupEmomInterval')?.value) || 60,
      emom_rounds: Number($('warmupEmomRounds')?.value) || 8,
    },
    warmup_exercises: state.currentDay.warmup_exercises || [],
    parts: state.currentDay.parts || [],
    wod: {
      title: $('wodTitle').value.trim(),
      type: $('wodType').value.trim(),
      time_cap: $('wodTimeCap').value.trim(),
      target_score: $('wodTarget').value.trim(),
      description: $('wodDescription').value.trim(),
      rx_weights: $('wodRx').value.trim(),
      scaled_weights: $('wodScaled').value.trim(),
      strategy: $('wodStrategy').value.trim(),
      equipment: Array.from(state.selectedEquipment),
      movements: state.currentDay.wod?.movements || [],
      tabata_work: Number($('wodTabataWork')?.value) || 20,
      tabata_rest: $('wodTabataRest') && $('wodTabataRest').value !== '' ? Number($('wodTabataRest').value) : 10,
      tabata_rounds: Number($('wodTabataRounds')?.value) || 8,
      emom_interval: Number($('wodEmomInterval')?.value) || 60,
      emom_rounds: Number($('wodEmomRounds')?.value) || 10,
      minutes: Number($('wodMinutes')?.value) || 12,
    },
    coaching_tips: $('dayCoachingTips').value.trim(),
  };

  try {
    await api(`/api/days/${state.currentDay.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const mc = await api(`/api/microcycles/${state.currentMicrocycle.id}`);
    state.currentMicrocycle = mc;
    renderDaysGrid();
    showToast('Sesión guardada correctamente');
  } catch (err) {
    showToast(err.message);
  }
}

$('btnSaveDay').addEventListener('click', saveCurrentDay);
$('btnSaveDayBottom').addEventListener('click', saveCurrentDay);

$('btnCopyDay').addEventListener('click', async () => {
  const targetId = Number($('copyTargetDay').value);
  if (!targetId || !state.currentDay) return;
  try {
    await saveCurrentDay();
    await api(`/api/days/copy?source_day_id=${state.currentDay.id}&target_day_id=${targetId}`, {
      method: 'POST',
    });
    const mc = await api(`/api/microcycles/${state.currentMicrocycle.id}`);
    state.currentMicrocycle = mc;
    renderDaysGrid();
    showToast('Sesión copiada al día destino');
  } catch (err) {
    showToast(err.message);
  }
});

// Microcycle CRUD & Custom Goals
function loadCustomGoals() {
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_mc_goals') || '[]');
    const sel = $('mcGoal');
    if (!sel) return;
    const existing = new Set(Array.from(sel.options).map((o) => o.value));
    saved.forEach((g) => {
      if (!existing.has(g)) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        const newMarker = sel.querySelector('option[value="__new__"]');
        if (newMarker) sel.insertBefore(opt, newMarker);
        else sel.appendChild(opt);
      }
    });
  } catch (_) {}
}

$('mcGoal')?.addEventListener('change', (e) => {
  if (e.target.value === '__new__') {
    $('newMcGoalBox')?.classList.remove('hidden');
    $('newMcGoalInput')?.focus();
  } else {
    $('newMcGoalBox')?.classList.add('hidden');
  }
});
$('btnNewMcGoal')?.addEventListener('click', () => {
  $('newMcGoalBox')?.classList.toggle('hidden');
  if (!$('newMcGoalBox')?.classList.contains('hidden')) {
    $('newMcGoalInput')?.focus();
  }
});
function addCustomMcGoal() {
  const val = ($('newMcGoalInput')?.value || '').trim();
  if (!val) return;
  const sel = $('mcGoal');
  if (sel) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    const newMarker = sel.querySelector('option[value="__new__"]');
    if (newMarker) sel.insertBefore(opt, newMarker);
    else sel.appendChild(opt);
    sel.value = val;
  }
  if ($('newMcGoalInput')) $('newMcGoalInput').value = '';
  $('newMcGoalBox')?.classList.add('hidden');
  try {
    const saved = JSON.parse(localStorage.getItem('hecthor_custom_mc_goals') || '[]');
    if (!saved.includes(val)) {
      saved.push(val);
      localStorage.setItem('hecthor_custom_mc_goals', JSON.stringify(saved));
    }
  } catch (_) {}
}
$('btnSaveMcGoal')?.addEventListener('click', addCustomMcGoal);
$('newMcGoalInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomMcGoal();
  }
});

$('btnNewMicrocycle').addEventListener('click', () => {
  $('mcCode').value = 'CF' + Math.floor(1000 + Math.random() * 9000);
  $('mcStartDate').value = getDefaultMondayIso();
  $('newMcGoalBox')?.classList.add('hidden');
  openModal('microcycleModal');
});

$('btnCreateMicrocycleSubmit').addEventListener('click', async () => {
  const name = $('mcName').value.trim();
  const code = $('mcCode').value.trim().toUpperCase();
  if (!name || !code) {
    showToast('Introduce nombre y código de acceso');
    return;
  }
  let primaryGoal = $('mcGoal').value;
  if (primaryGoal === '__new__') {
    primaryGoal = ($('newMcGoalInput')?.value || '').trim() || 'Fuerza';
  }
  try {
    const res = await api('/api/microcycles', {
      method: 'POST',
      body: JSON.stringify({
        name,
        weeks_count: Number($('mcWeeks').value) || 4,
        days_per_week: Number($('mcDays').value) || 5,
        primary_goal: primaryGoal,
        description: $('mcDesc').value.trim(),
        access_code: code,
        start_date: $('mcStartDate').value || getDefaultMondayIso(),
      }),
    });
    closeModal('microcycleModal');
    $('mcName').value = '';
    $('mcDesc').value = '';
    await loadMicrocycles(res.id);
    showToast('Mesociclo creado');
  } catch (err) {
    showToast(err.message);
  }
});

$('btnDeleteMicrocycle').addEventListener('click', async () => {
  if (!state.currentMicrocycle) return;
  if (!confirm(`¿Eliminar el mesociclo "${state.currentMicrocycle.name}" y todas sus semanas y sesiones?`)) return;
  await api(`/api/microcycles/${state.currentMicrocycle.id}`, { method: 'DELETE' });
  await loadMicrocycles();
  showToast('Mesociclo eliminado');
});

// Library
const DEFAULT_CATEGORIES = [
  { key: 'ground', label: 'GROUND' },
  { key: 'halterofilia', label: 'Halterofilia' },
  { key: 'fuerza', label: 'Fuerza' },
  { key: 'gimnasticos', label: 'Gimnásticos' },
  { key: 'metcon', label: 'Metcon / Cardio' },
];

let libraryCat = '';
let editingExerciseId = null;

function getAllCategories() {
  const map = new Map(DEFAULT_CATEGORIES.map((c) => [c.key.toLowerCase(), c.label]));
  state.exercises.forEach((ex) => {
    const raw = (ex.category || '').trim();
    if (raw && !map.has(raw.toLowerCase())) {
      map.set(raw.toLowerCase(), raw);
    }
  });
  return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
}

function renderLibraryFilters() {
  const wrap = $('libraryFilters');
  const cats = getAllCategories();
  wrap.innerHTML = '';

  const chips = [{ key: '', label: 'Todos' }, ...cats];
  chips.forEach((c) => {
    const span = document.createElement('span');
    span.className = `chip ${libraryCat === c.key ? 'selected' : ''}`;
    span.textContent = c.label;
    span.addEventListener('click', () => {
      libraryCat = c.key;
      renderLibraryFilters();
      renderLibrary();
    });
    wrap.appendChild(span);
  });
}

function renderLibrary() {
  renderLibraryFilters();
  const grid = $('libraryGrid');
  const items = state.exercises.filter((ex) => {
    if (!libraryCat) return true;
    if (libraryCat === 'ground') return ex.is_ground === 1 || (ex.category || '').toLowerCase() === 'ground';
    return (ex.category || '').toLowerCase() === libraryCat.toLowerCase();
  });
  grid.innerHTML = '';
  if (items.length === 0) {
    grid.innerHTML = '<p class="muted">No hay ejercicios en esta categoría. Pulsa "+ Añadir Ejercicio" para crear uno.</p>';
    return;
  }
  items.forEach((ex) => {
    const card = document.createElement('div');
    card.className = 'item-box';
    card.innerHTML = `
      <div class="row-between">
        <strong>${esc(ex.name)}</strong>
        <div class="row-wrap">
          <span class="badge">${esc(ex.category)}</span>
          ${ex.is_ground ? `<span class="badge badge-ground">GROUND · ${esc(ex.ground_flow_level || 'Todos')}</span>` : ''}
        </div>
      </div>
      <p class="muted" style="margin:6px 0;">${esc(ex.description)}</p>
      ${ex.coaching_cues ? `<p style="font-size:0.84rem; margin:0 0 8px;"><strong>Claves:</strong> ${esc(ex.coaching_cues)}</p>` : ''}
      <div class="row-between">
        <div class="row-wrap">
          <button class="btn btn-sm" data-play>▶ Ver vídeo</button>
          <button class="btn btn-sm" data-edit>✏️ Editar / Vídeo</button>
        </div>
        <button class="btn btn-danger btn-sm" data-del>Eliminar</button>
      </div>
    `;
    card.querySelector('[data-play]').addEventListener('click', () => openVideoModal(ex.name, ex.video_url));
    card.querySelector('[data-edit]').addEventListener('click', () => openExerciseModal(ex));
    card.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${ex.name}" de la biblioteca?`)) return;
      await api(`/api/exercises/${ex.id}`, { method: 'DELETE' });
      await loadExercises();
      renderLibrary();
      showToast('Ejercicio eliminado');
    });
    grid.appendChild(card);
  });
}

function populateCategorySelect(selectedCat = 'fuerza') {
  const sel = $('exCategory');
  const cats = getAllCategories();
  sel.innerHTML = '';
  cats.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.key;
    opt.textContent = c.label;
    sel.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Crear nueva categoría...';
  sel.appendChild(newOpt);

  const match = cats.find((c) => c.key === (selectedCat || '').toLowerCase());
  if (match) {
    sel.value = match.key;
    $('exCategoryCustom').classList.add('hidden');
    $('exCategoryCustom').value = '';
  } else if (selectedCat) {
    sel.value = '__new__';
    $('exCategoryCustom').classList.remove('hidden');
    $('exCategoryCustom').value = selectedCat;
  }
}

function updateYtSearchHref() {
  const name = $('exName').value.trim().replace(/\(GROUND\)/gi, '').trim() || 'crossfit exercise';
  $('exSearchYt').href = `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' crossfit tutorial')}`;
}

function openExerciseModal(ex = null) {
  editingExerciseId = ex ? ex.id : null;
  $('exerciseModalTitle').textContent = ex ? 'Editar Ejercicio / Vídeo / GROUND' : 'Añadir Ejercicio a la Biblioteca';
  $('exName').value = ex ? ex.name || '' : '';
  const defaultCat = ex ? ex.category : (libraryCat || 'fuerza');
  populateCategorySelect(defaultCat);
  $('exIsGround').checked = ex ? Boolean(ex.is_ground) : defaultCat === 'ground';
  $('exLevel').value = ex && ex.ground_flow_level && ex.ground_flow_level !== 'N/A' ? ex.ground_flow_level : 'Todos';
  $('exLevel').disabled = !$('exIsGround').checked;
  $('exVideo').value = ex ? ex.video_url || '' : '';
  $('exDesc').value = ex ? ex.description || '' : '';
  $('exCues').value = ex ? ex.coaching_cues || '' : '';
  updateYtSearchHref();
  openModal('exerciseModal');
}

$('exName').addEventListener('input', updateYtSearchHref);
$('exCategory').addEventListener('change', (e) => {
  const isNew = e.target.value === '__new__';
  $('exCategoryCustom').classList.toggle('hidden', !isNew);
  if (!editingExerciseId && e.target.value === 'ground') {
    $('exIsGround').checked = true;
    $('exLevel').disabled = false;
  }
});
$('exIsGround').addEventListener('change', (e) => {
  $('exLevel').disabled = !e.target.checked;
});

$('btnNewExercise').addEventListener('click', () => openExerciseModal(null));
$('btnSaveExerciseSubmit').addEventListener('click', async () => {
  const name = $('exName').value.trim();
  if (!name) return showToast('Introduce el nombre del ejercicio');

  let cat = $('exCategory').value;
  if (cat === '__new__') {
    cat = $('exCategoryCustom').value.trim().toLowerCase();
    if (!cat) return showToast('Escribe el nombre de la nueva categoría');
  }

  const isGround = $('exIsGround').checked ? 1 : 0;
  const payload = {
    name,
    category: cat,
    equipment: [],
    description: $('exDesc').value.trim(),
    coaching_cues: $('exCues').value.trim(),
    video_url: $('exVideo').value.trim(),
    is_ground: isGround,
    ground_flow_level: isGround ? $('exLevel').value : 'N/A',
  };

  try {
    if (editingExerciseId) {
      await api(`/api/exercises/${editingExerciseId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      showToast('Ejercicio actualizado');
    } else {
      const created = await api('/api/exercises', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showToast('Ejercicio añadido');
      if (state.pickerTarget) {
        pickExerciseIntoTarget(created || { ...payload, id: Date.now() });
        closeModal('pickerModal');
      }
    }
    closeModal('exerciseModal');
    await loadExercises();
    renderLibrary();
  } catch (err) {
    showToast(err.message);
  }
});

// Logs
async function loadLogs() {
  if (!state.currentMicrocycle) return;
  const logs = await api(`/api/student/logs/${state.currentMicrocycle.id}`);
  const wrap = $('logsContainer');
  if (logs.length === 0) {
    wrap.innerHTML = '<p class="muted">Todavía no hay resultados registrados en este microciclo.</p>';
    return;
  }
  wrap.innerHTML = '';
  logs.forEach((l) => {
    const box = document.createElement('div');
    box.className = 'item-box';
    box.innerHTML = `
      <div class="row-between">
        <strong>${esc(l.student_name)}</strong>
        <span class="badge badge-accent">${esc(l.score)} (${esc(l.rx_status)})</span>
      </div>
      <div class="muted">Semana ${l.week_number} · Día ${l.day_number}: ${esc(l.day_title)}</div>
      ${l.weights_used ? `<div style="font-size:0.86rem; margin-top:4px;">Pesos: ${esc(l.weights_used)}</div>` : ''}
      ${l.notes ? `<div class="muted" style="margin-top:2px;">${esc(l.notes)}</div>` : ''}
    `;
    wrap.appendChild(box);
  });
}
$('btnRefreshLogs').addEventListener('click', loadLogs);

// Share & QR Modal
async function updateShareQr() {
  await loadServerInfo();
  const info = state.serverInfo;
  const code = state.currentMicrocycle?.access_code || '';
  const url = state.qrMode === 'student'
    ? `${info.student_url}${code ? `?code=${encodeURIComponent(code)}` : ''}`
    : info.coach_url;

  $('shareUrlText').textContent = url;
  $('qrContainer').innerHTML = 'Generando QR...';
  const res = await fetch(`/api/qr?text=${encodeURIComponent(url)}`, {
    headers: { Authorization: `Bearer ${getAuthToken('coach')}` },
  });
  $('qrContainer').innerHTML = await res.text();
}

$('btnShareMobile').addEventListener('click', () => {
  openModal('shareModal');
  updateShareQr();
});

$('qrModeStudent').addEventListener('click', () => {
  state.qrMode = 'student';
  $('qrModeStudent').classList.add('selected');
  $('qrModeCoach').classList.remove('selected');
  updateShareQr();
});
$('qrModeCoach').addEventListener('click', () => {
  state.qrMode = 'coach';
  $('qrModeCoach').classList.add('selected');
  $('qrModeStudent').classList.remove('selected');
  updateShareQr();
});
$('btnCopyShareUrl').addEventListener('click', async () => {
  const txt = $('shareUrlText').textContent;
  await navigator.clipboard.writeText(txt).catch(() => {});
  showToast('Enlace copiado');
});

// ================= STUDENTS APPROVAL & MANAGEMENT =================
async function loadStudents() {
  try {
    state.students = await api('/api/coach/students');
    renderStudentsTab();
  } catch (err) {
    if (err.status === 401) clearAuthToken('coach');
  }
}

function buildMicrocycleOptionsHtml(selectedId) {
  const opts = [`<option value="">Todos los microciclos activos</option>`];
  (state.microcycles || []).forEach((mc) => {
    const sel = Number(selectedId) === Number(mc.id) ? 'selected' : '';
    opts.push(`<option value="${mc.id}" ${sel}>${esc(mc.name)} (${esc(mc.access_code)})</option>`);
  });
  return opts.join('');
}

function renderStudentsTab() {
  const students = state.students || [];
  const pending = students.filter((s) => s.status === 'pending');
  const others = students.filter((s) => s.status !== 'pending');

  const badge = $('pendingStudentsBadge');
  if (badge) {
    badge.textContent = String(pending.length);
    badge.classList.toggle('hidden', pending.length === 0);
  }

  const pWrap = $('pendingStudentsList');
  if (pWrap) {
    if (pending.length === 0) {
      pWrap.innerHTML = '<p class="muted">No hay solicitudes pendientes en este momento.</p>';
    } else {
      pWrap.innerHTML = '';
      pending.forEach((s) => {
        const box = document.createElement('div');
        box.className = 'item-box';
        box.style.borderColor = 'rgba(255, 107, 53, 0.45)';
        box.innerHTML = `
          <div class="row-between">
            <div>
              <strong>${esc(s.full_name)}</strong>
              <span class="badge badge-orange" style="margin-left:6px;">Pendiente</span>
              <div class="muted" style="margin-top:4px;">📧 ${esc(s.email)}${s.phone ? ` · 📱 ${esc(s.phone)}` : ''}</div>
            </div>
            <div class="row-wrap">
              <select class="input" data-stu-mc style="width:auto; min-width:190px; padding:6px 10px; font-size:0.84rem;">
                ${buildMicrocycleOptionsHtml(s.assigned_microcycle_id)}
              </select>
              <button class="btn btn-primary btn-sm" data-approve>✓ Aprobar</button>
              <button class="btn btn-danger btn-sm" data-reject>✕ Rechazar</button>
            </div>
          </div>
        `;
        box.querySelector('[data-approve]').addEventListener('click', async () => {
          const mcVal = box.querySelector('[data-stu-mc]').value;
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              status: 'approved',
              assigned_microcycle_id: mcVal ? Number(mcVal) : null,
              clear_microcycle_assignment: !mcVal,
            }),
          });
          showToast(`Alumno ${s.full_name} aprobado`);
          loadStudents();
        });
        box.querySelector('[data-reject]').addEventListener('click', async () => {
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'rejected' }),
          });
          showToast(`Solicitud rechazada`);
          loadStudents();
        });
        pWrap.appendChild(box);
      });
    }
  }

  const aWrap = $('approvedStudentsList');
  if (aWrap) {
    if (others.length === 0) {
      aWrap.innerHTML = '<p class="muted">Todavía no hay alumnos aprobados.</p>';
    } else {
      aWrap.innerHTML = '';
      others.forEach((s) => {
        const isApproved = s.status === 'approved';
        const box = document.createElement('div');
        box.className = 'item-box';
        box.innerHTML = `
          <div class="row-between">
            <div>
              <strong>${esc(s.full_name)}</strong>
              <span class="badge ${isApproved ? 'badge-ground' : 'badge-danger'}" style="margin-left:6px;">
                ${isApproved ? 'Aprobado' : 'Bloqueado / Rechazado'}
              </span>
              <div class="muted" style="margin-top:4px;">📧 ${esc(s.email)}${s.phone ? ` · 📱 ${esc(s.phone)}` : ''}</div>
            </div>
            <div class="row-wrap">
              <select class="input" data-stu-mc style="width:auto; min-width:190px; padding:6px 10px; font-size:0.84rem;">
                ${buildMicrocycleOptionsHtml(s.assigned_microcycle_id)}
              </select>
              ${isApproved
                ? `<button class="btn btn-sm" data-block>Bloquear</button>`
                : `<button class="btn btn-primary btn-sm" data-reactivate>Reaprobar</button>`}
              <button class="btn btn-danger btn-sm" data-del>Eliminar</button>
            </div>
          </div>
        `;
        box.querySelector('[data-stu-mc]').addEventListener('change', async (e) => {
          const val = e.target.value;
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              assigned_microcycle_id: val ? Number(val) : null,
              clear_microcycle_assignment: !val,
            }),
          });
          showToast('Programa actualizado para el alumno');
          loadStudents();
        });
        box.querySelector('[data-block]')?.addEventListener('click', async () => {
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'rejected' }),
          });
          showToast('Acceso bloqueado');
          loadStudents();
        });
        box.querySelector('[data-reactivate]')?.addEventListener('click', async () => {
          await api(`/api/coach/students/${s.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'approved' }),
          });
          showToast('Alumno reactivado');
          loadStudents();
        });
        box.querySelector('[data-del]').addEventListener('click', async () => {
          if (!confirm(`¿Eliminar permanentemente a ${s.full_name}?`)) return;
          await api(`/api/coach/students/${s.id}`, { method: 'DELETE' });
          showToast('Alumno eliminado');
          loadStudents();
        });
        aWrap.appendChild(box);
      });
    }
  }
}

$('btnRefreshStudents')?.addEventListener('click', loadStudents);
$('btnToggleAddStudent')?.addEventListener('click', () => {
  $('manualStudentForm').classList.toggle('hidden');
});
$('btnCancelManualStudent')?.addEventListener('click', () => {
  $('manualStudentForm').classList.add('hidden');
});
$('btnCreateStudentSubmit')?.addEventListener('click', async () => {
  const full_name = $('newStuName').value.trim();
  const email = $('newStuEmail').value.trim();
  const phone = $('newStuPhone').value.trim();
  const password = $('newStuPass').value;
  if (!full_name || !email || password.length < 4) {
    return showToast('Nombre, email y contraseña (mín. 4) son obligatorios');
  }
  try {
    await api('/api/coach/students', {
      method: 'POST',
      body: JSON.stringify({ full_name, email, phone, password }),
    });
    $('newStuName').value = '';
    $('newStuEmail').value = '';
    $('newStuPhone').value = '';
    $('newStuPass').value = '';
    $('manualStudentForm').classList.add('hidden');
    showToast('Alumno creado y aprobado');
    loadStudents();
  } catch (err) {
    showToast(err.message);
  }
});

checkAuthAndBoot();
