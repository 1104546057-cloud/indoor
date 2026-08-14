from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import jwt
from dotenv import load_dotenv
from fastapi import Body, Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

try:
    from .business_router import create_business_router
    from .mapping_router import create_mapping_router
    from .database import Base, engine, get_db
    from .inspection_service import apply_threshold_rules
    from .navigation_workflow import (
        begin_route_execution,
        mark_route_dispatch_failed,
        navigation_execution_id,
        refresh_post_execution_state,
        resume_route_monitors,
        start_route_monitor,
        sync_route_execution,
    )
    from .models import (
        ImageRecord,
        InspectionPoint,
        InspectionRecord,
        InspectionTask,
        InspectionTaskRoutePoint,
        RecognitionResult,
        Robot,
        RoomMap,
        Route,
        SystemLog,
        User,
    )
    from .recognition_client import (
        capture_recognition,
        get_recognition_detections,
        get_recognition_status,
        list_recognition_devices,
        open_recognition_stream,
    )
    from .permissions import (
        default_permissions,
        effective_permissions,
        normalize_permissions,
        require_permission,
    )
    from .vehicle_client import (
        cancel_navigation_route,
        get_camera_info,
        get_lidar_info,
        get_mapping_status,
        get_navigation_route_status,
        get_vehicle_status,
        list_vehicles,
        open_camera_stream,
        send_navigation_goal,
        send_navigation_route,
        send_vehicle_command,
        start_vehicle_services,
        stop_vehicle,
    )
except ImportError:
    from business_router import create_business_router
    from mapping_router import create_mapping_router
    from database import Base, engine, get_db
    from inspection_service import apply_threshold_rules
    from navigation_workflow import (
        begin_route_execution,
        mark_route_dispatch_failed,
        navigation_execution_id,
        refresh_post_execution_state,
        resume_route_monitors,
        start_route_monitor,
        sync_route_execution,
    )
    from models import (
        ImageRecord,
        InspectionPoint,
        InspectionRecord,
        InspectionTask,
        InspectionTaskRoutePoint,
        RecognitionResult,
        Robot,
        RoomMap,
        Route,
        SystemLog,
        User,
    )
    from recognition_client import (
        capture_recognition,
        get_recognition_detections,
        get_recognition_status,
        list_recognition_devices,
        open_recognition_stream,
    )
    from permissions import (
        default_permissions,
        effective_permissions,
        normalize_permissions,
        require_permission,
    )
    from vehicle_client import (
        cancel_navigation_route,
        get_camera_info,
        get_lidar_info,
        get_mapping_status,
        get_navigation_route_status,
        get_vehicle_status,
        list_vehicles,
        open_camera_stream,
        send_navigation_goal,
        send_navigation_route,
        send_vehicle_command,
        start_vehicle_services,
        stop_vehicle,
    )


# 读取 backend/.env 中的 JWT 配置。
load_dotenv(Path(__file__).with_name('.env'))

# 密码统一使用 bcrypt 校验。数据库里保存的是哈希值，不保存明文密码。
password_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

# JWT 用于证明用户已经登录过，并且后续请求可以识别当前用户身份。
JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dwc-default-secret-key')
JWT_ALGORITHM = os.getenv('JWT_ALGORITHM', 'HS256')
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv('ACCESS_TOKEN_EXPIRE_MINUTES', '1440'))
COOKIE_SECURE = os.getenv('COOKIE_SECURE', 'false').lower() in {'1', 'true', 'yes'}

@asynccontextmanager
async def lifespan(_: FastAPI):
    # 旧开发库可显式开启兼容建表；常规环境由 Alembic 管理结构版本。
    if os.getenv('AUTO_CREATE_TABLES', 'false').lower() in {'1', 'true', 'yes'}:
        Base.metadata.create_all(bind=engine)
    resume_route_monitors()
    yield


app = FastAPI(
    title="Indoor Inspection Robot Management Platform",
    description="Backend API for indoor inspection robot management platform.",
    version="0.1.0",
    lifespan=lifespan,
)

# 开发环境允许 Vite 前端访问 FastAPI 后端，并允许浏览器携带 Cookie。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    # 前端登录表单提交的用户名和密码。
    username: str
    password: str


class LoginResponse(BaseModel):
    # 登录成功后返回用户基本信息和 JWT。
    message: str
    username: str
    nickname: str
    role: str
    permissions: dict[str, dict[str, bool]]
    token: str


class CurrentUserResponse(BaseModel):
    # 受保护接口返回的当前登录用户信息。
    username: str
    nickname: str
    role: str
    permissions: dict[str, dict[str, bool]]


