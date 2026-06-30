from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

try:
    from .database import Base
except ImportError:
    # 兼容直接运行 backend/init_db.py 时的普通模块导入。
    from database import Base


class User(Base):
    """系统用户表。"""

    __tablename__ = 'users'

    # 用户主键，自增 ID。
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 登录用户名，必须唯一，后端登录接口会按这个字段查询用户。
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)

    # 密码哈希值，禁止保存明文密码。
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # 页面显示昵称；当前默认管理员昵称为 system-admin。
    nickname: Mapped[str] = mapped_column(String(50), nullable=False, default='admin')

    # 用户角色字段，后续可以扩展 admin/operator/viewer 等权限。
    role: Mapped[str] = mapped_column(String(30), nullable=False, default='admin')

    # 是否启用账号；禁用后登录接口会返回 403。
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # 记录创建时间，由数据库自动生成。
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    # 记录更新时间，数据修改时自动更新。
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class RecognitionResult(Base):
    """AI 识别结果表，用于接收 NX 推理节点上报的数据。"""

    __tablename__ = 'tb_recognition_result'

    result_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 业务关联字段。第一版允许为空，方便先打通 NX -> 后端 -> 前端链路。
    task_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    robot_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    room_code: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    cabinet_code: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    point_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    item_code: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)

    # 识别对象与结果。兼容数值仪表、指示灯、手柄状态等不同类型。
    target_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    recognition_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    recognition_value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    recognition_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    standard_range: Mapped[str | None] = mapped_column(String(120), nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='正常')

    # 图片、复核和原始结果。raw_data 用来保留 NX 输出的完整 JSON，后续字段扩展不丢信息。
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    raw_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    review_status: Mapped[str] = mapped_column(String(30), nullable=False, default='待复核')
    review_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(50), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    captured_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
