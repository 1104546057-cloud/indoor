from __future__ import annotations

import base64
import binascii
from datetime import datetime
from pathlib import Path
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

try:
    from .database import get_db
    from .models import (
        Alarm,
        AlarmProcess,
        Cabinet,
        CabinetType,
        DeviceItem,
        ImageRecord,
        InspectionPoint,
        InspectionRecord,
        InspectionTask,
        InspectionTaskRoutePoint,
        RecognitionResult,
        Robot,
        Room,
        Route,
        RouteDetail,
        SystemLog,
        ThresholdRule,
    )
    from .navigation_workflow import begin_route_execution, navigation_execution_id, start_route_monitor
    from .vehicle_client import remove_vehicle_registry, send_navigation_route, upsert_vehicle_registry
except ImportError:
    from database import get_db
    from models import (
        Alarm,
        AlarmProcess,
        Cabinet,
        CabinetType,
        DeviceItem,
        ImageRecord,
        InspectionPoint,
        InspectionRecord,
        InspectionTask,
        InspectionTaskRoutePoint,
        RecognitionResult,
        Robot,
        Room,
        Route,
        RouteDetail,
        SystemLog,
        ThresholdRule,
    )
    from navigation_workflow import begin_route_execution, navigation_execution_id, start_route_monitor
    from vehicle_client import remove_vehicle_registry, send_navigation_route, upsert_vehicle_registry


ASSET_DIRECTORY = Path(__file__).with_name('uploads') / 'device_assets'
VALID_ITEM_TYPES = {'value', 'lamp', 'handle', 'switch', 'temperature', 'text'}
VALID_CAMERA_ROLES = {'movement', 'high', 'middle', 'low', 'ptz'}
VALID_SEVERITIES = {'提示', '一般', '重要', '紧急'}


class RoomPayload(BaseModel):
    room_code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    location: str | None = None
    floor_plan_url: str | None = None
    description: str | None = None
    is_active: bool = True


class CabinetPayload(BaseModel):
    cabinet_code: str = Field(min_length=1, max_length=80)
    room_id: int
    cabinet_type_id: int | None = None
    name: str = Field(min_length=1, max_length=160)
    location_x: float | None = Field(default=None, ge=0, le=100)
    location_y: float | None = Field(default=None, ge=0, le=100)
    photo_url: str | None = None
    description: str | None = None
    is_active: bool = True


class DeviceItemPayload(BaseModel):
    item_code: str = Field(min_length=1, max_length=80)
    cabinet_id: int
    name: str = Field(min_length=1, max_length=160)
    item_type: str
    unit: str | None = None
    expected_state: str | None = None
    roi_x: float | None = Field(default=None, ge=0, le=100)
    roi_y: float | None = Field(default=None, ge=0, le=100)
    roi_width: float | None = Field(default=None, gt=0, le=100)
    roi_height: float | None = Field(default=None, gt=0, le=100)
    recognition_type: str | None = None
    camera_role: str | None = None
    reference_image_url: str | None = None
    inspection_point_id: int | None = None
    is_active: bool = True
    warning_min: float | None = None
    warning_max: float | None = None
    alarm_min: float | None = None
    alarm_max: float | None = None


class ThresholdPayload(BaseModel):
    item_id: int
    rule_name: str = Field(min_length=1, max_length=160)
    warning_min: float | None = None
    warning_max: float | None = None
    alarm_min: float | None = None
    alarm_max: float | None = None
    expected_state: str | None = None
    severity: str = '一般'
    is_active: bool = True


class VehicleRegistryPayload(BaseModel):
    robot_code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    agent_base_url: str = Field(min_length=1, max_length=500)
    ssh_host: str | None = None
    ssh_port: int = Field(default=22, ge=1, le=65535)
    ssh_username: str | None = None
    ssh_password: str | None = None
    start_script: str | None = None
    camera_streams: dict[str, str] = Field(default_factory=dict)
    is_active: bool = True


