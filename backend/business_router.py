from datetime import datetime
from typing import Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
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
    from .vehicle_client import send_navigation_route
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
    from vehicle_client import send_navigation_route


class RoomPayload(BaseModel):
    room_code: str
    name: str
    location: str | None = None
    floor_plan_url: str | None = None
    description: str | None = None


class CabinetPayload(BaseModel):
    cabinet_code: str
    room_id: int
    cabinet_type_id: int | None = None
    name: str
    location_x: float | None = None
    location_y: float | None = None
    photo_url: str | None = None


class DeviceItemPayload(BaseModel):
    item_code: str
    cabinet_id: int
    name: str
    item_type: str
    unit: str | None = None
    expected_state: str | None = None
    roi_x: float | None = None
    roi_y: float | None = None
    roi_width: float | None = None
    roi_height: float | None = None
    warning_min: float | None = None
    warning_max: float | None = None
    alarm_min: float | None = None
    alarm_max: float | None = None


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
        'active': cabinet.is_active,
    }


def _item_json(item: DeviceItem) -> dict:
    rule = item.threshold_rules[0] if item.threshold_rules else None
    return {
        'id': item.id,
        'itemCode': item.item_code,
        'cabinetId': item.cabinet_id,
        'name': item.name,
        'itemType': item.item_type,
        'unit': item.unit,
        'expectedState': item.expected_state,
        'roi': [item.roi_x, item.roi_y, item.roi_width, item.roi_height],
        'threshold': {
            'warningMin': rule.warning_min,
            'warningMax': rule.warning_max,
            'alarmMin': rule.alarm_min,
            'alarmMax': rule.alarm_max,
            'expectedState': rule.expected_state,
            'severity': rule.severity,
        } if rule else None,
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
    }


def _route_json(route: Route) -> dict:
    return {
        'id': route.id,
        'routeCode': route.route_code,
        'roomId': route.room_id,
        'name': route.name,
        'description': route.description,
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
                    'status': record.status,
                    'progress': record.progress,
                    'currentSequence': record.current_sequence,
                    'pointTotal': record.point_total,
                    'failureReason': record.failure_reason,
                    'startedAt': record.started_at.isoformat(sep=' ') if record.started_at else None,
                    'finishedAt': record.finished_at.isoformat(sep=' ') if record.finished_at else None,
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
        return seed_standard_data(db)

    @router.post('/rooms')
    def create_room(payload: RoomPayload, current_user=auth, db: Session = Depends(get_db)):
        if db.query(Room).filter(Room.room_code == payload.room_code).first():
            raise HTTPException(status_code=409, detail='电房编码已存在')
        room = Room(**payload.model_dump())
        db.add(room)
        _add_system_log(db, current_user, '设备管理', '新增电房', f'{payload.room_code} {payload.name}')
        db.commit()
        db.refresh(room)
        return _room_json(room)

    @router.post('/cabinets')
    def create_cabinet(payload: CabinetPayload, current_user=auth, db: Session = Depends(get_db)):
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

    @router.post('/device-items')
    def create_device_item(payload: DeviceItemPayload, current_user=auth, db: Session = Depends(get_db)):
        if db.query(DeviceItem).filter(DeviceItem.item_code == payload.item_code).first():
            raise HTTPException(status_code=409, detail='监测对象编码已存在')
        if db.get(Cabinet, payload.cabinet_id) is None:
            raise HTTPException(status_code=404, detail='所属电柜不存在')
        values = payload.model_dump()
        rule_values = {key: values.pop(key) for key in ['warning_min', 'warning_max', 'alarm_min', 'alarm_max']}
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
        _add_system_log(db, current_user, '巡检任务管理', '下发实车路线', f'{task_id} → {payload.vehicle_id}')
        db.commit()
        return {
            'taskId': task_id,
            'recordId': record.id,
            'vehicleId': payload.vehicle_id,
            'goalCount': len(goals),
            'vehicleResponse': vehicle_response,
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
