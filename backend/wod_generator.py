import random
from typing import List, Dict, Any, Optional

MOVEMENT_DATABASE = [
    # Barbell movements
    {
        "name": "Thrusters",
        "equipment": ["Barra olímpica", "Discos"],
        "category": "weightlifting",
        "skills": ["Thrusters", "Barra", "Halterofilia", "Squat"],
        "rx_m": "43 kg",
        "rx_f": "30 kg",
        "reps_amrap": 10,
        "reps_emom": 8,
        "reps_ft": 21,
    },
    {
        "name": "Power Cleans",
        "equipment": ["Barra olímpica", "Discos"],
        "category": "weightlifting",
        "skills": ["Clean", "Clean & Jerk", "Cargadas", "Barra", "Halterofilia"],
        "rx_m": "60 kg",
        "rx_f": "40 kg",
        "reps_amrap": 8,
        "reps_emom": 6,
        "reps_ft": 15,
    },
    {
        "name": "Power Snatches",
        "equipment": ["Barra olímpica", "Discos"],
        "category": "weightlifting",
        "skills": ["Snatch", "Arrancada", "Barra", "Halterofilia"],
        "rx_m": "50 kg",
        "rx_f": "35 kg",
        "reps_amrap": 8,
        "reps_emom": 5,
        "reps_ft": 12,
    },
    {
        "name": "Push Jerks",
        "equipment": ["Barra olímpica", "Discos"],
        "category": "weightlifting",
        "skills": ["Jerk", "Clean & Jerk", "Barra", "Halterofilia"],
        "rx_m": "50 kg",
        "rx_f": "35 kg",
        "reps_amrap": 10,
        "reps_emom": 7,
        "reps_ft": 15,
    },
    {
        "name": "Deadlifts",
        "equipment": ["Barra olímpica", "Discos"],
        "category": "weightlifting",
        "skills": ["Deadlift", "Peso Muerto", "Barra"],
        "rx_m": "100 kg",
        "rx_f": "70 kg",
        "reps_amrap": 12,
        "reps_emom": 8,
        "reps_ft": 21,
    },
    {
        "name": "Overhead Squats",
        "equipment": ["Barra olímpica", "Discos"],
        "category": "weightlifting",
        "skills": ["Overhead Squats", "OHS", "Snatch", "Barra", "Halterofilia"],
        "rx_m": "50 kg",
        "rx_f": "35 kg",
        "reps_amrap": 8,
        "reps_emom": 6,
        "reps_ft": 12,
    },

    # Dumbbell / Kettlebell movements
    {
        "name": "Dumbbell Snatches alternos",
        "equipment": ["Mancuernas"],
        "category": "weightlifting",
        "skills": ["Snatch", "Dumbbell Snatch", "Mancuernas"],
        "rx_m": "22.5 kg",
        "rx_f": "15 kg",
        "reps_amrap": 14,
        "reps_emom": 12,
        "reps_ft": 20,
    },
    {
        "name": "Dumbbell Thrusters",
        "equipment": ["Mancuernas"],
        "category": "weightlifting",
        "skills": ["Thrusters", "Mancuernas"],
        "rx_m": "2x 17.5 kg",
        "rx_f": "2x 12.5 kg",
        "reps_amrap": 10,
        "reps_emom": 8,
        "reps_ft": 15,
    },
    {
        "name": "Dumbbell Box Step-overs",
        "equipment": ["Mancuernas", "Cajón"],
        "category": "metcon",
        "skills": ["Box Jump Overs", "Cajón", "Mancuernas"],
        "rx_m": "2x 15 kg",
        "rx_f": "2x 10 kg",
        "reps_amrap": 10,
        "reps_emom": 8,
        "reps_ft": 12,
    },
    {
        "name": "Kettlebell Swings Americanos",
        "equipment": ["Kettlebells"],
        "category": "weightlifting",
        "skills": ["Kettlebell Swings", "Kettlebells"],
        "rx_m": "24 kg",
        "rx_f": "16 kg",
        "reps_amrap": 16,
        "reps_emom": 14,
        "reps_ft": 25,
    },
    {
        "name": "Goblet Squats",
        "equipment": ["Kettlebells"],
        "category": "weightlifting",
        "skills": ["Kettlebells", "Squat"],
        "rx_m": "24 kg",
        "rx_f": "16 kg",
        "reps_amrap": 15,
        "reps_emom": 12,
        "reps_ft": 20,
    },

    # Gymnastic movements
    {
        "name": "Pull-ups (Dominadas)",
        "equipment": ["Barra de dominadas"],
        "category": "gymnastics",
        "skills": ["Pull-ups", "Dominadas", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 12,
        "reps_emom": 10,
        "reps_ft": 15,
    },
    {
        "name": "Chest-to-Bar Pull-ups",
        "equipment": ["Barra de dominadas"],
        "category": "gymnastics",
        "skills": ["Chest-to-Bar", "C2B", "Pull-ups", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 9,
        "reps_emom": 7,
        "reps_ft": 12,
    },
    {
        "name": "Toes-to-Bar (T2B)",
        "equipment": ["Barra de dominadas"],
        "category": "gymnastics",
        "skills": ["Toes-to-Bar (T2B)", "Toes-to-Bar", "T2B", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 12,
        "reps_emom": 10,
        "reps_ft": 15,
    },
    {
        "name": "Bar Muscle-ups",
        "equipment": ["Barra de dominadas"],
        "category": "gymnastics",
        "skills": ["Bar Muscle-ups", "Muscle-ups", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 4,
        "reps_emom": 3,
        "reps_ft": 6,
    },
    {
        "name": "Ring Muscle-ups",
        "equipment": ["Anillas"],
        "category": "gymnastics",
        "skills": ["Ring Muscle-ups", "Muscle-ups", "Anillas", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 4,
        "reps_emom": 3,
        "reps_ft": 5,
    },
    {
        "name": "Handstand Push-ups (HSPU)",
        "equipment": ["Sin material"],
        "category": "gymnastics",
        "skills": ["Handstand Push-ups (HSPU)", "HSPU", "Pino", "Gimnásticos"],
        "rx_m": "Pared",
        "rx_f": "Pared",
        "reps_amrap": 10,
        "reps_emom": 8,
        "reps_ft": 12,
    },
    {
        "name": "Handstand Walk (HSW)",
        "equipment": ["Sin material"],
        "category": "gymnastics",
        "skills": ["Handstand Walk (HSW)", "HSW", "Pino", "Gimnásticos"],
        "rx_m": "10 m",
        "rx_f": "10 m",
        "reps_amrap": 10,
        "reps_emom": 10,
        "reps_ft": 20,
    },
    {
        "name": "Push-ups (Flexiones)",
        "equipment": ["Sin material"],
        "category": "gymnastics",
        "skills": ["Push-ups", "Flexiones", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 15,
        "reps_emom": 12,
        "reps_ft": 20,
    },
    {
        "name": "Pistols (Sentadilla a una pierna)",
        "equipment": ["Sin material"],
        "category": "gymnastics",
        "skills": ["Pistols", "Pistol Squat", "Gimnásticos"],
        "rx_m": "Alterno",
        "rx_f": "Alterno",
        "reps_amrap": 12,
        "reps_emom": 10,
        "reps_ft": 16,
    },
    {
        "name": "Ring Dips (Fondos en anillas)",
        "equipment": ["Anillas"],
        "category": "gymnastics",
        "skills": ["Ring Dips", "Fondos", "Anillas", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 8,
        "reps_emom": 7,
        "reps_ft": 12,
    },

    # Monostructural & Bodyweight
    {
        "name": "Double Unders (Saltos Dobles)",
        "equipment": ["Comba / Cuerda"],
        "category": "monostructural",
        "skills": ["Double Unders", "Comba", "Saltos Dobles"],
        "rx_m": "Comba",
        "rx_f": "Comba",
        "reps_amrap": 40,
        "reps_emom": 35,
        "reps_ft": 50,
    },
    {
        "name": "Burpees sobre la barra / suelo",
        "equipment": ["Sin material"],
        "category": "metcon",
        "skills": ["Burpees"],
        "rx_m": "Pecho al suelo",
        "rx_f": "Pecho al suelo",
        "reps_amrap": 12,
        "reps_emom": 10,
        "reps_ft": 15,
    },
    {
        "name": "Box Jumps / Box Jump Overs",
        "equipment": ["Cajón"],
        "category": "metcon",
        "skills": ["Box Jump Overs", "Box Jumps", "Cajón"],
        "rx_m": "24\"",
        "rx_f": "20\"",
        "reps_amrap": 12,
        "reps_emom": 10,
        "reps_ft": 15,
    },
    {
        "name": "Wall Ball Shots",
        "equipment": ["Wall Ball"],
        "category": "metcon",
        "skills": ["Wall Balls", "Wall Ball Shots"],
        "rx_m": "9 kg (3m)",
        "rx_f": "6 kg (2.7m)",
        "reps_amrap": 15,
        "reps_emom": 14,
        "reps_ft": 20,
    },
    {
        "name": "Remo Concept2 (Calorías)",
        "equipment": ["Remo"],
        "category": "monostructural",
        "skills": ["Remo", "Cardio"],
        "rx_m": "15 Cal",
        "rx_f": "12 Cal",
        "reps_amrap": 15,
        "reps_emom": 12,
        "reps_ft": 20,
    },
    {
        "name": "EcoBike (Calorías)",
        "equipment": ["EcoBike"],
        "category": "monostructural",
        "skills": ["EcoBike", "Cardio"],
        "rx_m": "14 Cal",
        "rx_f": "10 Cal",
        "reps_amrap": 12,
        "reps_emom": 10,
        "reps_ft": 15,
    },
    {
        "name": "Ski Erg (Calorías)",
        "equipment": ["Ski Erg"],
        "category": "monostructural",
        "skills": ["Ski Erg", "Cardio"],
        "rx_m": "15 Cal",
        "rx_f": "12 Cal",
        "reps_amrap": 15,
        "reps_emom": 12,
        "reps_ft": 20,
    },
    {
        "name": "Bike Erg (Calorías)",
        "equipment": ["Bike Erg"],
        "category": "monostructural",
        "skills": ["Bike Erg", "Cardio"],
        "rx_m": "20 Cal",
        "rx_f": "15 Cal",
        "reps_amrap": 18,
        "reps_emom": 15,
        "reps_ft": 25,
    },
    {
        "name": "Rope Climbs (Subidas a cuerda)",
        "equipment": ["Rope"],
        "category": "gymnastics",
        "skills": ["Rope Climbs", "Cuerda", "Gimnásticos"],
        "rx_m": "4.5 m",
        "rx_f": "4.5 m",
        "reps_amrap": 2,
        "reps_emom": 2,
        "reps_ft": 3,
    },
    {
        "name": "Air Squats (Sentadillas al aire)",
        "equipment": ["Sin material"],
        "category": "metcon",
        "skills": ["Air Squats", "Squat"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 20,
        "reps_emom": 18,
        "reps_ft": 30,
    },
    {
        "name": "V-Ups / Abdominales",
        "equipment": ["Sin material"],
        "category": "gymnastics",
        "skills": ["V-Ups", "Core", "Abdominales", "Gimnásticos"],
        "rx_m": "Sin peso",
        "rx_f": "Sin peso",
        "reps_amrap": 15,
        "reps_emom": 12,
        "reps_ft": 20,
    },
]

def generate_custom_wod(
    equipment_available: List[str],
    time_minutes: int,
    wod_type: str,
    goal: str = "Híbrido",
    skills: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Compone inteligentemente un WOD balanceado según material, tiempo, tipo y habilidades (skills) deseadas.
    """
    has_all_bodyweight = "Sin material" in equipment_available or len(equipment_available) == 0

    available_moves = []
    for m in MOVEMENT_DATABASE:
        needed = m["equipment"]
        if all(item in equipment_available for item in needed) or ("Sin material" in needed and has_all_bodyweight):
            available_moves.append(m)

    if len(available_moves) < 2:
        available_moves = [m for m in MOVEMENT_DATABASE if "Sin material" in m["equipment"]]

    selected_moves = []
    used_names = set()

    # 1. Si el usuario seleccionó skills técnicas, se limita exclusivamente a ellas
    active_skills = [s.strip() for s in (skills or []) if s and s.strip()]
    if active_skills:
        for skill_name in active_skills:
            s_lower = skill_name.lower()
            matched = None
            for m in available_moves:
                if m["name"] in used_names:
                    continue
                m_skills = [sk.lower() for sk in m.get("skills", [])]
                if s_lower in m["name"].lower() or any(s_lower in sk for sk in m_skills):
                    matched = m
                    break
            if matched:
                selected_moves.append(matched)
                used_names.add(matched["name"])
            else:
                # Skill custom añadida por el usuario no en la lista de movimientos: inyectarla directamente
                custom_move = {
                    "name": skill_name,
                    "equipment": ["Sin material"],
                    "category": "metcon",
                    "skills": [skill_name],
                    "rx_m": "Rx",
                    "rx_f": "Rx",
                    "reps_amrap": 10,
                    "reps_emom": 8,
                    "reps_ft": 15
                }
                selected_moves.append(custom_move)
                used_names.add(skill_name)
    else:
        # 2. Si no se seleccionaron skills específicas, autocompletar con movimientos variados (weightlifting, gymnastics, mono)
        target_count = 3 if time_minutes >= 12 else 2
        shuffled = list(available_moves)
        random.shuffle(shuffled)
        for m in shuffled:
            if m["name"] not in used_names:
                selected_moves.append(m)
                used_names.add(m["name"])
            if len(selected_moves) >= target_count:
                break

    wt = wod_type.strip().upper()
    if wt == "AMRAP":
        return build_amrap(selected_moves, time_minutes, goal)
    elif wt == "EMOM":
        return build_emom(selected_moves, time_minutes, goal)
    elif wt == "TABATA":
        return build_tabata(selected_moves)
    elif wt == "CHIPPER":
        return build_chipper(selected_moves, time_minutes)
    elif wt == "ENDURANCE":
        return build_endurance(selected_moves, time_minutes, goal)
    elif wt in ("FOR TIME", "FORTIME", "FT"):
        return build_for_time(selected_moves, time_minutes, goal)
    else:
        return build_custom_wod_style(wod_type, selected_moves, time_minutes, goal)

def build_amrap(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []
    exercises = []

    for m in moves:
        reps = m.get("reps_amrap", 10)
        lines.append(f"- {reps} {m['name']}")
        rx_cue = ""
        if m.get("rx_m") and m["rx_m"] not in ("Sin peso", "Comba", "Rx"):
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: -35% carga")
            rx_cue = f"Rx: {m['rx_m']} / {m['rx_f']}"
        exercises.append({
            "sets": "",
            "reps": str(reps),
            "name": m["name"],
            "video_url": m.get("video_url", ""),
            "notes": rx_cue,
            "sub_exercises": []
        })

    description = "\n".join(lines)
    title = random.choice(['Iron Will', 'Velocity', 'Apex Predator', 'Engine Lab', 'Tormenta', 'Thunderstrike'])
    est_rounds = max(3, int(minutes / (len(moves) * 0.85)))

    return {
        "title": title,
        "type": f"AMRAP ({minutes} min)",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Peso corporal Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Ajustar repeticiones al 75%",
        "target_score": f"{est_rounds} a {est_rounds + 2} rondas completas",
        "strategy": "Pacing sostenible y transiciones rápidas.",
        "exercises": exercises,
    }

def build_emom(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    stations = len(moves)
    include_rest = (minutes % (stations + 1) == 0 and stations >= 3)
    cycle_len = stations + (1 if include_rest else 0)

    lines = []
    rx_notes = []
    scaled_notes = []
    exercises = []

    for i, m in enumerate(moves, 1):
        reps = m.get("reps_emom", 8)
        lines.append(f"- Minuto {i}: {reps} {m['name']}")
        rx_cue = ""
        if m.get("rx_m") and m["rx_m"] not in ("Sin peso", "Rx"):
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: reducir 2-3 reps")
            rx_cue = f"Rx: {m['rx_m']} / {m['rx_f']}"
        exercises.append({
            "sets": f"Min {i}",
            "reps": str(reps),
            "name": m["name"],
            "video_url": m.get("video_url", ""),
            "notes": rx_cue,
            "sub_exercises": []
        })

    if include_rest:
        lines.append(f"- Minuto {cycle_len}: Descanso activo")

    description = "\n".join(lines)
    title = random.choice(['On The Clock', 'Minute Crunch', 'Pacing Test', 'Precision', 'Chronos'])

    return {
        "title": title,
        "type": f"EMOM ({minutes} min)",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Adaptar repeticiones a 40s trabajo / 20s descanso",
        "target_score": "Completar todos los intervalos dentro del minuto.",
        "strategy": "Ritmo constante desde el primer minuto.",
        "exercises": exercises,
    }

def build_for_time(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []
    exercises = []

    if len(moves) == 2 and minutes <= 14:
        for m in moves:
            rx_cue = ""
            if m.get("rx_m") and m["rx_m"] not in ("Sin peso", "Rx"):
                rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
                scaled_notes.append(f"{m['name']}: carga adaptada")
                rx_cue = f"Rx: {m['rx_m']} / {m['rx_f']}"
            exercises.append({
                "sets": "",
                "reps": "21-15-9",
                "name": m["name"],
                "video_url": m.get("video_url", ""),
                "notes": rx_cue,
                "sub_exercises": []
            })
        description = f"21 - 15 - 9 Repeticiones:\n- {moves[0]['name']}\n- {moves[1]['name']}"
        title = "Fast & Furious 21-15-9"
    else:
        num_rounds = 4 if minutes <= 16 else 5
        for m in moves:
            reps = m.get("reps_ft", 15)
            lines.append(f"- {reps} {m['name']}")
            rx_cue = ""
            if m.get("rx_m") and m["rx_m"] not in ("Sin peso", "Rx"):
                rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
                scaled_notes.append(f"{m['name']}: carga moderada escalada")
                rx_cue = f"Rx: {m['rx_m']} / {m['rx_f']}"
            exercises.append({
                "sets": f"{num_rounds} rondas",
                "reps": str(reps),
                "name": m["name"],
                "video_url": m.get("video_url", ""),
                "notes": rx_cue,
                "sub_exercises": []
            })
        description = f"{num_rounds} Rondas:\n" + "\n".join(lines)
        title = random.choice(['Metcon Rush', 'Vanguard', 'Titan Track', 'The Crucible'])

    return {
        "title": title,
        "type": f"FOR TIME (Cap: {minutes} min)",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Escalar repeticiones o peso",
        "target_score": f"Sub {int(minutes * 0.75)} minutos",
        "strategy": "Empezar al 85% y apretar en la última ronda.",
        "exercises": exercises,
    }

def build_tabata(moves: List[Dict[str, Any]]) -> Dict[str, Any]:
    selected = moves[:4] if len(moves) >= 4 else moves
    lines = [f"- Bloque {i}: {m['name']} (20s Trabajo / 10s Descanso x8)" for i, m in enumerate(selected, 1)]
    total_min = len(selected) * 4
    exercises = [
        {
            "sets": "8 rondas",
            "reps": "20s/10s",
            "name": m["name"],
            "video_url": m.get("video_url", ""),
            "notes": "20s Trabajo / 10s Descanso",
            "sub_exercises": []
        }
        for m in selected
    ]

    return {
        "title": random.choice(['Tabata Storm', 'Tabata Madness', 'High Voltage']),
        "type": f"TABATA ({total_min} min)",
        "time_cap": f"{total_min} Minutos",
        "description": "\n".join(lines),
        "rx_weights": "Máxima intensidad en los 20s",
        "scaled_weights": "Ritmo moderado en trabajo",
        "target_score": "Contar la ronda de menor puntuación",
        "strategy": "Mantener intensidad constante en todas las rondas.",
        "exercises": exercises,
    }

def build_chipper(moves: List[Dict[str, Any]], minutes: int) -> Dict[str, Any]:
    lines = []
    rx_notes = []
    scaled_notes = []
    exercises = []

    for m in moves:
        reps = m.get("reps_ft", 15) * 2
        lines.append(f"- {reps} {m['name']}")
        rx_cue = ""
        if m.get("rx_m") and m["rx_m"] not in ("Sin peso", "Rx"):
            rx_notes.append(f"{m['name']}: {m['rx_m']} / {m['rx_f']}")
            scaled_notes.append(f"{m['name']}: reducir 40% reps")
            rx_cue = f"Rx: {m['rx_m']} / {m['rx_f']}"
        exercises.append({
            "sets": "1 serie",
            "reps": str(reps),
            "name": m["name"],
            "video_url": m.get("video_url", ""),
            "notes": rx_cue,
            "sub_exercises": []
        })

    description = "\n".join(lines)
    return {
        "title": random.choice(['The Grinder', 'Chipper Odyssey', 'Iron Mountain']),
        "type": f"CHIPPER (Cap: {minutes} min)",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "; ".join(rx_notes) if rx_notes else "Estándar Rx",
        "scaled_weights": "; ".join(scaled_notes) if scaled_notes else "Escalar volumen",
        "target_score": f"Terminar antes de {minutes} min",
        "strategy": "Partir en series cortas con descansos breves.",
        "exercises": exercises,
    }

def build_endurance(moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    stations = len(moves)
    rounds = max(3, int(minutes / max(3, stations)))
    lines = [f"- {int(m.get('reps_amrap', 12) * 1.2)} {m['name']}" for m in moves]
    exercises = [
        {
            "sets": f"{rounds} rondas",
            "reps": str(int(m.get("reps_amrap", 12) * 1.2)),
            "name": m["name"],
            "video_url": m.get("video_url", ""),
            "notes": "",
            "sub_exercises": []
        }
        for m in moves
    ]

    description = f"{rounds} Rondas continuas:\n" + "\n".join(lines)
    title = random.choice(['Steady Diesel', 'Aero Lab', 'Oxygen Flow', 'Iron Lung'])

    return {
        "title": title,
        "type": f"ENDURANCE ({minutes} min)",
        "time_cap": f"{minutes} Minutos",
        "description": description,
        "rx_weights": "Carga moderada / controlada",
        "scaled_weights": "Ritmo conversacional",
        "target_score": f"Completar {rounds} rondas a ritmo estable",
        "strategy": "Pacing aeróbico constante sin picos de fatiga.",
        "exercises": exercises,
    }

def build_custom_wod_style(style_name: str, moves: List[Dict[str, Any]], minutes: int, goal: str) -> Dict[str, Any]:
    lines = [f"- {m.get('reps_amrap', 10)} {m['name']}" for m in moves]
    clean_style = style_name.strip()
    exercises = [
        {
            "sets": "",
            "reps": str(m.get("reps_amrap", 10)),
            "name": m["name"],
            "video_url": m.get("video_url", ""),
            "notes": "",
            "sub_exercises": []
        }
        for m in moves
    ]

    return {
        "title": random.choice(['Vanguard', 'Apex', 'Thunder', 'Titan']),
        "type": f"{clean_style} ({minutes} min)",
        "time_cap": f"{minutes} Minutos",
        "description": "\n".join(lines),
        "rx_weights": "Estándar Rx",
        "scaled_weights": "Escalar según nivel",
        "target_score": f"Completar en {minutes} min",
        "strategy": "Técnica y ritmo estable.",
        "exercises": exercises,
    }