class ImageAssetPayload(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    data_url: str = Field(min_length=20)


class PointPayload(BaseModel):
    point_code: str
    room_id: int
    cabinet_id: int | None = None
    name: str
    x: float
    y: float
    yaw: float = 0.0
    camera_pan: float = 0.0
    camera_tilt: float = 0.0


class RoutePayload(BaseModel):
    route_code: str
    room_id: int
    name: str
    description: str | None = None
    point_ids: list[int] = Field(min_length=1)


class AlarmTransitionPayload(BaseModel):
    action: str
    remark: str | None = None
    assigned_to: str | None = None


class StartRoutePayload(BaseModel):
    vehicle_id: str
    task_name: str | None = None
    speed: float = 0.6


class TaskStatusPayload(BaseModel):
    status: str
    progress: int | None = None
    current_sequence: int | None = None
    failure_reason: str | None = None
    position_x: float | None = None
    position_y: float | None = None
    yaw: float | None = None
    battery: float | None = None


def _require_admin(current_user) -> None:
    if getattr(current_user, 'role', None) != 'admin':
        raise HTTPException(status_code=403, detail='只有管理员可以维护设备主数据')


def _validate_item_payload(payload: DeviceItemPayload, db: Session) -> None:
    if payload.item_type not in VALID_ITEM_TYPES:
        raise HTTPException(status_code=422, detail='不支持的监测对象类型')
    if payload.camera_role and payload.camera_role not in VALID_CAMERA_ROLES:
        raise HTTPException(status_code=422, detail='不支持的摄像头角色')
    roi = (payload.roi_x, payload.roi_y, payload.roi_width, payload.roi_height)
    if any(value is not None for value in roi) and not all(value is not None for value in roi):
        raise HTTPException(status_code=422, detail='ROI 的 X、Y、宽度和高度必须同时填写')
    if all(value is not None for value in roi):
        if payload.roi_x + payload.roi_width > 100 or payload.roi_y + payload.roi_height > 100:
            raise HTTPException(status_code=422, detail='ROI 必须位于图片范围内')
    if payload.inspection_point_id is not None:
        point = db.get(InspectionPoint, payload.inspection_point_id)
        if point is None:
            raise HTTPException(status_code=404, detail='绑定巡检点不存在')
        cabinet = db.get(Cabinet, payload.cabinet_id)
        if cabinet and (point.cabinet_id not in {None, cabinet.id} or point.room_id != cabinet.room_id):
            raise HTTPException(status_code=422, detail='巡检点与监测对象所属电柜不一致')


def _validate_threshold_values(values: dict) -> None:
    severity = values.get('severity', '一般')
    if severity not in VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail='不支持的告警等级')
    warning_min, warning_max = values.get('warning_min'), values.get('warning_max')
    alarm_min, alarm_max = values.get('alarm_min'), values.get('alarm_max')
    if warning_min is not None and warning_max is not None and warning_min >= warning_max:
        raise HTTPException(status_code=422, detail='预警下限必须小于预警上限')
    if alarm_min is not None and alarm_max is not None and alarm_min >= alarm_max:
        raise HTTPException(status_code=422, detail='告警下限必须小于告警上限')
    if alarm_min is not None and warning_min is not None and alarm_min > warning_min:
        raise HTTPException(status_code=422, detail='告警下限应小于或等于预警下限')
    if alarm_max is not None and warning_max is not None and alarm_max < warning_max:
        raise HTTPException(status_code=422, detail='告警上限应大于或等于预警上限')


def _threshold_json(rule: ThresholdRule) -> dict:
    return {
        'id': rule.id,
        'itemId': rule.item_id,
        'ruleName': rule.rule_name,
        'warningMin': rule.warning_min,
        'warningMax': rule.warning_max,
        'alarmMin': rule.alarm_min,
        'alarmMax': rule.alarm_max,
        'expectedState': rule.expected_state,
        'severity': rule.severity,
        'active': rule.is_active,
    }


def _room_json(room: Room) -> dict:
    return {
        'id': room.id,
        'roomCode': room.room_code,
        'name': room.name,
        'location': room.location,
        'floorPlanUrl': room.floor_plan_url,
        'description': room.description,
        'active': room.is_active,
    }


def _cabinet_json(cabinet: Cabinet) -> dict:
    return {
        'id': cabinet.id,
        'cabinetCode': cabinet.cabinet_code,
        'roomId': cabinet.room_id,
        'cabinetTypeId': cabinet.cabinet_type_id,
        'name': cabinet.name,
        'locationX': cabinet.location_x,
        'locationY': cabinet.location_y,
        'photoUrl': cabinet.photo_url,
        'description': cabinet.description,
        'active': cabinet.is_active,
    }


def _item_json(item: DeviceItem) -> dict:
    rules = sorted(item.threshold_rules, key=lambda candidate: candidate.id)
    rule = next((candidate for candidate in rules if candidate.is_active), rules[0] if rules else None)
    return {
        'id': item.id,
        'itemCode': item.item_code,
        'cabinetId': item.cabinet_id,
        'name': item.name,
        'itemType': item.item_type,
        'unit': item.unit,
        'expectedState': item.expected_state,
        'recognitionType': item.recognition_type,
        'cameraRole': item.camera_role,
        'referenceImageUrl': item.reference_image_url,
        'inspectionPointId': item.inspection_point_id,
        'roi': [item.roi_x, item.roi_y, item.roi_width, item.roi_height],
        'threshold': _threshold_json(rule) if rule else None,
        'thresholds': [_threshold_json(candidate) for candidate in rules],
        'active': item.is_active,
    }


def _point_json(point: InspectionPoint) -> dict:
    return {
        'id': point.id,
        'pointCode': point.point_code,
        'roomId': point.room_id,
        'cabinetId': point.cabinet_id,
        'name': point.name,
        'x': point.x,
        'y': point.y,
        'yaw': point.yaw,
        'cameraPan': point.camera_pan,
        'cameraTilt': point.camera_tilt,
        'active': point.is_active,
    }


def _route_json(route: Route) -> dict:
    return {
        'id': route.id,
        'routeCode': route.route_code,
        'roomId': route.room_id,
        'name': route.name,
        'description': route.description,
        'active': route.is_active,
        'points': [
            {**_point_json(detail.point), 'sequence': detail.sequence, 'dwellSeconds': detail.dwell_seconds}
            for detail in route.details
        ],
    }


def _robot_json(robot: Robot) -> dict:
    return {
        'id': robot.id,
        'robotCode': robot.robot_code,
        'name': robot.name,
        'adapterMode': robot.adapter_mode,
        'status': robot.status,
        'online': robot.online,
        'battery': robot.battery,
        'voltage': robot.voltage,
        'agentBaseUrl': robot.agent_base_url,
        'sshHost': robot.ssh_host,
        'cameraRoles': robot.camera_roles or [],
        'lastSeenAt': robot.last_seen_at.isoformat(sep=' ') if robot.last_seen_at else None,
        'lastError': robot.last_error,
        'active': robot.is_active,
        'position': {'x': robot.position_x, 'y': robot.position_y, 'yaw': robot.yaw},
    }