class SystemUserCreate(BaseModel):
    username: str
    password: str
    nickname: str
    role: str = 'operator'


class SystemUserUpdate(BaseModel):
    nickname: str | None = None
    role: str | None = None
    is_active: bool | None = None


class SystemUserPermissionsUpdate(BaseModel):
    permissions: dict[str, dict[str, bool]]


class VehicleControlRequest(BaseModel):
    # 四驱车当前只使用 linear.x 和 angular.z；组合按键也由这两个量叠加实现。
    # vehicle_id 指定本次命令下发给哪一台车，为空时后端使用默认车。
    linear_x: float = 0.0
    angular_z: float = 0.0
    acceleration: float | None = None
    vehicle_id: str | None = None


class NavigationGoalRequest(BaseModel):
    vehicle_id: str | None = None
    task_id: str | None = None
    point_id: str | None = None
    point_name: str | None = None
    frame_id: str = 'map'
    x: float
    y: float
    yaw: float = 0.0
    speed: float | None = None
    source: dict | None = None


class NavigationRouteRequest(BaseModel):
    vehicle_id: str | None = None
    task_id: str | None = None
    map_id: int | None = None
    route_id: int | None = None
    speed: float | None = None
    goals: list[NavigationGoalRequest]


class NavigationRouteCancelRequest(BaseModel):
    vehicle_id: str | None = None
    execution_id: str | None = None


class TaskRoutePointRequest(BaseModel):
    id: str | None = None
    pointId: str | None = None
    name: str | None = None
    pointName: str | None = None
    targetName: str | None = None
    x: float | None = None
    y: float | None = None
    direction: str | None = None
    yaw: float | str | None = None


class InspectionTaskCreate(BaseModel):
    id: str
    sceneId: str | None = None
    roomId: int | None = None
    mapId: int | None = None
    mapCode: str | None = None
    mapVersion: int | None = None
    routeDatabaseId: int | None = None
    name: str
    area: str | None = None
    robot: str | None = None
    routeId: str | None = None
    pointIds: list[str] = Field(default_factory=list)
    routePoints: list[TaskRoutePointRequest] = Field(default_factory=list)
    start: str | None = None
    status: str | None = None
    progress: int = 0
    priority: str | None = None
    detail: dict | None = None
    timeline: list[dict] = Field(default_factory=list)
    aiPreview: list[dict] = Field(default_factory=list)


class RecognitionResultCreate(BaseModel):
    # NX 推理节点上报的 AI 识别结果。字段尽量做成可选，方便先离线联调。
    task_id: str | None = None
    taskId: str | None = None
    robot_id: str | None = None
    robotId: str | None = None
    room_code: str | None = None
    roomCode: str | None = None
    cabinet_code: str | None = None
    cabinetCode: str | None = None
    point_id: str | None = None
    pointId: str | None = None
    item_code: str | None = None
    itemCode: str | None = None
    target_name: str | None = None
    targetName: str | None = None
    recognition_type: str | None = None
    recognitionType: str | None = None
    value: str | None = None
    recognition_value: str | None = None
    numeric_value: float | None = None
    numericValue: float | None = None
    recognition_state: str | None = None
    unit: str | None = None
    standard_range: str | None = None
    standardRange: str | None = None
    confidence: float | None = None
    status: str | None = None
    image_url: str | None = None
    imageUrl: str | None = None
    captured_at: datetime | None = None
    capturedAt: datetime | None = None


