from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

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


class SystemLog(Base):
    """系统操作审计日志，记录资源配置、任务下发和告警处置等关键动作。"""

    __tablename__ = 'tb_system_log'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey('users.id'), nullable=True, index=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    module: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    result: Mapped[str] = mapped_column(String(30), nullable=False, default='成功')
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    user: Mapped[User | None] = relationship()


class Room(Base):
    """电房档案，是所有巡检资源的顶层业务实体。"""

    __tablename__ = 'tb_room'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    room_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    floor_plan_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    cabinets: Mapped[list['Cabinet']] = relationship(back_populates='room')
    points: Mapped[list['InspectionPoint']] = relationship(back_populates='room')


class CabinetType(Base):
    """电柜类型及其图片模板。"""

    __tablename__ = 'tb_cabinet_type'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    template_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    cabinets: Mapped[list['Cabinet']] = relationship(back_populates='cabinet_type')


class Cabinet(Base):
    """电柜档案。平面图坐标只表达展示位置，不替代机器人导航坐标。"""

    __tablename__ = 'tb_cabinet'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cabinet_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    room_id: Mapped[int] = mapped_column(ForeignKey('tb_room.id'), index=True, nullable=False)
    cabinet_type_id: Mapped[int | None] = mapped_column(
        ForeignKey('tb_cabinet_type.id'), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    location_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    room: Mapped[Room] = relationship(back_populates='cabinets')
    cabinet_type: Mapped[CabinetType | None] = relationship(back_populates='cabinets')
    device_items: Mapped[list['DeviceItem']] = relationship(
        back_populates='cabinet', cascade='all, delete-orphan'
    )


class DeviceItem(Base):
    """统一监测对象，数值仪表、指示灯和手柄通过 item_type 区分。"""

    __tablename__ = 'tb_device_item'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    cabinet_id: Mapped[int] = mapped_column(ForeignKey('tb_cabinet.id'), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    item_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    unit: Mapped[str | None] = mapped_column(String(30), nullable=True)
    roi_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    roi_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    roi_width: Mapped[float | None] = mapped_column(Float, nullable=True)
    roi_height: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    recognition_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    camera_role: Mapped[str | None] = mapped_column(String(30), nullable=True)
    reference_image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    inspection_point_id: Mapped[int | None] = mapped_column(
        ForeignKey('tb_inspection_point.id'), index=True, nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    cabinet: Mapped[Cabinet] = relationship(back_populates='device_items')
    threshold_rules: Mapped[list['ThresholdRule']] = relationship(
        back_populates='device_item', cascade='all, delete-orphan'
    )
    inspection_point: Mapped['InspectionPoint | None'] = relationship(foreign_keys=[inspection_point_id])


class ThresholdRule(Base):
    """数值范围或期望状态规则；同一对象可配置多级阈值。"""

    __tablename__ = 'tb_threshold_rule'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    item_id: Mapped[int] = mapped_column(ForeignKey('tb_device_item.id'), index=True, nullable=False)
    rule_name: Mapped[str] = mapped_column(String(160), nullable=False)
    warning_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    warning_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    alarm_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    alarm_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_state: Mapped[str | None] = mapped_column(String(80), nullable=True)
    severity: Mapped[str] = mapped_column(String(30), nullable=False, default='一般')
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    device_item: Mapped[DeviceItem] = relationship(back_populates='threshold_rules')


class Robot(Base):
    """机器人主数据和最近一次可持久化状态。"""

    __tablename__ = 'tb_robot'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    robot_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    adapter_mode: Mapped[str] = mapped_column(String(20), nullable=False, default='real')
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='idle')
    online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    battery: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    position_x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    position_y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    yaw: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    agent_base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ssh_host: Mapped[str | None] = mapped_column(String(160), nullable=True)
    camera_roles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    voltage: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


class InspectionPoint(Base):
    """可复用巡检点，包含导航坐标和拍摄姿态。"""

    __tablename__ = 'tb_inspection_point'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    point_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    room_id: Mapped[int] = mapped_column(ForeignKey('tb_room.id'), index=True, nullable=False)
    cabinet_id: Mapped[int | None] = mapped_column(ForeignKey('tb_cabinet.id'), index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    yaw: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_pan: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    camera_tilt: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    room: Mapped[Room] = relationship(back_populates='points')
    cabinet: Mapped[Cabinet | None] = relationship()


class Route(Base):
    """正式巡检路线模板。"""

    __tablename__ = 'tb_route'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    route_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    room_id: Mapped[int] = mapped_column(ForeignKey('tb_room.id'), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    room: Mapped[Room] = relationship()
    details: Mapped[list['RouteDetail']] = relationship(
        back_populates='route', cascade='all, delete-orphan', order_by='RouteDetail.sequence'
    )


class RouteDetail(Base):
    """路线中的有序巡检点。"""

    __tablename__ = 'tb_route_detail'
    __table_args__ = (UniqueConstraint('route_id', 'sequence', name='uq_route_sequence'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    route_id: Mapped[int] = mapped_column(ForeignKey('tb_route.id'), index=True, nullable=False)
    point_id: Mapped[int] = mapped_column(ForeignKey('tb_inspection_point.id'), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    dwell_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=2)

    route: Mapped[Route] = relationship(back_populates='details')
    point: Mapped[InspectionPoint] = relationship()


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
    inspection_record_id: Mapped[int | None] = mapped_column(
        ForeignKey('tb_inspection_record.id'), nullable=True, index=True
    )
    image_id: Mapped[int | None] = mapped_column(ForeignKey('tb_image.id'), nullable=True, index=True)
    device_item_id: Mapped[int | None] = mapped_column(
        ForeignKey('tb_device_item.id'), nullable=True, index=True
    )

    # 识别对象与结果。兼容数值仪表、指示灯、手柄状态等不同类型。
    target_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    recognition_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    recognition_value: Mapped[str | None] = mapped_column(String(120), nullable=True)
    numeric_value: Mapped[float | None] = mapped_column(Float, nullable=True)
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


class InspectionTask(Base):
    __tablename__ = 'tb_inspection_task'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    scene_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    area: Mapped[str | None] = mapped_column(String(160), nullable=True)
    robot: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    route_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_time: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default='pending')
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    priority: Mapped[str | None] = mapped_column(String(40), nullable=True)
    point_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    task_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    route_points: Mapped[list['InspectionTaskRoutePoint']] = relationship(
        back_populates='task',
        cascade='all, delete-orphan',
        order_by='InspectionTaskRoutePoint.sequence',
    )


class InspectionTaskRoutePoint(Base):
    __tablename__ = 'tb_inspection_task_route_point'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey('tb_inspection_task.task_id'), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    point_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    point_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    target_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    point_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    task: Mapped[InspectionTask] = relationship(back_populates='route_points')


class InspectionRecord(Base):
    """一次任务执行实例，与可复用的任务定义和路线模板分离。"""

    __tablename__ = 'tb_inspection_record'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    record_code: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    task_id: Mapped[str | None] = mapped_column(
        ForeignKey('tb_inspection_task.task_id'), index=True, nullable=True
    )
    route_id: Mapped[int | None] = mapped_column(ForeignKey('tb_route.id'), index=True, nullable=True)
    robot_id: Mapped[int | None] = mapped_column(ForeignKey('tb_robot.id'), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='running')
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    point_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    task: Mapped[InspectionTask | None] = relationship()
    route: Mapped[Route | None] = relationship()
    robot: Mapped[Robot | None] = relationship()
    images: Mapped[list['ImageRecord']] = relationship(
        back_populates='record', cascade='all, delete-orphan'
    )


class ImageRecord(Base):
    """原始巡检图片；每柜三张图以多行记录和 sequence 表达。"""

    __tablename__ = 'tb_image'
    __table_args__ = (
        UniqueConstraint('record_id', 'point_id', 'sequence', name='uq_record_point_image_sequence'),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    image_code: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    record_id: Mapped[int] = mapped_column(
        ForeignKey('tb_inspection_record.id'), index=True, nullable=False
    )
    point_id: Mapped[int | None] = mapped_column(
        ForeignKey('tb_inspection_point.id'), index=True, nullable=True
    )
    cabinet_id: Mapped[int | None] = mapped_column(ForeignKey('tb_cabinet.id'), index=True, nullable=True)
    image_type: Mapped[str] = mapped_column(String(40), nullable=False, default='visible')
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    record: Mapped[InspectionRecord] = relationship(back_populates='images')
    point: Mapped[InspectionPoint | None] = relationship()
    cabinet: Mapped[Cabinet | None] = relationship()


class Alarm(Base):
    """由阈值判定生成的告警主记录。"""

    __tablename__ = 'tb_alarm'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alarm_code: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    result_id: Mapped[int | None] = mapped_column(
        ForeignKey('tb_recognition_result.result_id'), index=True, nullable=True
    )
    task_id: Mapped[str | None] = mapped_column(String(80), index=True, nullable=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey('tb_device_item.id'), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default='待确认', index=True)
    severity: Mapped[str] = mapped_column(String(30), nullable=False, default='一般')
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    threshold_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(80), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    result: Mapped[RecognitionResult | None] = relationship()
    device_item: Mapped[DeviceItem | None] = relationship()
    processes: Mapped[list['AlarmProcess']] = relationship(
        back_populates='alarm', cascade='all, delete-orphan', order_by='AlarmProcess.created_at'
    )


class AlarmProcess(Base):
    """告警状态流转历史，保留确认、派单、反馈和关闭证据。"""

    __tablename__ = 'tb_alarm_process'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alarm_id: Mapped[int] = mapped_column(ForeignKey('tb_alarm.id'), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str] = mapped_column(String(30), nullable=False)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    operator: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    alarm: Mapped[Alarm] = relationship(back_populates='processes')