def _alarm_json(alarm: Alarm) -> dict:
    return {
        'id': alarm.id,
        'alarmCode': alarm.alarm_code,
        'resultId': alarm.result_id,
        'taskId': alarm.task_id,
        'itemId': alarm.item_id,
        'status': alarm.status,
        'severity': alarm.severity,
        'title': alarm.title,
        'description': alarm.description,
        'assignedTo': alarm.assigned_to,
        'createdAt': alarm.created_at.isoformat(sep=' ') if alarm.created_at else None,
        'processes': [
            {
                'id': process.id,
                'action': process.action,
                'fromStatus': process.from_status,
                'toStatus': process.to_status,
                'remark': process.remark,
                'operator': process.operator,
                'createdAt': process.created_at.isoformat(sep=' ') if process.created_at else None,
            }
            for process in alarm.processes
        ],
    }


def seed_standard_data(db: Session) -> dict:
    """幂等写入一套可直接用于现场校准的标准业务主数据。"""

    room = db.query(Room).filter(Room.room_code == 'ROOM-A1').first()
    if room is None:
        room = Room(
            room_code='ROOM-A1',
            name='A1 高压配电室',
            location='实验楼一层东侧',
            floor_plan_url='/maps/first_floor.png',
            description='现场巡检联调使用的标准电房',
        )
        db.add(room)
        db.flush()

    cabinet_type = db.query(CabinetType).filter(CabinetType.type_code == 'HV-STANDARD').first()
    if cabinet_type is None:
        cabinet_type = CabinetType(type_code='HV-STANDARD', name='标准高压开关柜')
        db.add(cabinet_type)
        db.flush()

    cabinet_specs = [
        ('CAB-A01', 'A01 进线柜', 24.0, 30.0),
        ('CAB-A02', 'A02 计量柜', 49.0, 30.0),
        ('CAB-A03', 'A03 出线柜', 74.0, 30.0),
    ]
    cabinets = []
    for code, name, x, y in cabinet_specs:
        cabinet = db.query(Cabinet).filter(Cabinet.cabinet_code == code).first()
        if cabinet is None:
            cabinet = Cabinet(
                cabinet_code=code,
                room_id=room.id,
                cabinet_type_id=cabinet_type.id,
                name=name,
                location_x=x,
                location_y=y,
            )
            db.add(cabinet)
            db.flush()
        cabinets.append(cabinet)

    item_specs = [
        (cabinets[0], 'ITEM-A01-V', '母线电压表', 'value', 'kV', None, 9.5, 10.5, 9.0, 11.0),
        (cabinets[1], 'ITEM-A02-L', '运行指示灯', 'lamp', None, '绿色', None, None, None, None),
        (cabinets[2], 'ITEM-A03-H', '隔离开关手柄', 'handle', None, '合闸', None, None, None, None),
    ]
    for cabinet, code, name, kind, unit, expected, wmin, wmax, amin, amax in item_specs:
        item = db.query(DeviceItem).filter(DeviceItem.item_code == code).first()
        if item is None:
            item = DeviceItem(
                item_code=code,
                cabinet_id=cabinet.id,
                name=name,
                item_type=kind,
                unit=unit,
                expected_state=expected,
                roi_x=0.2,
                roi_y=0.2,
                roi_width=0.6,
                roi_height=0.6,
            )
            db.add(item)
            db.flush()
        if not item.threshold_rules:
            db.add(ThresholdRule(
                item_id=item.id,
                rule_name=f'{name}标准规则',
                warning_min=wmin,
                warning_max=wmax,
                alarm_min=amin,
                alarm_max=amax,
                expected_state=expected,
                severity='重要' if kind == 'value' else '一般',
            ))

    points = []
    for index, cabinet in enumerate(cabinets, start=1):
        code = f'POINT-A0{index}'
        point = db.query(InspectionPoint).filter(InspectionPoint.point_code == code).first()
        if point is None:
            point = InspectionPoint(
                point_code=code,
                room_id=room.id,
                cabinet_id=cabinet.id,
                name=f'{cabinet.name}巡检点',
                x=float(index * 2),
                y=1.5,
                yaw=0.0,
            )
            db.add(point)
            db.flush()
        points.append(point)

    route = db.query(Route).filter(Route.route_code == 'ROUTE-A1').first()
    if route is None:
        route = Route(route_code='ROUTE-A1', room_id=room.id, name='A1 标准巡检路线')
        route.details = [
            RouteDetail(point_id=point.id, sequence=index, dwell_seconds=2)
            for index, point in enumerate(points, start=1)
        ]
        db.add(route)

    db.commit()
    return {'seeded': True, 'roomCode': room.room_code, 'routeCode': route.route_code}


def _add_system_log(db: Session, user, module: str, action: str, content: str) -> None:
    db.add(SystemLog(
        user_id=getattr(user, 'id', None),
        username=getattr(user, 'username', 'system'),
        module=module,
        action=action,
        content=content,
    ))


