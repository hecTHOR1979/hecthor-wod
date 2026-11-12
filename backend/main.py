import os
import io
import json
import socket
import sqlite3
from typing import List, Optional
import qrcode
import qrcode.image.svg
from fastapi import FastAPI, HTTPException, Depends, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response

from .database import get_db, init_db
from .models import (
    MicrocycleCreate, MicrocycleUpdate,
    DayUpdate, ExerciseCreate, ExerciseUpdate,
    StudentAccessRequest, StudentLogCreate,
    WodGeneratorRequest, WarmupTypeCreate,
    CoachAuthRequest, CoachChangePasswordRequest,
    StudentRegisterRequest, StudentLoginRequest,
    CoachStudentCreate, CoachStudentUpdate,
)
from .auth import (
    hash_password, verify_password,
    is_coach_configured, get_coach_username,
    verify_coach_credentials, set_coach_credentials, get_coach_token_version,
    create_token, get_current_actor, require_coach, require_student_or_coach,
)
from .wod_generator import generate_custom_wod

# Initialize DB on startup
init_db()

app = FastAPI(title="hecTHOR WOD API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")

# Helper to serialize sqlite rows with json fields parsed
def row_to_day(row: sqlite3.Row):
    d = dict(row)
    d["warmup_type"] = d.get("warmup_type") or "Movilidad GROUND"
    try:
        d["warmup_exercises"] = json.loads(d.get("warmup_exercises") or "[]")
    except Exception:
        d["warmup_exercises"] = []
    try:
        wt = json.loads(d.get("warmup_timer") or "{}")
        d["warmup_timer"] = wt if wt else {"type": "AMRAP", "minutes": 8}
    except Exception:
        d["warmup_timer"] = {"type": "AMRAP", "minutes": 8}
    try:
        d["parts"] = json.loads(d.get("parts") or "[]")
    except Exception:
        d["parts"] = []
    try:
        d["wod"] = json.loads(d.get("wod") or "{}")
    except Exception:
        d["wod"] = {}
    return d

def row_to_exercise(row: sqlite3.Row):
    d = dict(row)
    try:
        d["equipment"] = json.loads(d.get("equipment") or "[]")
    except Exception:
        d["equipment"] = []
    return d

# ================= AUTH & ACCESS CONTROL API =================

def _student_public_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    d.pop("password_hash", None)
    return d