class RecognitionReviewRequest(BaseModel):
    review_status: str
    review_remark: str | None = None
    reviewed_by: str | None = None


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    """生成带过期时间的 JWT。"""

    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=15)
    )
    to_encode.update({'exp': expire})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def get_current_user(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """从 HttpOnly Cookie 中解析 JWT，并查询当前用户。"""

    if not access_token:
        raise HTTPException(status_code=401, detail="未登录或登录已过期")

    # Cookie 中保存的是 Bearer xxx，解析 JWT 前先去掉 Bearer 前缀。
    token = access_token.removeprefix('Bearer ').strip()

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        username = payload.get('sub')
    except jwt.ExpiredSignatureError as error:
        raise HTTPException(status_code=401, detail="登录已过期") from error
    except jwt.InvalidTokenError as error:
        raise HTTPException(status_code=401, detail="无效登录凭证") from error

    if not username:
        raise HTTPException(status_code=401, detail="无效登录凭证")

    user = db.query(User).filter(User.username == username).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已被禁用")

    return user


# 业务资源模块共享现有 Cookie/JWT 鉴权，不另外复制一套登录逻辑。
app.include_router(create_business_router(get_current_user))
app.include_router(create_mapping_router(get_current_user))


@app.get("/")
async def root():
    frontend_index = Path(__file__).resolve().parents[1] / 'frontend' / 'dist' / 'index.html'
    if frontend_index.is_file():
        return FileResponse(frontend_index)
    # 未构建前端时，根接口仍可用于快速确认后端服务已经启动。
    return {"message": "Indoor inspection robot management platform API"}


@app.get("/api/health")
async def health_check():
    # 前端登录页启动时会调用这个接口检测后端连接状态。
    return {"status": "ok", "message": "Service is running"}


@app.post("/api/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest, response: Response, db: Session = Depends(get_db)):
    # 用户名去掉首尾空格，避免输入框误带空格导致查不到用户。
    username = request.username.strip()

    # 从 MySQL users 表查询用户，不再使用硬编码测试账号。
    user = db.query(User).filter(User.username == username).first()

    # 用户不存在或密码哈希校验失败，都返回统一错误，避免暴露账号是否存在。
    if user is None or not password_context.verify(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    # 预留账号禁用能力，后续后台可以通过 is_active 控制用户能否登录。
    if not user.is_active:
        raise HTTPException(status_code=403, detail="用户已被禁用")

    # 校验通过后签发 JWT，sub 用来标识当前登录用户。
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={'sub': user.username},
        expires_delta=access_token_expires,
    )

    # 通过 HttpOnly Cookie 下发 JWT，减少前端脚本直接读取 Token 的风险。
    response.set_cookie(
        key='access_token',
        value=f'Bearer {access_token}',
        httponly=True,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        expires=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite='lax',
        secure=COOKIE_SECURE,
    )

    db.add(SystemLog(
        user_id=user.id,
        username=user.username,
        module='认证',
        action='登录系统',
        content='用户登录成功',
    ))
    db.commit()

    return LoginResponse(
        message="登录成功",
        username=user.username,
        nickname=user.nickname,
        role=user.role,
        permissions=effective_permissions(user),
        token=access_token,
    )


@app.get("/api/auth/me", response_model=CurrentUserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    # 这个接口用于验证 JWT 是否有效，也可供前端刷新页面后恢复登录用户信息。
    return CurrentUserResponse(
        username=current_user.username,
        nickname=current_user.nickname,
        role=current_user.role,
        permissions=effective_permissions(current_user),
    )


def _system_user_json(user: User) -> dict:
    return {
        'id': user.id,
        'username': user.username,
        'nickname': user.nickname,
        'role': user.role,
        'permissions': effective_permissions(user),
        'isActive': user.is_active,
        'createdAt': user.created_at.isoformat(sep=' ') if user.created_at else None,
        'updatedAt': user.updated_at.isoformat(sep=' ') if user.updated_at else None,
    }


@app.get('/api/system/users')
def list_system_users(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_permission(current_user, 'user_management', 'view')
    return {'users': [_system_user_json(user) for user in db.query(User).order_by(User.id).all()]}


@app.post('/api/system/users')
def create_system_user(
    payload: SystemUserCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'user_management', 'create')
    username = payload.username.strip()
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=409, detail='用户名已存在')
    user = User(
        username=username,
        password_hash=password_context.hash(payload.password),
        nickname=payload.nickname.strip() or username,
        role=payload.role,
        permissions=default_permissions(payload.role),
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(SystemLog(
        user_id=getattr(current_user, 'id', None),
        username=current_user.username,
        module='系统管理',
        action='新增用户',
        content=f'新增账号 {username}，角色 {payload.role}',
    ))
    db.commit()
    db.refresh(user)
    return _system_user_json(user)


@app.patch('/api/system/users/{user_id}')
def update_system_user(
    user_id: int,
    payload: SystemUserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'user_management', 'update')
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail='用户不存在')
    if payload.nickname is not None:
        user.nickname = payload.nickname.strip() or user.username
    if payload.role is not None:
        user.role = payload.role
        user.permissions = default_permissions(payload.role)
    if payload.is_active is not None:
        if user.id == getattr(current_user, 'id', None) and not payload.is_active:
            raise HTTPException(status_code=409, detail='不能禁用当前登录账号')
        user.is_active = payload.is_active
    db.add(SystemLog(
        user_id=getattr(current_user, 'id', None),
        username=current_user.username,
        module='系统管理',
        action='更新用户',
        content=f'更新账号 {user.username}',
    ))
    db.commit()
    db.refresh(user)
    return _system_user_json(user)


@app.put('/api/system/users/{user_id}/permissions')
def update_system_user_permissions(
    user_id: int,
    payload: SystemUserPermissionsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'user_management', 'update')
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail='用户不存在')

    permissions = normalize_permissions(user.role, payload.permissions)
    if user.id == getattr(current_user, 'id', None):
        user_permissions = permissions['user_management']
        if not user_permissions['view'] or not user_permissions['update']:
            raise HTTPException(status_code=409, detail='不能移除当前账号的用户管理查看或编辑权限')

    user.permissions = permissions
    db.add(SystemLog(
        user_id=getattr(current_user, 'id', None),
        username=current_user.username,
        module='系统用户管理',
        action='更新功能权限',
        content=f'更新账号 {user.username} 的功能权限矩阵',
    ))
    db.commit()
    db.refresh(user)
    return _system_user_json(user)


@app.get('/api/system/logs')
def list_system_logs(
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'user_management', 'view')
    logs = db.query(SystemLog).order_by(SystemLog.created_at.desc()).limit(min(max(limit, 1), 500)).all()
    return {'logs': [{
        'id': log.id,
        'username': log.username,
        'module': log.module,
        'action': log.action,
        'content': log.content,
        'ipAddress': log.ip_address,
        'result': log.result,
        'createdAt': log.created_at.isoformat(sep=' ') if log.created_at else None,
    } for log in logs]}


def _pick(payload: RecognitionResultCreate, snake_name: str, camel_name: str | None = None):
    """同时兼容 snake_case 和 camelCase 入参，方便 NX 脚本和前端共用。"""

    snake_value = getattr(payload, snake_name, None)
    if snake_value is not None:
        return snake_value
    return getattr(payload, camel_name, None) if camel_name else None


def _serialize_recognition_result(result: RecognitionResult) -> dict:
    """把 ORM 对象转成前端直接可用的 JSON。"""

    return {
        'id': str(result.result_id),
        'resultId': result.result_id,
        'taskId': result.task_id,
        'robotId': result.robot_id,
        'roomCode': result.room_code,
        'cabinetCode': result.cabinet_code,
        'pointId': result.point_id,
        'itemCode': result.item_code,
        'targetName': result.target_name,
        'recognitionType': result.recognition_type,
        'value': result.recognition_value,
        'recognitionState': result.recognition_state,
        'unit': result.unit,
        'standardRange': result.standard_range,
        'confidence': f'{result.confidence:.1f}%' if result.confidence is not None else '--',
        'confidenceValue': result.confidence,
        'status': result.status,
        'imageUrl': result.image_url,
        'reviewStatus': result.review_status,
        'reviewRemark': result.review_remark,
        'reviewedBy': result.reviewed_by,
        'reviewedAt': result.reviewed_at.isoformat(sep=' ') if result.reviewed_at else None,
        'capturedAt': result.captured_at.isoformat(sep=' ') if result.captured_at else None,
        'createdAt': result.created_at.isoformat(sep=' ') if result.created_at else None,
        'summary': f'{result.recognition_type or "AI识别"}：{result.recognition_value or "--"}',
        'visual': 'digital' if result.recognition_type and '数显' in result.recognition_type else 'meter',
        'rawData': result.raw_data,
    }


def _serialize_task(task: InspectionTask) -> dict:
    payload = task.task_payload.copy() if task.task_payload else {}
    payload.update({
        'id': task.task_id,
        'sceneId': task.scene_id,
        'name': task.name,
        'area': task.area,
        'robot': task.robot,
        'routeId': task.route_id,
        'start': task.start_time,
        'status': task.status,
        'progress': task.progress,
        'priority': task.priority,
    })

    if not payload.get('pointIds'):
        payload['pointIds'] = [
            point.point_id
            for point in task.route_points
            if point.point_id
        ]

    if not payload.get('routePoints'):
        payload['routePoints'] = [
            {
                **(point.point_payload or {}),
                'id': point.point_id,
                'name': point.point_name,
                'targetName': point.target_name,
                'x': point.x,
                'y': point.y,
            }
            for point in task.route_points
            if point.x is not None and point.y is not None
        ]

    payload['createdAt'] = task.created_at.isoformat(sep=' ') if task.created_at else None
    payload['updatedAt'] = task.updated_at.isoformat(sep=' ') if task.updated_at else None
    return payload


def _build_task_route_points(payload: InspectionTaskCreate) -> list[InspectionTaskRoutePoint]:
    source_points = payload.routePoints or [
        TaskRoutePointRequest(id=point_id, pointId=point_id)
        for point_id in payload.pointIds
    ]
    return [
        InspectionTaskRoutePoint(
            sequence=index + 1,
            point_id=point.pointId or point.id,
            point_name=point.pointName or point.name,
            target_name=point.targetName,
            x=point.x,
            y=point.y,
            point_payload=point.model_dump(mode='json'),
        )
        for index, point in enumerate(source_points)
    ]


@app.get("/api/tasks")
def list_tasks(
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_tasks', 'view')
    tasks = (
        db.query(InspectionTask)
        .order_by(InspectionTask.created_at.desc())
        .limit(min(max(limit, 1), 300))
        .all()
    )
    return {'tasks': [_serialize_task(task) for task in tasks]}


@app.post("/api/tasks")
def create_task(
    payload: InspectionTaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_tasks', 'create')
    existing_task = db.query(InspectionTask).filter(InspectionTask.task_id == payload.id).first()
    if existing_task is not None:
        raise HTTPException(status_code=409, detail='task already exists')

    raw_payload = payload.model_dump(mode='json')
    detail = payload.detail or {}
    task = InspectionTask(
        task_id=payload.id,
        scene_id=payload.sceneId,
        name=payload.name,
        area=payload.area,
        robot=payload.robot,
        route_id=payload.routeId,
        start_time=payload.start,
        status=payload.status or 'pending',
        progress=payload.progress,
        priority=payload.priority,
        point_total=int(detail.get('pointTotal') or len(payload.routePoints) or len(payload.pointIds)),
        task_payload=raw_payload,
        created_by=current_user.username,
    )

    task.route_points = _build_task_route_points(payload)

    db.add(task)
    db.commit()
    db.refresh(task)
    return {'message': 'task created', 'task': _serialize_task(task)}


@app.put("/api/tasks/{task_id}")
def update_pending_task(
    task_id: str,
    payload: InspectionTaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_tasks', 'update')
    task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail='task not found')
    if payload.id != task_id:
        raise HTTPException(status_code=422, detail='task id cannot be changed')

    has_execution = (
        db.query(InspectionRecord.id)
        .filter(InspectionRecord.task_id == task_id)
        .first()
        is not None
    )
    if task.status not in {'pending', '待执行'} or task.progress > 0 or has_execution:
        raise HTTPException(status_code=409, detail='only unexecuted tasks can be edited')

    raw_payload = payload.model_dump(mode='json')
    raw_payload['id'] = task_id
    raw_payload['status'] = task.status
    raw_payload['progress'] = task.progress
    detail = payload.detail or {}

    task.scene_id = payload.sceneId
    task.name = payload.name
    task.area = payload.area
    task.robot = payload.robot
    task.route_id = payload.routeId
    task.start_time = payload.start
    task.priority = payload.priority
    task.point_total = int(detail.get('pointTotal') or len(payload.routePoints) or len(payload.pointIds))
    task.task_payload = raw_payload
    task.route_points = _build_task_route_points(payload)

    db.commit()
    db.refresh(task)
    return {'message': 'task updated', 'task': _serialize_task(task)}


@app.delete("/api/tasks/{task_id}")
def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_tasks', 'delete')
    task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
    if task is None:
        raise HTTPException(status_code=404, detail='task not found')

    db.delete(task)
    db.commit()
    return {'deleted': True, 'task_id': task_id}


@app.post("/api/inference/results")
@app.post("/api/recognition/results")
def create_recognition_result(payload: RecognitionResultCreate, db: Session = Depends(get_db)):
    # 第一版作为内网接收接口，允许 NX 推理节点直接上报；后续可以增加 API Key。
    raw_payload = payload.model_dump(mode='json')
    task_id = _pick(payload, 'task_id', 'taskId')
    point_code = _pick(payload, 'point_id', 'pointId')
    image_url = _pick(payload, 'image_url', 'imageUrl')
    record = None
    point = None
    image = None
    if task_id:
        record = (
            db.query(InspectionRecord)
            .filter(InspectionRecord.task_id == task_id)
            .order_by(InspectionRecord.created_at.desc())
            .first()
        )
    if point_code:
        point = db.query(InspectionPoint).filter(InspectionPoint.point_code == point_code).first()
    if record and image_url:
        image = (
            db.query(ImageRecord)
            .filter(ImageRecord.record_id == record.id, ImageRecord.file_url == image_url)
            .first()
        )
        if image is None:
            image_sequence = (
                db.query(ImageRecord)
                .filter(ImageRecord.record_id == record.id, ImageRecord.point_id == (point.id if point else None))
                .count()
                + 1
            )
            image = ImageRecord(
                image_code=f'IMG-{record.id}-{image_sequence}-{uuid4().hex[:6].upper()}',
                record_id=record.id,
                point_id=point.id if point else None,
                cabinet_id=point.cabinet_id if point else None,
                image_type='visible',
                sequence=image_sequence,
                file_url=image_url,
                captured_at=_pick(payload, 'captured_at', 'capturedAt') or datetime.now(),
            )
            db.add(image)
            db.flush()

    result = RecognitionResult(
        task_id=task_id,
        robot_id=_pick(payload, 'robot_id', 'robotId'),
        room_code=_pick(payload, 'room_code', 'roomCode'),
        cabinet_code=_pick(payload, 'cabinet_code', 'cabinetCode'),
        point_id=point_code,
        item_code=_pick(payload, 'item_code', 'itemCode'),
        target_name=_pick(payload, 'target_name', 'targetName'),
        recognition_type=_pick(payload, 'recognition_type', 'recognitionType'),
        recognition_value=payload.recognition_value or payload.value,
        numeric_value=payload.numeric_value if payload.numeric_value is not None else payload.numericValue,
        recognition_state=payload.recognition_state,
        unit=payload.unit,
        standard_range=_pick(payload, 'standard_range', 'standardRange'),
        confidence=payload.confidence,
        status=payload.status or '正常',
        image_url=image_url,
        inspection_record_id=record.id if record else None,
        image_id=image.id if image else None,
        captured_at=_pick(payload, 'captured_at', 'capturedAt') or datetime.now(),
        raw_data=raw_payload,
        review_status='待复核' if (payload.status or '正常') in ['异常', '告警'] else '无需复核',
    )
    db.add(result)
    db.flush()
    apply_threshold_rules(db, result)
    db.commit()
    db.refresh(result)
    refresh_post_execution_state(db, task_id)
    return {'message': 'AI识别结果已入库', 'result': _serialize_recognition_result(result)}


@app.get("/api/inference/results")
@app.get("/api/recognition/results")
def list_recognition_results(
    limit: int = 50,
    status: str | None = None,
    task_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'ai_review', 'view')
    query = db.query(RecognitionResult)
    if status:
        query = query.filter(RecognitionResult.status == status)
    if task_id:
        query = query.filter(RecognitionResult.task_id == task_id)
    results = query.order_by(RecognitionResult.created_at.desc()).limit(min(max(limit, 1), 200)).all()
    return {'results': [_serialize_recognition_result(result) for result in results]}


@app.get("/api/inference/latest")
@app.get("/api/recognition/latest")
def latest_recognition_result(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'ai_review', 'view')
    result = db.query(RecognitionResult).order_by(RecognitionResult.created_at.desc()).first()
    return {'result': _serialize_recognition_result(result) if result else None}


@app.get("/api/inference/summary")
@app.get("/api/recognition/summary")
def recognition_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'ai_review', 'view')
    all_results = db.query(RecognitionResult).all()
    total = len(all_results)
    abnormal = len([item for item in all_results if item.status in ['异常', '告警']])
    pending = len([item for item in all_results if item.review_status == '待复核'])
    normal = len([item for item in all_results if item.status == '正常'])
    return {
        'total': total,
        'normal': normal,
        'abnormal': abnormal,
        'pendingReview': pending,
        'successRate': round(normal / total * 100, 1) if total else 0,
    }


@app.get("/api/recognition/devices")
def recognition_devices(current_user: User = Depends(get_current_user)):
    require_permission(current_user, 'ai_review', 'view')
    return list_recognition_devices()


@app.get("/api/recognition/status")
def recognition_status(
    device_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'ai_review', 'view')
    return get_recognition_status(device_id)


@app.get("/api/recognition/detections")
def recognition_detections(
    device_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'ai_review', 'view')
    return get_recognition_detections(device_id)


@app.post("/api/recognition/capture")
def recognition_capture(
    payload: dict = Body(default_factory=dict),
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'ai_review', 'create')
    device_id = payload.get('deviceId') or payload.get('device_id')
    return capture_recognition(device_id, payload)


@app.get("/api/recognition/stream")
def recognition_stream(
    device_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'ai_review', 'view')
    source = open_recognition_stream(device_id)

    def iter_stream():
        try:
            while True:
                chunk = source.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            source.close()

    return StreamingResponse(
        iter_stream(),
        media_type='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        },
    )


@app.post("/api/recognition/results/{result_id}/review")
def review_recognition_result(
    result_id: int,
    payload: RecognitionReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'ai_review', 'update')
    result = db.query(RecognitionResult).filter(RecognitionResult.result_id == result_id).first()
    if result is None:
        raise HTTPException(status_code=404, detail='识别结果不存在')
    result.review_status = payload.review_status
    result.review_remark = payload.review_remark
    result.reviewed_by = payload.reviewed_by or current_user.nickname or current_user.username
    result.reviewed_at = datetime.now()
    db.commit()
    db.refresh(result)
    refresh_post_execution_state(db, result.task_id)
    return {'message': '复核结果已更新', 'result': _serialize_recognition_result(result)}


@app.get("/api/vehicles")
def vehicles(
    force_refresh: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_monitor', 'view')
    # 连接注册表负责网络参数，Robot 表负责业务档案和最近心跳；每次读取时进行幂等同步。
    payload = list_vehicles(force_refresh=force_refresh)
    for vehicle in payload.get('vehicles', []):
        robot = db.query(Robot).filter(Robot.robot_code == vehicle['id']).first()
        if robot is None:
            robot = Robot(robot_code=vehicle['id'], name=vehicle['name'])
            db.add(robot)
        robot.name = vehicle['name']
        robot.adapter_mode = 'real'
        robot.online = bool(vehicle.get('online'))
        robot.status = 'online' if robot.online else 'offline'
        robot.agent_base_url = vehicle.get('agent_base_url')
        robot.ssh_host = vehicle.get('ssh_host')
        robot.camera_roles = vehicle.get('camera_roles') or []
        robot.last_error = vehicle.get('error')
        if vehicle.get('battery') is not None:
            robot.battery = vehicle['battery']
        if vehicle.get('voltage') is not None:
            robot.voltage = vehicle['voltage']
        if vehicle.get('last_seen_at'):
            parsed = datetime.fromisoformat(vehicle['last_seen_at'])
            robot.last_seen_at = parsed.replace(tzinfo=None)
        db.flush()
        vehicle['db_id'] = robot.id
        vehicle['active'] = robot.is_active
    db.commit()
    return payload


@app.get("/api/vehicle/status")
def vehicle_status(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'view')
    # 后端只做权限校验和转发，真实车辆状态由对应 Nano 上的 vehicle_agent 提供。
    return get_vehicle_status(vehicle_id)


@app.post("/api/vehicle/connect")
def vehicle_connect(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'update')
    # 网页端点击“连接车”时，通过 SSH 启动所选 Nano 上的控制和摄像头常驻服务。
    return start_vehicle_services(vehicle_id)


@app.post("/api/vehicle/control")
def vehicle_control(
    request: VehicleControlRequest,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'update')
    # 点击方向按钮时调用，后续按住按钮也会持续调用这个接口刷新命令时间。
    return send_vehicle_command(
        vehicle_id=request.vehicle_id,
        linear_x=request.linear_x,
        angular_z=request.angular_z,
        acceleration=request.acceleration,
    )


@app.post("/api/vehicle/navigation-goal")
def vehicle_navigation_goal(
    request: NavigationGoalRequest,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'update')
    goal = {
        'frame_id': request.frame_id,
        'x': request.x,
        'y': request.y,
        'yaw': request.yaw,
        'speed': request.speed,
        'task_id': request.task_id,
        'point_id': request.point_id,
        'point_name': request.point_name,
        'source': request.source,
    }
    return send_navigation_goal(request.vehicle_id, goal)


@app.post("/api/vehicle/navigation-route")
def vehicle_navigation_route(
    request: NavigationRouteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_monitor', 'update')
    if not request.goals:
        raise HTTPException(status_code=400, detail='navigation route requires at least one goal')

    vehicle_id = request.vehicle_id or 'nano1'
    if request.map_id is not None:
        room_map = db.get(RoomMap, request.map_id)
        if room_map is None:
            raise HTTPException(status_code=404, detail='计划关联的地图版本不存在')
        if request.route_id is not None:
            saved_route = db.get(Route, request.route_id)
            if saved_route is None:
                raise HTTPException(status_code=404, detail='计划关联的巡检路线不存在')
            if saved_route.map_id != room_map.id:
                raise HTTPException(status_code=409, detail='巡检路线与计划地图版本不一致')

        status = get_mapping_status(vehicle_id)
        if status.get('mode') != 'navigation':
            raise HTTPException(status_code=409, detail='车辆当前不在导航模式，请先停止建图并启用计划地图')
        if status.get('active_map_id') != room_map.map_code:
            raise HTTPException(
                status_code=409,
                detail=f'车端当前地图不是 {room_map.name} V{room_map.version}，请先在地图管理中设为导航地图',
            )
        localization = status.get('localization') or {}
        if not localization.get('valid'):
            reason = localization.get('last_error') or '尚未获得有效定位'
            raise HTTPException(status_code=409, detail=f'车辆定位未就绪：{reason}，请先发布初始位姿')

    route = {
        'task_id': request.task_id,
        'speed': request.speed,
        'goals': [
            {
                'frame_id': goal.frame_id,
                'x': goal.x,
                'y': goal.y,
                'yaw': goal.yaw,
                'speed': goal.speed if goal.speed is not None else request.speed,
                'task_id': goal.task_id or request.task_id,
                'point_id': goal.point_id,
                'point_name': goal.point_name,
                'source': goal.source,
            }
            for goal in request.goals
        ],
    }
    try:
        response = send_navigation_route(request.vehicle_id, route)
    except HTTPException as error:
        mark_route_dispatch_failed(db, request.task_id, vehicle_id, str(error.detail))
        raise

    business_execution = begin_route_execution(db, request.task_id, vehicle_id, response)
    execution_id = navigation_execution_id(response)
    start_route_monitor(request.task_id, vehicle_id, execution_id)
    if isinstance(response, dict) and business_execution:
        return {**response, 'business': business_execution}
    return response


@app.get("/api/vehicle/navigation-route/status")
def vehicle_navigation_route_status(
    vehicle_id: str | None = None,
    execution_id: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_monitor', 'view')
    # 到点进度必须以车端 move_base 的结果为准，不能由网页按时间或距离推测。
    response = get_navigation_route_status(vehicle_id, execution_id)
    navigation = response.get('navigation') if isinstance(response, dict) else None
    task_id = navigation.get('task_id') if isinstance(navigation, dict) else None
    business_execution = sync_route_execution(db, task_id, vehicle_id or 'nano1', response)
    return {**response, 'business': business_execution} if business_execution else response


@app.post("/api/vehicle/navigation-route/cancel")
def vehicle_navigation_route_cancel(
    request: NavigationRouteCancelRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_permission(current_user, 'patrol_monitor', 'update')
    response = cancel_navigation_route(request.vehicle_id, request.execution_id)
    navigation = response.get('navigation') if isinstance(response, dict) else None
    task_id = navigation.get('task_id') if isinstance(navigation, dict) else None
    business_execution = sync_route_execution(db, task_id, request.vehicle_id or 'nano1', response)
    return {**response, 'business': business_execution} if business_execution else response


@app.post("/api/vehicle/stop")
def vehicle_stop(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'update')
    # 停止和急停都先走零速度命令；车端 agent 也有超时自动停车保护。
    return stop_vehicle(vehicle_id)


@app.get("/api/vehicle/camera")
def vehicle_camera(
    vehicle_id: str | None = None,
    camera_role: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'view')
    # 第一版摄像头由 Nano 直接提供 MJPEG，前端拿到地址后用 img 显示。
    return get_camera_info(vehicle_id, camera_role)


@app.get("/api/vehicle/camera/stream")
def vehicle_camera_stream(
    vehicle_id: str | None = None,
    camera_role: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'view')
    # 浏览器可能拦截直接访问 Nano 私网 IP 的 MJPEG 图片流，因此这里转成同源代理流。
    source = open_camera_stream(vehicle_id, camera_role)
    read_chunk = getattr(source, 'read1', source.read)

    def iter_stream():
        try:
            while True:
                chunk = read_chunk(16384)
                if not chunk:
                    break
                yield chunk
        finally:
            source.close()

    return StreamingResponse(
        iter_stream(),
        media_type='multipart/x-mixed-replace; boundary=frame',
        headers={
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Accel-Buffering': 'no',
        },
    )


@app.get("/api/vehicle/lidar")
def vehicle_lidar(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    require_permission(current_user, 'patrol_monitor', 'view')
    # 雷达由 Nano 上的小桥接服务把 ROS /lidar/scan 转成 WebSocket JSON。
    return get_lidar_info(vehicle_id)


# 生产部署时直接托管 Vite 构建产物。API 路由均在此之前注册，因此不会被 SPA 回退覆盖。
FRONTEND_DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'
FRONTEND_ASSETS = FRONTEND_DIST / 'assets'

if FRONTEND_ASSETS.is_dir():
    app.mount('/assets', StaticFiles(directory=FRONTEND_ASSETS), name='frontend-assets')


@app.get('/{frontend_path:path}', include_in_schema=False)
def frontend_application(frontend_path: str):
    if frontend_path.startswith('api/'):
        raise HTTPException(status_code=404, detail='API endpoint not found')
    if not FRONTEND_DIST.is_dir():
        raise HTTPException(status_code=404, detail='Frontend build not found')

    requested = (FRONTEND_DIST / frontend_path).resolve()
    try:
        requested.relative_to(FRONTEND_DIST.resolve())
    except ValueError as error:
        raise HTTPException(status_code=404, detail='File not found') from error

    if frontend_path and requested.is_file():
        return FileResponse(requested)
    return FileResponse(FRONTEND_DIST / 'index.html')