def create_business_router(get_current_user: Callable) -> APIRouter:
    router = APIRouter(prefix='/api/business', tags=['business'])
    auth = Depends(get_current_user)

    @router.get('/overview')
    def overview(current_user=auth, db: Session = Depends(get_db)):
        routes = db.query(Route).options(
            selectinload(Route.details).selectinload(RouteDetail.point)
        ).order_by(Route.id).all()
        items = db.query(DeviceItem).options(selectinload(DeviceItem.threshold_rules)).order_by(DeviceItem.id).all()
        alarms = db.query(Alarm).options(selectinload(Alarm.processes)).order_by(Alarm.created_at.desc()).all()
        records = (
            db.query(InspectionRecord)
            .options(
                selectinload(InspectionRecord.task).selectinload(InspectionTask.route_points),
                selectinload(InspectionRecord.route),
                selectinload(InspectionRecord.robot),
            )
            .order_by(InspectionRecord.created_at.desc())
            .limit(50)
            .all()
        )
        images = db.query(ImageRecord).order_by(ImageRecord.created_at.desc()).limit(200).all()
        results = db.query(RecognitionResult).order_by(RecognitionResult.created_at.desc()).limit(200).all()
        return {
            'rooms': [_room_json(item) for item in db.query(Room).order_by(Room.id).all()],
            'cabinetTypes': [
                {'id': item.id, 'typeCode': item.type_code, 'name': item.name}
                for item in db.query(CabinetType).order_by(CabinetType.id).all()
            ],
            'cabinets': [_cabinet_json(item) for item in db.query(Cabinet).order_by(Cabinet.id).all()],
            'deviceItems': [_item_json(item) for item in items],
            'thresholdRules': [
                _threshold_json(item)
                for item in db.query(ThresholdRule).order_by(ThresholdRule.id).all()
            ],
            'robots': [_robot_json(item) for item in db.query(Robot).order_by(Robot.id).all()],
            'points': [_point_json(item) for item in db.query(InspectionPoint).order_by(InspectionPoint.id).all()],
            'routes': [_route_json(item) for item in routes],
            'alarms': [_alarm_json(item) for item in alarms],
            'records': [
                {
                    'id': record.id,
                    'recordCode': record.record_code,
                    'taskId': record.task_id,
                    'taskName': record.task.name if record.task else None,
                    'taskSceneId': record.task.scene_id if record.task else None,
                    'taskArea': record.task.area if record.task else None,
                    'taskRouteId': record.task.route_id if record.task else None,
                    'createdBy': record.task.created_by if record.task else None,
                    'routeName': record.route.name if record.route else None,
                    'robotName': record.robot.name if record.robot else None,
                    'robotCode': record.robot.robot_code if record.robot else None,
                    'status': record.status,
                    'progress': record.progress,
                    'currentSequence': record.current_sequence,
                    'pointTotal': record.point_total,
                    'failureReason': record.failure_reason,
                    'startedAt': record.started_at.isoformat(sep=' ') if record.started_at else None,
                    'finishedAt': record.finished_at.isoformat(sep=' ') if record.finished_at else None,
                    'executionId': ((record.task.task_payload or {}).get('routeWorkflow') or {}).get('executionId') if record.task else None,
                    'navigation': ((record.task.task_payload or {}).get('routeWorkflow') or {}).get('navigation') if record.task else None,
                    'postExecution': ((record.task.task_payload or {}).get('routeWorkflow') or {}).get('postExecution') if record.task else None,
                    'captureEvents': ((record.task.task_payload or {}).get('routeWorkflow') or {}).get('captureEvents') if record.task else None,
                    'routePoints': [
                        {
                            **(point.point_payload or {}),
                            'id': point.point_id,
                            'name': point.point_name,
                            'targetName': point.target_name,
                            'x': point.x,
                            'y': point.y,
                            'sequence': point.sequence,
                        }
                        for point in (record.task.route_points if record.task else [])
                        if point.x is not None and point.y is not None
                    ],
                }
                for record in records
            ],
            'images': [
                {
                    'id': image.id,
                    'recordId': image.record_id,
                    'pointId': image.point_id,
                    'cabinetId': image.cabinet_id,
                    'imageType': image.image_type,
                    'sequence': image.sequence,
                    'fileUrl': image.file_url,
                    'capturedAt': image.captured_at.isoformat(sep=' ') if image.captured_at else None,
                }
                for image in images
            ],
            'results': [
                {
                    'id': result.result_id,
                    'taskId': result.task_id,
                    'recordId': result.inspection_record_id,
                    'roomCode': result.room_code,
                    'cabinetCode': result.cabinet_code,
                    'pointId': result.point_id,
                    'itemCode': result.item_code,
                    'robotId': result.robot_id,
                    'imageId': result.image_id,
                    'targetName': result.target_name,
                    'recognitionType': result.recognition_type,
                    'value': result.recognition_value,
                    'numericValue': result.numeric_value,
                    'unit': result.unit,
                    'recognitionState': result.recognition_state,
                    'standardRange': result.standard_range,
                    'confidence': result.confidence,
                    'status': result.status,
                    'imageUrl': result.image_url,
                    'reviewStatus': result.review_status,
                    'reviewRemark': result.review_remark,
                    'reviewedBy': result.reviewed_by,
                    'reviewedAt': result.reviewed_at.isoformat(sep=' ') if result.reviewed_at else None,
                    'capturedAt': result.captured_at.isoformat(sep=' ') if result.captured_at else None,
                }
                for result in results
            ],
        }

    @router.post('/seed')
    def seed(current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        return seed_standard_data(db)

    @router.post('/rooms')
    def create_room(payload: RoomPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        if db.query(Room).filter(Room.room_code == payload.room_code).first():
            raise HTTPException(status_code=409, detail='电房编码已存在')
        room = Room(**payload.model_dump())
        db.add(room)
        _add_system_log(db, current_user, '设备管理', '新增电房', f'{payload.room_code} {payload.name}')
        db.commit()
        db.refresh(room)
        return _room_json(room)

    @router.put('/rooms/{room_id}')
    def update_room(room_id: int, payload: RoomPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        room = db.get(Room, room_id)
        if room is None:
            raise HTTPException(status_code=404, detail='电房不存在')
        duplicate = db.query(Room).filter(Room.room_code == payload.room_code, Room.id != room_id).first()
        if duplicate:
            raise HTTPException(status_code=409, detail='电房编码已存在')
        for key, value in payload.model_dump().items():
            setattr(room, key, value)
        _add_system_log(db, current_user, '设备管理', '编辑电房', f'{payload.room_code} {payload.name}')
        db.commit()
        db.refresh(room)
        return _room_json(room)

    @router.delete('/rooms/{room_id}')
    def delete_room(room_id: int, hard: bool = False, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        room = db.get(Room, room_id)
        if room is None:
            raise HTTPException(status_code=404, detail='电房不存在')
        if hard:
            counts = {
                '电柜': db.query(Cabinet).filter(Cabinet.room_id == room_id).count(),
                '巡检点': db.query(InspectionPoint).filter(InspectionPoint.room_id == room_id).count(),
                '路线': db.query(Route).filter(Route.room_id == room_id).count(),
            }
            dependencies = '、'.join(f'{name}{count}项' for name, count in counts.items() if count)
            if dependencies:
                raise HTTPException(status_code=409, detail=f'电房仍关联{dependencies}，请先解除关联')
            db.delete(room)
            action = '删除电房'
        else:
            room.is_active = False
            action = '停用电房'
        _add_system_log(db, current_user, '设备管理', action, f'{room.room_code} {room.name}')
        db.commit()
        return {'id': room_id, 'deleted': hard, 'active': False}

    @router.post('/cabinets')
    def create_cabinet(payload: CabinetPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        if db.query(Cabinet).filter(Cabinet.cabinet_code == payload.cabinet_code).first():
            raise HTTPException(status_code=409, detail='电柜编码已存在')
        if db.get(Room, payload.room_id) is None:
            raise HTTPException(status_code=404, detail='所属电房不存在')
        cabinet = Cabinet(**payload.model_dump())
        db.add(cabinet)
        _add_system_log(db, current_user, '设备管理', '新增电柜', f'{payload.cabinet_code} {payload.name}')
        db.commit()
        db.refresh(cabinet)
        return _cabinet_json(cabinet)

    @router.put('/cabinets/{cabinet_id}')
    def update_cabinet(cabinet_id: int, payload: CabinetPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        cabinet = db.get(Cabinet, cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=404, detail='电柜不存在')
        if db.get(Room, payload.room_id) is None:
            raise HTTPException(status_code=404, detail='所属电房不存在')
        duplicate = db.query(Cabinet).filter(
            Cabinet.cabinet_code == payload.cabinet_code,
            Cabinet.id != cabinet_id,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail='电柜编码已存在')
        for key, value in payload.model_dump().items():
            setattr(cabinet, key, value)
        _add_system_log(db, current_user, '设备管理', '编辑电柜', f'{payload.cabinet_code} {payload.name}')
        db.commit()
        db.refresh(cabinet)
        return _cabinet_json(cabinet)

    @router.delete('/cabinets/{cabinet_id}')
    def delete_cabinet(cabinet_id: int, hard: bool = False, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        cabinet = db.get(Cabinet, cabinet_id)
        if cabinet is None:
            raise HTTPException(status_code=404, detail='电柜不存在')
        if hard:
            counts = {
                '监测对象': db.query(DeviceItem).filter(DeviceItem.cabinet_id == cabinet_id).count(),
                '巡检点': db.query(InspectionPoint).filter(InspectionPoint.cabinet_id == cabinet_id).count(),
                '现场图片': db.query(ImageRecord).filter(ImageRecord.cabinet_id == cabinet_id).count(),
            }
            dependencies = '、'.join(f'{name}{count}项' for name, count in counts.items() if count)
            if dependencies:
                raise HTTPException(status_code=409, detail=f'电柜仍关联{dependencies}，请先解除关联')
            db.delete(cabinet)
            action = '删除电柜'
        else:
            cabinet.is_active = False
            action = '停用电柜'
        _add_system_log(db, current_user, '设备管理', action, f'{cabinet.cabinet_code} {cabinet.name}')
        db.commit()
        return {'id': cabinet_id, 'deleted': hard, 'active': False}

    @router.post('/device-items')
    def create_device_item(payload: DeviceItemPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        if db.query(DeviceItem).filter(DeviceItem.item_code == payload.item_code).first():
            raise HTTPException(status_code=409, detail='监测对象编码已存在')
        if db.get(Cabinet, payload.cabinet_id) is None:
            raise HTTPException(status_code=404, detail='所属电柜不存在')
        _validate_item_payload(payload, db)
        values = payload.model_dump()
        rule_values = {key: values.pop(key) for key in ['warning_min', 'warning_max', 'alarm_min', 'alarm_max']}
        _validate_threshold_values(rule_values)
        item = DeviceItem(**values)
        db.add(item)
        db.flush()
        if any(value is not None for value in rule_values.values()) or payload.expected_state:
            db.add(ThresholdRule(
                item_id=item.id,
                rule_name=f'{item.name}规则',
                expected_state=payload.expected_state,
                **rule_values,
            ))
        _add_system_log(db, current_user, '设备管理', '新增监测对象', f'{payload.item_code} {payload.name}')
        db.commit()
        db.refresh(item)
        return {'id': item.id, 'itemCode': item.item_code}

    @router.put('/device-items/{item_id}')
    def update_device_item(item_id: int, payload: DeviceItemPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        item = db.get(DeviceItem, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail='监测对象不存在')
        if db.get(Cabinet, payload.cabinet_id) is None:
            raise HTTPException(status_code=404, detail='所属电柜不存在')
        duplicate = db.query(DeviceItem).filter(
            DeviceItem.item_code == payload.item_code,
            DeviceItem.id != item_id,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail='监测对象编码已存在')
        _validate_item_payload(payload, db)
        values = payload.model_dump()
        for key in ['warning_min', 'warning_max', 'alarm_min', 'alarm_max']:
            values.pop(key)
        for key, value in values.items():
            setattr(item, key, value)
        _add_system_log(db, current_user, '设备管理', '编辑监测对象', f'{payload.item_code} {payload.name}')
        db.commit()
        refreshed = db.query(DeviceItem).options(selectinload(DeviceItem.threshold_rules)).filter(DeviceItem.id == item_id).one()
        return _item_json(refreshed)

    @router.delete('/device-items/{item_id}')
    def delete_device_item(item_id: int, hard: bool = False, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        item = db.get(DeviceItem, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail='监测对象不存在')
        if hard:
            result_count = db.query(RecognitionResult).filter(RecognitionResult.device_item_id == item_id).count()
            alarm_count = db.query(Alarm).filter(Alarm.item_id == item_id).count()
            if result_count or alarm_count:
                raise HTTPException(
                    status_code=409,
                    detail=f'监测对象仍关联识别结果{result_count}项、告警{alarm_count}项，只允许停用',
                )
            db.delete(item)
            action = '删除监测对象'
        else:
            item.is_active = False
            action = '停用监测对象'
        _add_system_log(db, current_user, '设备管理', action, f'{item.item_code} {item.name}')
        db.commit()
        return {'id': item_id, 'deleted': hard, 'active': False}

    @router.post('/threshold-rules')
    def create_threshold(payload: ThresholdPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        if db.get(DeviceItem, payload.item_id) is None:
            raise HTTPException(status_code=404, detail='监测对象不存在')
        values = payload.model_dump()
        _validate_threshold_values(values)
        rule = ThresholdRule(**values)
        db.add(rule)
        _add_system_log(db, current_user, '设备管理', '新增阈值规则', payload.rule_name)
        db.commit()
        db.refresh(rule)
        return _threshold_json(rule)

    @router.put('/threshold-rules/{rule_id}')
    def update_threshold(rule_id: int, payload: ThresholdPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        rule = db.get(ThresholdRule, rule_id)
        if rule is None:
            raise HTTPException(status_code=404, detail='阈值规则不存在')
        if db.get(DeviceItem, payload.item_id) is None:
            raise HTTPException(status_code=404, detail='监测对象不存在')
        values = payload.model_dump()
        _validate_threshold_values(values)
        for key, value in values.items():
            setattr(rule, key, value)
        _add_system_log(db, current_user, '设备管理', '编辑阈值规则', payload.rule_name)
        db.commit()
        db.refresh(rule)
        return _threshold_json(rule)

    @router.delete('/threshold-rules/{rule_id}')
    def delete_threshold(rule_id: int, hard: bool = False, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        rule = db.get(ThresholdRule, rule_id)
        if rule is None:
            raise HTTPException(status_code=404, detail='阈值规则不存在')
        if hard:
            db.delete(rule)
            action = '删除阈值规则'
        else:
            rule.is_active = False
            action = '停用阈值规则'
        _add_system_log(db, current_user, '设备管理', action, rule.rule_name)
        db.commit()
        return {'id': rule_id, 'deleted': hard, 'active': False}

    @router.post('/assets/image')
    def upload_asset_image(payload: ImageAssetPayload, current_user=auth):
        _require_admin(current_user)
        if ',' not in payload.data_url:
            raise HTTPException(status_code=422, detail='图片数据格式错误')
        header, encoded = payload.data_url.split(',', 1)
        mime_extensions = {
            'data:image/png;base64': '.png',
            'data:image/jpeg;base64': '.jpg',
            'data:image/webp;base64': '.webp',
        }
        extension = mime_extensions.get(header.lower())
        if extension is None:
            raise HTTPException(status_code=422, detail='仅支持 PNG、JPEG 和 WebP 图片')
        try:
            content = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=422, detail='图片 Base64 数据无效') from error
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail='图片不能超过 5 MB')
        ASSET_DIRECTORY.mkdir(parents=True, exist_ok=True)
        asset_name = f'{uuid4().hex}{extension}'
        (ASSET_DIRECTORY / asset_name).write_bytes(content)
        return {'fileUrl': f'/api/business/assets/{asset_name}', 'filename': payload.filename}

    @router.get('/assets/{asset_name}')
    def read_asset_image(asset_name: str, current_user=auth):
        safe_name = Path(asset_name).name
        path = ASSET_DIRECTORY / safe_name
        if safe_name != asset_name or not path.is_file():
            raise HTTPException(status_code=404, detail='图片不存在')
        return FileResponse(path)

    def vehicle_registry_values(payload: VehicleRegistryPayload) -> dict:
        invalid_roles = set(payload.camera_streams) - VALID_CAMERA_ROLES
        if invalid_roles:
            raise HTTPException(status_code=422, detail=f'不支持的摄像头角色：{", ".join(sorted(invalid_roles))}')
        return {
            'name': payload.name,
            'agent_base_url': payload.agent_base_url,
            'ssh_host': payload.ssh_host,
            'ssh_port': payload.ssh_port,
            'ssh_username': payload.ssh_username,
            'ssh_password': payload.ssh_password,
            'start_script': payload.start_script,
            'camera_streams': payload.camera_streams,
        }

    def apply_vehicle_payload(robot: Robot, payload: VehicleRegistryPayload) -> None:
        robot.robot_code = payload.robot_code
        robot.name = payload.name
        robot.adapter_mode = 'real'
        robot.agent_base_url = payload.agent_base_url
        robot.ssh_host = payload.ssh_host
        robot.camera_roles = list(payload.camera_streams)
        robot.is_active = payload.is_active

    @router.post('/robots')
    def create_robot(payload: VehicleRegistryPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        if db.query(Robot).filter(Robot.robot_code == payload.robot_code).first():
            raise HTTPException(status_code=409, detail='车辆编号已存在')
        config = upsert_vehicle_registry(payload.robot_code, vehicle_registry_values(payload))
        robot = Robot(robot_code=payload.robot_code, name=payload.name)
        apply_vehicle_payload(robot, payload)
        db.add(robot)
        _add_system_log(db, current_user, '设备管理', '注册车辆', f'{payload.robot_code} {payload.name}')
        db.commit()
        db.refresh(robot)
        return {**_robot_json(robot), 'registry': config}

    @router.put('/robots/{robot_id}')
    def update_robot(robot_id: int, payload: VehicleRegistryPayload, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        robot = db.get(Robot, robot_id)
        if robot is None:
            raise HTTPException(status_code=404, detail='车辆档案不存在')
        if payload.robot_code != robot.robot_code:
            raise HTTPException(status_code=422, detail='车辆编号建立后不可修改')
        config = upsert_vehicle_registry(payload.robot_code, vehicle_registry_values(payload))
        apply_vehicle_payload(robot, payload)
        _add_system_log(db, current_user, '设备管理', '编辑车辆', f'{payload.robot_code} {payload.name}')
        db.commit()
        db.refresh(robot)
        return {**_robot_json(robot), 'registry': config}

    @router.delete('/robots/{robot_id}')
    def delete_robot(robot_id: int, hard: bool = False, current_user=auth, db: Session = Depends(get_db)):
        _require_admin(current_user)
        robot = db.get(Robot, robot_id)
        if robot is None:
            raise HTTPException(status_code=404, detail='车辆档案不存在')
        if hard:
            records = db.query(InspectionRecord).filter(InspectionRecord.robot_id == robot_id).count()
            tasks = db.query(InspectionTask).filter(InspectionTask.robot == robot.robot_code).count()
            if records or tasks:
                raise HTTPException(
                    status_code=409,
                    detail=f'车辆仍关联巡检记录{records}项、任务{tasks}项，只允许停用',
                )
            remove_vehicle_registry(robot.robot_code)
            db.delete(robot)
            action = '删除车辆'
        else:
            robot.is_active = False
            action = '停用车辆'
        _add_system_log(db, current_user, '设备管理', action, f'{robot.robot_code} {robot.name}')
        db.commit()
        return {'id': robot_id, 'deleted': hard, 'active': False}

    @router.post('/points')
    def create_point(payload: PointPayload, current_user=auth, db: Session = Depends(get_db)):
        if db.query(InspectionPoint).filter(InspectionPoint.point_code == payload.point_code).first():
            raise HTTPException(status_code=409, detail='巡检点编码已存在')
        point = InspectionPoint(**payload.model_dump())
        db.add(point)
        _add_system_log(db, current_user, '巡检任务管理', '新增巡检点', f'{payload.point_code} {payload.name}')
        db.commit()
        db.refresh(point)
        return _point_json(point)

    @router.post('/routes')
    def create_route(payload: RoutePayload, current_user=auth, db: Session = Depends(get_db)):
        if db.query(Route).filter(Route.route_code == payload.route_code).first():
            raise HTTPException(status_code=409, detail='路线编码已存在')
        points = [db.get(InspectionPoint, point_id) for point_id in payload.point_ids]
        if any(point is None for point in points):
            raise HTTPException(status_code=404, detail='路线包含不存在的巡检点')
        route = Route(
            route_code=payload.route_code,
            room_id=payload.room_id,
            name=payload.name,
            description=payload.description,
        )
        route.details = [
            RouteDetail(point_id=point.id, sequence=index, dwell_seconds=2)
            for index, point in enumerate(points, start=1)
        ]
        db.add(route)
        _add_system_log(db, current_user, '巡检任务管理', '新增路线', f'{payload.route_code} {payload.name}')
        db.commit()
        db.refresh(route)
        return {'id': route.id, 'routeCode': route.route_code}

    @router.post('/routes/{route_id}/start')
    def start_real_route(
        route_id: int,
        payload: StartRoutePayload,
        current_user=auth,
        db: Session = Depends(get_db),
    ):
        route = db.get(Route, route_id)
        if route is None:
            raise HTTPException(status_code=404, detail='巡检路线不存在')
        if not route.details:
            raise HTTPException(status_code=409, detail='巡检路线尚未配置巡检点')

        robot = db.query(Robot).filter(Robot.robot_code == payload.vehicle_id).first()
        if robot is None:
            robot = Robot(
                robot_code=payload.vehicle_id,
                name=payload.vehicle_id,
                adapter_mode='real',
                status='navigating',
                online=True,
            )
            db.add(robot)
            db.flush()
        else:
            robot.adapter_mode = 'real'
            robot.status = 'navigating'
            robot.online = True

        task_id = f'TASK-{datetime.now():%Y%m%d%H%M%S}-{uuid4().hex[:4].upper()}'
        task = InspectionTask(
            task_id=task_id,
            scene_id=route.room.room_code,
            name=payload.task_name or f'{route.name}巡检任务',
            area=route.room.name,
            robot=payload.vehicle_id,
            route_id=route.route_code,
            start_time=datetime.now().isoformat(timespec='seconds'),
            status='dispatching',
            progress=0,
            priority='普通',
            point_total=len(route.details),
            task_payload={'source': 'real-vehicle', 'routeId': route.route_code},
            created_by=current_user.username,
        )
        task.route_points = [
            InspectionTaskRoutePoint(
                sequence=detail.sequence,
                point_id=detail.point.point_code,
                point_name=detail.point.name,
                target_name=detail.point.cabinet.name if detail.point.cabinet else None,
                x=detail.point.x,
                y=detail.point.y,
                point_payload={
                    'yaw': detail.point.yaw,
                    'cameraPan': detail.point.camera_pan,
                    'cameraTilt': detail.point.camera_tilt,
                },
            )
            for detail in route.details
        ]
        db.add(task)
        db.flush()
        record = InspectionRecord(
            record_code=f'REC-{datetime.now():%Y%m%d%H%M%S}-{uuid4().hex[:6].upper()}',
            task_id=task_id,
            route_id=route.id,
            robot_id=robot.id,
            status='dispatching',
            point_total=len(route.details),
        )
        db.add(record)
        db.commit()
        goals = [
            {
                'frame_id': 'map',
                'x': detail.point.x,
                'y': detail.point.y,
                'yaw': detail.point.yaw,
                'speed': payload.speed,
                'task_id': task_id,
                'point_id': detail.point.point_code,
                'point_name': detail.point.name,
                'source': {
                    'camera_pan': detail.point.camera_pan,
                    'camera_tilt': detail.point.camera_tilt,
                    'cabinet_id': detail.point.cabinet_id,
                },
            }
            for detail in route.details
        ]
        try:
            vehicle_response = send_navigation_route(
                payload.vehicle_id,
                {'task_id': task_id, 'speed': payload.speed, 'goals': goals},
            )
        except HTTPException:
            task.status = 'dispatch_failed'
            record.status = 'failed'
            record.failure_reason = '路线下发失败'
            record.finished_at = datetime.now()
            robot.status = 'fault'
            db.commit()
            raise

        task.status = 'running'
        record.status = 'running'
        business_execution = begin_route_execution(
            db,
            task_id,
            payload.vehicle_id,
            vehicle_response,
            record_id=record.id,
        )
        start_route_monitor(task_id, payload.vehicle_id, navigation_execution_id(vehicle_response))
        _add_system_log(db, current_user, '巡检任务管理', '下发实车路线', f'{task_id} → {payload.vehicle_id}')
        db.commit()
        return {
            'taskId': task_id,
            'recordId': record.id,
            'vehicleId': payload.vehicle_id,
            'goalCount': len(goals),
            'vehicleResponse': vehicle_response,
            'businessExecution': business_execution,
        }

    @router.post('/tasks/{task_id}/status')
    def update_task_status(task_id: str, payload: TaskStatusPayload, db: Session = Depends(get_db)):
        """供车辆 agent 回传任务进度；部署时可在网关层为该接口增加设备 API Key。"""

        task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
        if task is None:
            raise HTTPException(status_code=404, detail='巡检任务不存在')
        record = (
            db.query(InspectionRecord)
            .filter(InspectionRecord.task_id == task_id)
            .order_by(InspectionRecord.created_at.desc())
            .first()
        )
        task.status = payload.status
        if payload.progress is not None:
            task.progress = min(max(payload.progress, 0), 100)
        if record:
            record.status = payload.status
            record.progress = task.progress
            if payload.current_sequence is not None:
                record.current_sequence = payload.current_sequence
            record.failure_reason = payload.failure_reason
            if payload.status in {'completed', 'failed', 'cancelled'}:
                record.finished_at = datetime.now()
        robot = db.query(Robot).filter(Robot.robot_code == task.robot).first()
        if robot:
            robot.status = 'idle' if payload.status == 'completed' else payload.status
            if payload.position_x is not None:
                robot.position_x = payload.position_x
            if payload.position_y is not None:
                robot.position_y = payload.position_y
            if payload.yaw is not None:
                robot.yaw = payload.yaw
            if payload.battery is not None:
                robot.battery = payload.battery
        db.commit()
        return {'taskId': task_id, 'status': task.status, 'progress': task.progress}

    transitions = {
        '确认': ('待确认', '已确认'),
        '派单': ('已确认', '处理中'),
        '反馈': ('处理中', '待复核'),
        '关闭': ('待复核', '已关闭'),
    }

    @router.post('/alarms/{alarm_id}/transition')
    def transition_alarm(
        alarm_id: int,
        payload: AlarmTransitionPayload,
        current_user=auth,
        db: Session = Depends(get_db),
    ):
        alarm = db.get(Alarm, alarm_id)
        if alarm is None:
            raise HTTPException(status_code=404, detail='告警不存在')
        expected = transitions.get(payload.action)
        if expected is None:
            raise HTTPException(status_code=400, detail='不支持的告警操作')
        from_status, to_status = expected
        if alarm.status != from_status:
            raise HTTPException(status_code=409, detail=f'当前状态 {alarm.status} 不能执行{payload.action}')
        alarm.processes.append(AlarmProcess(
            action=payload.action,
            from_status=alarm.status,
            to_status=to_status,
            remark=payload.remark,
            operator=current_user.nickname or current_user.username,
        ))
        alarm.status = to_status
        if payload.assigned_to:
            alarm.assigned_to = payload.assigned_to
        if to_status == '已确认':
            alarm.confirmed_at = datetime.now()
        if to_status == '已关闭':
            alarm.closed_at = datetime.now()
        _add_system_log(db, current_user, '告警监测', payload.action, f'{alarm.alarm_code}: {from_status} → {to_status}')
        db.commit()
        db.refresh(alarm)
        return _alarm_json(alarm)

    return router
