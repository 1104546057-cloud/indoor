from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
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
