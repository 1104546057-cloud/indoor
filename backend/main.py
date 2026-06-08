import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from dotenv import load_dotenv
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .vehicle_client import (
    get_camera_info,
    get_lidar_info,
    get_vehicle_status,
    list_vehicles,
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

app = FastAPI(
    title="Indoor Inspection Robot Management Platform",
    description="Backend API for indoor inspection robot management platform.",
    version="0.1.0",
)

# 开发环境允许 Vite 前端访问 FastAPI 后端，并允许浏览器携带 Cookie。
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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
    token: str


class CurrentUserResponse(BaseModel):
    # 受保护接口返回的当前登录用户信息。
    username: str
    nickname: str
    role: str


class VehicleControlRequest(BaseModel):
    # 四驱车当前只使用 linear.x 和 angular.z；组合按键也由这两个量叠加实现。
    # vehicle_id 指定本次命令下发给哪一台车，为空时后端使用默认车。
    linear_x: float = 0.0
    angular_z: float = 0.0
    acceleration: float | None = None
    vehicle_id: str | None = None


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


@app.get("/")
async def root():
    # 根接口用于快速确认后端服务已经启动。
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
        secure=False,  # 仅限 HTTP 开发环境；生产环境使用 HTTPS 时应改为 True。
    )

    return LoginResponse(
        message="登录成功",
        username=user.username,
        nickname=user.nickname,
        token=access_token,
    )


@app.get("/api/auth/me", response_model=CurrentUserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    # 这个接口用于验证 JWT 是否有效，也可供前端刷新页面后恢复登录用户信息。
    return CurrentUserResponse(
        username=current_user.username,
        nickname=current_user.nickname,
        role=current_user.role,
    )


@app.get("/api/vehicles")
async def vehicles(current_user: User = Depends(get_current_user)):
    # 前端用这个接口拉取可选车辆列表，渲染车辆选择下拉框。
    return list_vehicles()


@app.get("/api/vehicle/status")
async def vehicle_status(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    # 后端只做权限校验和转发，真实车辆状态由对应 Nano 上的 vehicle_agent 提供。
    return get_vehicle_status(vehicle_id)


@app.post("/api/vehicle/connect")
async def vehicle_connect(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    # 网页端点击“连接车”时，通过 SSH 启动所选 Nano 上的控制和摄像头常驻服务。
    return start_vehicle_services(vehicle_id)


@app.post("/api/vehicle/control")
async def vehicle_control(
    request: VehicleControlRequest,
    current_user: User = Depends(get_current_user),
):
    # 点击方向按钮时调用，后续按住按钮也会持续调用这个接口刷新命令时间。
    return send_vehicle_command(
        vehicle_id=request.vehicle_id,
        linear_x=request.linear_x,
        angular_z=request.angular_z,
        acceleration=request.acceleration,
    )


@app.post("/api/vehicle/stop")
async def vehicle_stop(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    # 停止和急停都先走零速度命令；车端 agent 也有超时自动停车保护。
    return stop_vehicle(vehicle_id)


@app.get("/api/vehicle/camera")
async def vehicle_camera(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    # 第一版摄像头由 Nano 直接提供 MJPEG，前端拿到地址后用 img 显示。
    return get_camera_info(vehicle_id)


@app.get("/api/vehicle/lidar")
async def vehicle_lidar(
    vehicle_id: str | None = None,
    current_user: User = Depends(get_current_user),
):
    # 雷达由 Nano 上的小桥接服务把 ROS /lidar/scan 转成 WebSocket JSON。
    return get_lidar_info(vehicle_id)
