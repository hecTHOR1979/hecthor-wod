from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict

class MicrocycleCreate(BaseModel):
    name: str
    weeks_count: int = Field(default=4, ge=1, le=12)
    days_per_week: int = Field(default=5, ge=1, le=7)
    primary_goal: str = Field(default="Fuerza & Halterofilia")
    description: Optional[str] = ""
    access_code: str
    start_date: Optional[str] = ""

class MicrocycleUpdate(BaseModel):
    name: Optional[str] = None
    weeks_count: Optional[int] = None
    days_per_week: Optional[int] = None
    primary_goal: Optional[str] = None
    description: Optional[str] = None
    access_code: Optional[str] = None
    start_date: Optional[str] = None
    is_active: Optional[int] = None

class DayUpdate(BaseModel):
    title: str
    warmup_type: Optional[str] = "Movilidad GROUND"
    warmup_notes: Optional[str] = ""
    warmup_exercises: Optional[List[Dict[str, Any]]] = []
    warmup_timer: Optional[Dict[str, Any]] = {"type": "AMRAP", "minutes": 8}
    parts: Optional[List[Dict[str, Any]]] = []
    wod: Optional[Dict[str, Any]] = {}
    coaching_tips: Optional[str] = ""

class WarmupTypeCreate(BaseModel):
    name: str

class ExerciseCreate(BaseModel):
    name: str
    category: str
    equipment: Optional[List[str]] = []
    description: Optional[str] = ""
    coaching_cues: Optional[str] = ""
    video_url: Optional[str] = ""
    is_ground: Optional[int] = 0
    ground_flow_level: Optional[str] = "Todos"

class ExerciseUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    equipment: Optional[List[str]] = None
    description: Optional[str] = None
    coaching_cues: Optional[str] = None
    video_url: Optional[str] = None
    is_ground: Optional[int] = None
    ground_flow_level: Optional[str] = None

class StudentAccessRequest(BaseModel):
    access_code: str

class StudentLogCreate(BaseModel):
    microcycle_id: int
    day_id: int
    student_name: str
    score: str
    rx_status: Optional[str] = "Rx"
    weights_used: Optional[str] = ""
    notes: Optional[str] = ""

class WodGeneratorRequest(BaseModel):
    equipment: List[str]
    time_minutes: int = 15
    wod_type: str = "AMRAP"
    goal: Optional[str] = "Híbrido"
    skills: Optional[List[str]] = []

class CoachAuthRequest(BaseModel):
    password: str
    username: Optional[str] = "coach"

class CoachChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class StudentRegisterRequest(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = ""
    password: str

class StudentLoginRequest(BaseModel):
    email: str
    password: str

class CoachStudentCreate(BaseModel):
    full_name: str
    email: str
    phone: Optional[str] = ""
    password: str
    assigned_microcycle_id: Optional[int] = None
    notes: Optional[str] = ""

class CoachStudentUpdate(BaseModel):
    status: Optional[str] = None
    assigned_microcycle_id: Optional[int] = None
    clear_microcycle_assignment: Optional[bool] = False
    notes: Optional[str] = None