def _get_student_microcycles(assigned_microcycle_id: Optional[int]) -> list:
    conn = get_db()
    cursor = conn.cursor()
    if assigned_microcycle_id:
        cursor.execute(
            "SELECT * FROM microcycles WHERE id = ? AND is_active = 1",
            (assigned_microcycle_id,),
        )
    else:
        cursor.execute("SELECT * FROM microcycles WHERE is_active = 1 ORDER BY id DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    for mc in rows:
        cursor.execute(
            "SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC",
            (mc["id"],),
        )
        mc["days"] = [row_to_day(d) for d in cursor.fetchall()]
    conn.close()
    return rows


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status(request: Request):
    return {
        "coach_configured": is_coach_configured(),
        "coach_username": get_coach_username(),
        "actor": get_current_actor(request),
    }


@app.post("/api/auth/coach/setup")
def coach_first_setup(req: CoachAuthRequest):
    if is_coach_configured():
        raise HTTPException(status_code=403, detail="El acceso de entrenador ya está configurado.")
    pw = (req.password or "").strip()
    if len(pw) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")
    set_coach_credentials(req.username or "coach", pw)
    token = create_token({"role": "coach", "ver": get_coach_token_version()})
    return {"token": token, "username": get_coach_username(), "message": "Contraseña de entrenador guardada."}


@app.post("/api/auth/coach/login")
def coach_login(req: CoachAuthRequest):
    if not is_coach_configured():
        raise HTTPException(status_code=400, detail="Configura primero tu contraseña de entrenador.")
    if not verify_coach_credentials(req.username or "", req.password or ""):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
    token = create_token({"role": "coach", "ver": get_coach_token_version()})
    return {"token": token, "username": get_coach_username()}


@app.post("/api/auth/coach/change-password")
def coach_change_password(req: CoachChangePasswordRequest, _coach=Depends(require_coach)):
    if os.environ.get("COACH_PASSWORD"):
        raise HTTPException(status_code=400, detail="La contraseña viene fijada por la variable de entorno COACH_PASSWORD del servidor.")
    if not verify_coach_credentials(get_coach_username(), req.current_password):
        raise HTTPException(status_code=401, detail="La contraseña actual no es correcta.")
    new_pw = (req.new_password or "").strip()
    if len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 4 caracteres.")
    set_coach_credentials(get_coach_username(), new_pw)
    token = create_token({"role": "coach", "ver": get_coach_token_version()})
    return {"token": token, "message": "Contraseña actualizada correctamente."}


# ================= COACH STUDENT APPROVALS API =================

@app.get("/api/coach/students")
def list_students(_coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT s.*, m.name AS assigned_microcycle_name, m.access_code AS assigned_access_code
        FROM students s
        LEFT JOIN microcycles m ON s.assigned_microcycle_id = m.id
        ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.id DESC
    """)
    rows = [_student_public_dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


@app.post("/api/coach/students")
def create_student_by_coach(req: CoachStudentCreate, _coach=Depends(require_coach)):
    name = req.full_name.strip()
    email = req.email.strip().lower()
    pw = req.password.strip()
    if not name or "@" not in email or len(pw) < 4:
        raise HTTPException(status_code=400, detail="Nombre, email válido y contraseña (mín. 4 caracteres) son obligatorios.")
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO students (full_name, email, phone, password_hash, status, assigned_microcycle_id, notes, approved_at)
            VALUES (?, ?, ?, ?, 'approved', ?, ?, CURRENT_TIMESTAMP)
        """, (name, email, (req.phone or "").strip(), hash_password(pw), req.assigned_microcycle_id, req.notes or ""))
        conn.commit()
        sid = cursor.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Ya existe un alumno con ese email.")
    conn.close()
    return {"id": sid, "message": "Alumno dado de alta y aprobado."}


@app.put("/api/coach/students/{student_id}")
def update_student_by_coach(student_id: int, req: CoachStudentUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    fields = []
    values = []
    if req.status is not None:
        st = req.status.strip().lower()
        if st not in ("pending", "approved", "rejected"):
            conn.close()
            raise HTTPException(status_code=400, detail="Estado no válido.")
        fields.append("status = ?")
        values.append(st)
        if st == "approved":
            fields.append("approved_at = CURRENT_TIMESTAMP")
    if req.clear_microcycle_assignment:
        fields.append("assigned_microcycle_id = NULL")
    elif req.assigned_microcycle_id is not None:
        fields.append("assigned_microcycle_id = ?")
        values.append(req.assigned_microcycle_id)
    if req.notes is not None:
        fields.append("notes = ?")
        values.append(req.notes)

    if not fields:
        conn.close()
        return {"message": "Sin cambios"}

    values.append(student_id)
    cursor.execute(f"UPDATE students SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Alumno no encontrado.")
    conn.close()
    return {"message": "Alumno actualizado correctamente."}


@app.delete("/api/coach/students/{student_id}")
def delete_student_by_coach(student_id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM students WHERE id = ?", (student_id,))
    conn.commit()
    conn.close()
    return {"message": "Alumno eliminado."}


# ================= MICROCYCLES API =================

@app.get("/api/microcycles")
def list_microcycles(_coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT m.*, COUNT(d.id) as total_programmed_days 
        FROM microcycles m
        LEFT JOIN days d ON m.id = d.microcycle_id
        GROUP BY m.id
        ORDER BY m.id DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/microcycles")
def create_microcycle(m: MicrocycleCreate, _coach=Depends(require_coach)):
    import datetime as _dt
    today = _dt.date.today()
    default_monday = (today - _dt.timedelta(days=today.weekday())).isoformat()
    start_date = (m.start_date or "").strip() or default_monday

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO microcycles (name, weeks_count, days_per_week, primary_goal, description, access_code, start_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (m.name, m.weeks_count, m.days_per_week, m.primary_goal, m.description or "", m.access_code.upper().strip(), start_date))
        microcycle_id = cursor.lastrowid

        # Generate template blank days for this microcycle
        for w in range(1, m.weeks_count + 1):
            for d in range(1, m.days_per_week + 1):
                cursor.execute("""
                    INSERT INTO days (microcycle_id, week_number, day_number, title, warmup_notes, warmup_exercises, parts, wod, coaching_tips)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    microcycle_id, w, d, f"Semana {w} - Día {d}",
                    "Calentamiento general y movilidad articular GROUND",
                    json.dumps([]), json.dumps([]), json.dumps({
                        "title": f"WOD Día {d}",
                        "type": "AMRAP",
                        "time_cap": "15 Minutos",
                        "description": "Configura el WOD para este día",
                        "rx_weights": "",
                        "scaled_weights": "",
                        "target_score": "",
                        "strategy": ""
                    }),
                    ""
                ))
        conn.commit()
        return {"id": microcycle_id, "message": "Microciclo creado correctamente con todas sus sesiones"}
    except sqlite3.IntegrityError as e:
        conn.close()
        raise HTTPException(status_code=400, detail="El código de acceso ya existe. Elige otro código único.")
    finally:
        conn.close()

@app.get("/api/microcycles/{id}")
def get_microcycle(id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM microcycles WHERE id = ?", (id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Microciclo no encontrado")

    microcycle = dict(row)

    # Fetch days
    cursor.execute("SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC", (id,))
    day_rows = cursor.fetchall()
    microcycle["days"] = [row_to_day(d) for d in day_rows]
    conn.close()
    return microcycle

@app.put("/api/microcycles/{id}")
def update_microcycle(id: int, u: MicrocycleUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    fields = []
    values = []
    if u.name is not None:
        fields.append("name = ?")
        values.append(u.name)
    if u.weeks_count is not None:
        fields.append("weeks_count = ?")
        values.append(u.weeks_count)
    if u.days_per_week is not None:
        fields.append("days_per_week = ?")
        values.append(u.days_per_week)
    if u.primary_goal is not None:
        fields.append("primary_goal = ?")
        values.append(u.primary_goal)
    if u.description is not None:
        fields.append("description = ?")
        values.append(u.description)
    if u.access_code is not None:
        fields.append("access_code = ?")
        values.append(u.access_code.upper().strip())
    if u.start_date is not None:
        fields.append("start_date = ?")
        values.append(u.start_date.strip())
    if u.is_active is not None:
        fields.append("is_active = ?")
        values.append(u.is_active)

    if not fields:
        conn.close()
        return {"message": "Sin cambios"}

    values.append(id)
    query = f"UPDATE microcycles SET {', '.join(fields)} WHERE id = ?"
    try:
        cursor.execute(query, values)
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="El código de acceso ya está en uso por otro microciclo")
    finally:
        conn.close()

    return {"message": "Microciclo actualizado con éxito"}

@app.delete("/api/microcycles/{id}")
def delete_microcycle(id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM microcycles WHERE id = ?", (id,))
    cursor.execute("DELETE FROM days WHERE microcycle_id = ?", (id,))
    cursor.execute("DELETE FROM student_logs WHERE microcycle_id = ?", (id,))
    conn.commit()
    conn.close()
    return {"message": "Microciclo y sus sesiones eliminados"}

# ================= DAYS API =================

@app.get("/api/days/{day_id}")
def get_day(day_id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM days WHERE id = ?", (day_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Día no encontrado")
    return row_to_day(row)

@app.put("/api/days/{day_id}")
def update_day(day_id: int, d: DayUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE days 
        SET title = ?, warmup_type = ?, warmup_notes = ?, warmup_exercises = ?, warmup_timer = ?, parts = ?, wod = ?, coaching_tips = ?
        WHERE id = ?
    """, (
        d.title,
        (d.warmup_type or "Movilidad GROUND").strip(),
        d.warmup_notes or "",
        json.dumps(d.warmup_exercises or []),
        json.dumps(d.warmup_timer or {"type": "AMRAP", "minutes": 8}),
        json.dumps(d.parts or []),
        json.dumps(d.wod or {}),
        d.coaching_tips or "",
        day_id
    ))
    conn.commit()
    conn.close()
    return {"message": "Día guardado correctamente"}

@app.get("/api/warmup-types")
def list_warmup_types(_actor=Depends(require_student_or_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name FROM warmup_types ORDER BY id ASC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

@app.post("/api/warmup-types")
def create_warmup_type(wt: WarmupTypeCreate, _coach=Depends(require_coach)):
    name = wt.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="El tipo de Warm Up no puede estar vacío")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO warmup_types (name) VALUES (?)", (name,))
    conn.commit()
    cursor.execute("SELECT id, name FROM warmup_types WHERE name = ?", (name,))
    row = dict(cursor.fetchone())
    conn.close()
    return row

@app.post("/api/days/copy")
def copy_day(source_day_id: int, target_day_id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT warmup_type, warmup_notes, warmup_exercises, warmup_timer, parts, wod, coaching_tips FROM days WHERE id = ?", (source_day_id,))
    source = cursor.fetchone()
    if not source:
        conn.close()
        raise HTTPException(status_code=404, detail="Día de origen no encontrado")

    cursor.execute("""
        UPDATE days
        SET warmup_type = ?, warmup_notes = ?, warmup_exercises = ?, warmup_timer = ?, parts = ?, wod = ?, coaching_tips = ?
        WHERE id = ?
    """, (source[0], source[1], source[2], source[3], source[4], source[5], source[6], target_day_id))
    conn.commit()
    conn.close()
    return {"message": "Sesión duplicada en el día destino"}

# ================= EXERCISES & VIDEOS API =================

@app.get("/api/exercises")
def list_exercises(category: Optional[str] = None, ground_only: Optional[int] = None, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM exercises WHERE 1=1"
    params = []

    if ground_only:
        query += " AND is_ground = 1"
    elif category:
        query += " AND category = ?"
        params.append(category)

    query += " ORDER BY is_ground DESC, name ASC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [row_to_exercise(r) for r in rows]

@app.post("/api/exercises")
def create_exercise(ex: ExerciseCreate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO exercises (name, category, equipment, description, coaching_cues, video_url, is_ground, ground_flow_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        ex.name, ex.category, json.dumps(ex.equipment or []),
        ex.description or "", ex.coaching_cues or "",
        ex.video_url or "", ex.is_ground or 0, ex.ground_flow_level or "Todos"
    ))
    conn.commit()
    ex_id = cursor.lastrowid
    conn.close()
    return {"id": ex_id, "message": "Ejercicio añadido a la biblioteca"}

@app.put("/api/exercises/{id}")
def update_exercise(id: int, ex: ExerciseUpdate, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    fields = []
    values = []
    if ex.name is not None:
        fields.append("name = ?")
        values.append(ex.name.strip())
    if ex.category is not None:
        fields.append("category = ?")
        values.append(ex.category.strip())
    if ex.equipment is not None:
        fields.append("equipment = ?")
        values.append(json.dumps(ex.equipment))
    if ex.description is not None:
        fields.append("description = ?")
        values.append(ex.description)
    if ex.coaching_cues is not None:
        fields.append("coaching_cues = ?")
        values.append(ex.coaching_cues)
    if ex.video_url is not None:
        fields.append("video_url = ?")
        values.append(ex.video_url.strip())
    if ex.is_ground is not None:
        fields.append("is_ground = ?")
        values.append(1 if ex.is_ground else 0)
    if ex.ground_flow_level is not None:
        fields.append("ground_flow_level = ?")
        values.append(ex.ground_flow_level)

    if not fields:
        conn.close()
        return {"message": "Sin cambios"}

    values.append(id)
    cursor.execute(f"UPDATE exercises SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Ejercicio no encontrado")
    conn.close()
    return {"message": "Ejercicio actualizado correctamente"}

@app.delete("/api/exercises/{id}")
def delete_exercise(id: int, _coach=Depends(require_coach)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM exercises WHERE id = ?", (id,))
    conn.commit()
    conn.close()
    return {"message": "Ejercicio eliminado"}

# ================= WOD GENERATOR API =================

@app.post("/api/generate-wod")
def generate_wod_endpoint(req: WodGeneratorRequest, _coach=Depends(require_coach)):
    wod = generate_custom_wod(
        equipment_available=req.equipment,
        time_minutes=req.time_minutes,
        wod_type=req.wod_type,
        goal=req.goal or "Híbrido"
    )
    return wod

# ================= STUDENT / ALUMNOS PORTAL API =================

@app.post("/api/student/register")
def student_register(req: StudentRegisterRequest):
    name = (req.full_name or "").strip()
    email = (req.email or "").strip().lower()
    pw = (req.password or "").strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Introduce tu nombre completo.")
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Introduce un correo electrónico válido.")
    if len(pw) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")

    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO students (full_name, email, phone, password_hash, status)
            VALUES (?, ?, ?, ?, 'pending')
        """, (name, email, (req.phone or "").strip(), hash_password(pw)))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Ya existe una solicitud o cuenta registrada con ese correo.")
    conn.close()
    return {"message": "Solicitud enviada correctamente. Tu entrenador revisará tu alta para darte acceso."}


@app.post("/api/student/login")
def student_login(req: StudentLoginRequest):
    email = (req.email or "").strip().lower()
    pw = req.password or ""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM students WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()

    if not row or not verify_password(pw, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Correo o contraseña incorrectos.")
    if row["status"] == "pending":
        raise HTTPException(status_code=403, detail="Tu alta está pendiente de aprobación por tu entrenador.")
    if row["status"] != "approved":
        raise HTTPException(status_code=403, detail="Tu acceso no está habilitado. Contacta con tu entrenador.")

    token = create_token({"role": "student", "student_id": row["id"]})
    microcycles = _get_student_microcycles(row["assigned_microcycle_id"])
    return {
        "token": token,
        "student": _student_public_dict(row),
        "microcycles": microcycles,
    }


@app.get("/api/student/me")
def student_me(actor=Depends(require_student_or_coach)):
    assigned_id = actor.get("assigned_microcycle_id") if actor["role"] == "student" else None
    microcycles = _get_student_microcycles(assigned_id)
    return {
        "actor": actor,
        "microcycles": microcycles,
    }


@app.post("/api/student/verify")
def student_verify(req: StudentAccessRequest, actor=Depends(require_student_or_coach)):
    code = req.access_code.upper().strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM microcycles WHERE access_code = ? AND is_active = 1", (code,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=403, detail="Código de acceso no válido o microciclo inactivo. Consulta a tu entrenador.")
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and row["id"] != actor["assigned_microcycle_id"]:
        conn.close()
        raise HTTPException(status_code=403, detail="No tienes acceso asignado a este microciclo.")

    microcycle = dict(row)
    cursor.execute("SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC", (microcycle["id"],))
    day_rows = cursor.fetchall()
    microcycle["days"] = [row_to_day(d) for d in day_rows]
    conn.close()
    return microcycle

@app.post("/api/student/log")
def submit_student_log(log: StudentLogCreate, actor=Depends(require_student_or_coach)):
    student_name = actor["full_name"] if actor["role"] == "student" else log.student_name.strip()
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and log.microcycle_id != actor["assigned_microcycle_id"]:
        raise HTTPException(status_code=403, detail="No puedes registrar marcas en este microciclo.")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO student_logs (microcycle_id, day_id, student_name, score, rx_status, weights_used, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        log.microcycle_id, log.day_id, student_name,
        log.score.strip(), log.rx_status or "Rx",
        log.weights_used or "", log.notes or ""
    ))
    conn.commit()
    log_id = cursor.lastrowid
    conn.close()
    return {"id": log_id, "message": "¡Resultado registrado con éxito!"}

@app.get("/api/student/logs/{microcycle_id}")
def get_student_logs(microcycle_id: int, day_id: Optional[int] = None, actor=Depends(require_student_or_coach)):
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and microcycle_id != actor["assigned_microcycle_id"]:
        raise HTTPException(status_code=403, detail="Sin acceso a los registros de este microciclo.")
    conn = get_db()
    cursor = conn.cursor()
    if day_id:
        cursor.execute("""
            SELECT l.*, d.title as day_title, d.week_number, d.day_number
            FROM student_logs l
            JOIN days d ON l.day_id = d.id
            WHERE l.microcycle_id = ? AND l.day_id = ?
            ORDER BY l.id DESC
        """, (microcycle_id, day_id))
    else:
        cursor.execute("""
            SELECT l.*, d.title as day_title, d.week_number, d.day_number
            FROM student_logs l
            JOIN days d ON l.day_id = d.id
            WHERE l.microcycle_id = ?
            ORDER BY l.id DESC
        """, (microcycle_id,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ================= SERVER INFO (IP LAN PARA MÓVIL) =================

def _get_lan_ips() -> List[str]:
    ips: List[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("8.8.8.8", 80))
        primary = s.getsockname()[0]
        s.close()
        if primary and not primary.startswith(("127.", "169.254.")):
            ips.append(primary)
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith(("127.", "169.254.")) and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips

@app.get("/api/server-info")
def get_server_info(request: Request, _coach=Depends(require_coach)):
    ips = _get_lan_ips()
    port = request.url.port or 8000
    primary_ip = ips[0] if ips else "127.0.0.1"
    host = (request.url.hostname or "").lower()
    is_public = host not in ("127.0.0.1", "localhost", "") and not host.startswith(("192.168.", "10.", "172."))
    if is_public:
        base = str(request.base_url).rstrip("/")
        coach_url = f"{base}/"
        student_url = f"{base}/alumnos"
    else:
        coach_url = f"http://{primary_ip}:{port}/"
        student_url = f"http://{primary_ip}:{port}/alumnos"
    return {
        "primary_ip": primary_ip,
        "all_ips": ips,
        "port": port,
        "coach_url": coach_url,
        "student_url": student_url,
    }

@app.get("/api/qr")
def generate_qr_svg(text: str = Query(..., min_length=1, max_length=500), _coach=Depends(require_coach)):
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return Response(content=buf.getvalue(), media_type="image/svg+xml")

# ================= STATIC FILE SERVING =================

@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(os.path.join(STATIC_DIR, "manifest.json"), media_type="application/manifest+json")

@app.get("/sw.js")
def serve_sw():
    return FileResponse(os.path.join(STATIC_DIR, "sw.js"), media_type="application/javascript")

@app.get("/icon.svg")
def serve_icon():
    return FileResponse(os.path.join(STATIC_DIR, "icon.svg"), media_type="image/svg+xml")

@app.get("/icon-192.png")
def serve_icon_192():
    return FileResponse(os.path.join(STATIC_DIR, "img", "icon-192.png"), media_type="image/png")

@app.get("/icon-512.png")
def serve_icon_512():
    return FileResponse(os.path.join(STATIC_DIR, "img", "icon-512.png"), media_type="image/png")

@app.get("/app-icon.jpg")
def serve_app_icon():
    return FileResponse(os.path.join(STATIC_DIR, "img", "app-icon.jpg"), media_type="image/jpeg")

@app.get("/")
@app.get("/ui")
@app.get("/ui/")
def serve_coach_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))

@app.get("/alumnos")
@app.get("/alumnos.html")
@app.get("/alumno")
@app.get("/ui/alumnos")
def serve_student_index():
    return FileResponse(os.path.join(STATIC_DIR, "alumnos.html"))

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ================= MICROCYCLER POR CÓDIGO =================
@app.get("/api/microcycles/code/{access_code}")
def get_microcycle_by_code(access_code: str, actor=Depends(require_student_or_coach)):
    """Devuelve el microciclo completo (con días) usando el código de acceso.
    Solo accesible para alumnos aprobados o entrenador.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM microcycles WHERE access_code = ? AND is_active = 1",
        (access_code.upper().strip(),)
    )
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Código de acceso no válido o microciclo inactivo.")
    if actor["role"] == "student" and actor.get("assigned_microcycle_id") and row["id"] != actor["assigned_microcycle_id"]:
        conn.close()
        raise HTTPException(status_code=403, detail="No tienes acceso asignado a este microciclo.")
    microcycle = dict(row)
    cursor.execute(
        "SELECT * FROM days WHERE microcycle_id = ? ORDER BY week_number ASC, day_number ASC",
        (microcycle["id"],)
    )
    day_rows = cursor.fetchall()
    microcycle["days"] = [row_to_day(d) for d in day_rows]
    conn.close()
    return microcycle
