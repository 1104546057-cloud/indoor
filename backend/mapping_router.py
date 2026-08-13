from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

try:
    from .database import get_db
    from .models import InspectionPoint, Room, RoomMap, Route, SystemLog
    from .permissions import require_permission
    from .vehicle_client import (
        activate_vehicle_map,
        discard_mapping,
        get_live_map_png,
        get_mapping_status,
        get_vehicle_map_file,
        save_mapping,
        set_vehicle_initial_pose,
        start_mapping,
        stop_mapping,
    )
except ImportError:
    from database import get_db
    from models import InspectionPoint, Room, RoomMap, Route, SystemLog
    from permissions import require_permission
    from vehicle_client import (
        activate_vehicle_map,
        discard_mapping,
        get_live_map_png,
        get_mapping_status,
        get_vehicle_map_file,
        save_mapping,
        set_vehicle_initial_pose,
        start_mapping,
        stop_mapping,
    )


MAP_ASSET_ROOT = Path(
    os.getenv('ROOM_MAP_ASSET_DIR', Path(__file__).with_name('map_assets'))
).resolve()


class VehicleSelection(BaseModel):
    vehicle_id: str = Field(min_length=1, max_length=80)


class SaveMapPayload(VehicleSelection):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class ImportCurrentMapPayload(VehicleSelection):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=2000)


class ActivateMapPayload(BaseModel):
    vehicle_id: str | None = Field(default=None, max_length=80)


class InitialPosePayload(BaseModel):
    vehicle_id: str | None = Field(default=None, max_length=80)
    x: float
    y: float
    yaw: float


def _room_map_json(room_map: RoomMap) -> dict:
    return {
        'id': room_map.id,
        'mapCode': room_map.map_code,
        'roomId': room_map.room_id,
        'name': room_map.name,
        'version': room_map.version,
        'vehicleId': room_map.vehicle_id,
        'status': room_map.status,
        'active': room_map.is_active,
        'resolution': room_map.resolution,
        'width': room_map.width,
        'height': room_map.height,
        'origin': [room_map.origin_x, room_map.origin_y, 0.0],
        'description': room_map.description,
        'createdBy': room_map.created_by,
        'createdAt': room_map.created_at.isoformat(sep=' ') if room_map.created_at else None,
        'activatedAt': room_map.activated_at.isoformat(sep=' ') if room_map.activated_at else None,
        'previewUrl': f'/api/business/maps/{room_map.id}/preview',
    }


def _require_room(db: Session, room_id: int) -> Room:
    room = db.get(Room, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail='电房档案不存在')
    return room


def _log(db: Session, user, action: str, content: str) -> None:
    db.add(SystemLog(
        user_id=getattr(user, 'id', None),
        username=getattr(user, 'username', 'system'),
        module='device_resources',
        action=action,
        content=content,
    ))


def create_mapping_router(get_current_user: Callable) -> APIRouter:
    router = APIRouter(prefix='/api/business', tags=['mapping'])
    auth = Depends(get_current_user)

    @router.get('/rooms/{room_id}/maps')
    def list_room_maps(room_id: int, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'view')
        room = _require_room(db, room_id)
        maps = db.query(RoomMap).filter(RoomMap.room_id == room_id).order_by(RoomMap.version.desc()).all()
        return {'room': {'id': room.id, 'roomCode': room.room_code, 'name': room.name}, 'maps': [_room_map_json(item) for item in maps]}

    @router.post('/rooms/{room_id}/mapping/start', status_code=202)
    def begin_mapping(room_id: int, payload: VehicleSelection, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'update')
        room = _require_room(db, room_id)
        status = start_mapping(payload.vehicle_id)
        _log(db, current_user, 'mapping_start', f'{room.room_code} 使用 {payload.vehicle_id} 开始建图')
        db.commit()
        return {'roomId': room_id, 'vehicleId': payload.vehicle_id, **status}

    @router.get('/rooms/{room_id}/mapping/status')
    def mapping_status(room_id: int, vehicle_id: str, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'view')
        _require_room(db, room_id)
        return get_mapping_status(vehicle_id)

    @router.get('/rooms/{room_id}/mapping/live.png')
    def live_mapping_image(room_id: int, vehicle_id: str, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'view')
        _require_room(db, room_id)
        body, content_type = get_live_map_png(vehicle_id)
        return Response(content=body, media_type=content_type, headers={'Cache-Control': 'no-store'})

    @router.post('/rooms/{room_id}/mapping/stop')
    def halt_mapping(room_id: int, payload: VehicleSelection, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'update')
        _require_room(db, room_id)
        return stop_mapping(payload.vehicle_id)

    @router.post('/rooms/{room_id}/mapping/discard')
    def abandon_mapping(room_id: int, payload: VehicleSelection, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'update')
        room = _require_room(db, room_id)
        status = discard_mapping(payload.vehicle_id)
        _log(db, current_user, 'mapping_discard', f'{room.room_code} 放弃本次建图')
        db.commit()
        return status

    @router.post('/rooms/{room_id}/mapping/save', status_code=201)
    def persist_mapping(room_id: int, payload: SaveMapPayload, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'create')
        room = _require_room(db, room_id)
        stopped = stop_mapping(payload.vehicle_id)
        if stopped.get('mode') != 'mapping_stopped':
            raise HTTPException(status_code=409, detail='车辆未能安全停止建图，地图未保存')
        next_version = int(db.query(func.max(RoomMap.version)).filter(RoomMap.room_id == room_id).scalar() or 0) + 1
        map_code = f'room{room_id}_v{next_version}_{datetime.now():%Y%m%d%H%M%S}'
        metadata = save_mapping(payload.vehicle_id, map_code)
        target_dir = MAP_ASSET_ROOT / f'room_{room_id}' / map_code
        temporary_dir = target_dir.with_name(target_dir.name + '.tmp')
        if temporary_dir.exists():
            shutil.rmtree(temporary_dir)
        temporary_dir.mkdir(parents=True, exist_ok=False)
        try:
            yaml_body, _ = get_vehicle_map_file(payload.vehicle_id, map_code, 'yaml')
            pgm_body, _ = get_vehicle_map_file(payload.vehicle_id, map_code, 'pgm')
            preview_body, _ = get_live_map_png(payload.vehicle_id)
            (temporary_dir / 'map.yaml').write_bytes(yaml_body)
            (temporary_dir / 'map.pgm').write_bytes(pgm_body)
            (temporary_dir / 'preview.png').write_bytes(preview_body)
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            temporary_dir.replace(target_dir)
        except Exception:
            shutil.rmtree(temporary_dir, ignore_errors=True)
            raise

        origin = metadata.get('origin') or [None, None]
        room_map = RoomMap(
            map_code=map_code,
            room_id=room_id,
            name=payload.name.strip(),
            version=next_version,
            vehicle_id=payload.vehicle_id,
            status='saved',
            resolution=metadata.get('resolution'),
            width=metadata.get('width'),
            height=metadata.get('height'),
            origin_x=origin[0],
            origin_y=origin[1],
            yaml_path=str(target_dir / 'map.yaml'),
            pgm_path=str(target_dir / 'map.pgm'),
            preview_path=str(target_dir / 'preview.png'),
            description=payload.description,
            created_by=getattr(current_user, 'username', None),
        )
        db.add(room_map)
        _log(db, current_user, 'mapping_save', f'{room.room_code} 保存地图 {map_code}')
        db.commit()
        db.refresh(room_map)
        return {'map': _room_map_json(room_map), 'vehicle': metadata}

    @router.post('/rooms/{room_id}/maps/import-current', status_code=201)
    def import_current_map(room_id: int, payload: ImportCurrentMapPayload, current_user=auth, db: Session = Depends(get_db)):
        """Archive the map currently active on a vehicle without starting SLAM again."""

        require_permission(current_user, 'device_resources', 'create')
        room = _require_room(db, room_id)
        metadata = get_mapping_status(payload.vehicle_id)
        map_code = metadata.get('active_map_id')
        if not map_code:
            raise HTTPException(status_code=409, detail='车端没有可导入的当前导航地图')
        existing = db.query(RoomMap).filter(RoomMap.map_code == map_code).first()
        if existing is not None:
            if existing.room_id == room_id:
                return {'map': _room_map_json(existing), 'vehicle': metadata, 'imported': False}
            raise HTTPException(status_code=409, detail='该车端地图已归档到其他电房')

        next_version = int(db.query(func.max(RoomMap.version)).filter(RoomMap.room_id == room_id).scalar() or 0) + 1
        target_dir = MAP_ASSET_ROOT / f'room_{room_id}' / map_code
        temporary_dir = target_dir.with_name(target_dir.name + '.tmp')
        if temporary_dir.exists():
            shutil.rmtree(temporary_dir)
        temporary_dir.mkdir(parents=True, exist_ok=False)
        try:
            yaml_body, _ = get_vehicle_map_file(payload.vehicle_id, map_code, 'yaml')
            pgm_body, _ = get_vehicle_map_file(payload.vehicle_id, map_code, 'pgm')
            preview_body, _ = get_live_map_png(payload.vehicle_id)
            (temporary_dir / 'map.yaml').write_bytes(yaml_body)
            (temporary_dir / 'map.pgm').write_bytes(pgm_body)
            (temporary_dir / 'preview.png').write_bytes(preview_body)
            target_dir.parent.mkdir(parents=True, exist_ok=True)
            temporary_dir.replace(target_dir)
        except Exception:
            shutil.rmtree(temporary_dir, ignore_errors=True)
            raise

        map_metadata = metadata.get('map') or {}
        origin = map_metadata.get('origin') or [None, None]
        room_map = RoomMap(
            map_code=map_code,
            room_id=room_id,
            name=payload.name.strip(),
            version=next_version,
            vehicle_id=payload.vehicle_id,
            status='active',
            is_active=True,
            resolution=map_metadata.get('resolution'),
            width=map_metadata.get('width'),
            height=map_metadata.get('height'),
            origin_x=origin[0],
            origin_y=origin[1],
            yaml_path=str(target_dir / 'map.yaml'),
            pgm_path=str(target_dir / 'map.pgm'),
            preview_path=str(target_dir / 'preview.png'),
            description=payload.description,
            created_by=getattr(current_user, 'username', None),
            activated_at=datetime.now(),
        )
        db.query(RoomMap).filter(RoomMap.room_id == room_id).update({'is_active': False})
        db.add(room_map)
        _log(db, current_user, 'map_import', f'{room.room_code} 导入车端地图 {map_code}')
        db.commit()
        db.refresh(room_map)
        return {'map': _room_map_json(room_map), 'vehicle': metadata, 'imported': True}

    @router.get('/maps/{map_id}/preview')
    def map_preview(map_id: int, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'view')
        room_map = db.get(RoomMap, map_id)
        if room_map is None or not Path(room_map.preview_path).is_file():
            raise HTTPException(status_code=404, detail='地图预览不存在')
        return FileResponse(room_map.preview_path, media_type='image/png', headers={'Cache-Control': 'private, max-age=60'})

    @router.post('/maps/{map_id}/activate')
    def activate_map(map_id: int, payload: ActivateMapPayload, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'update')
        room_map = db.get(RoomMap, map_id)
        if room_map is None:
            raise HTTPException(status_code=404, detail='地图版本不存在')
        vehicle_id = payload.vehicle_id or room_map.vehicle_id
        if vehicle_id != room_map.vehicle_id:
            raise HTTPException(status_code=409, detail='首版仅支持由建图车辆激活该地图')
        status = activate_vehicle_map(vehicle_id, room_map.map_code)
        db.query(RoomMap).filter(RoomMap.room_id == room_map.room_id).update({'is_active': False})
        room_map.is_active = True
        room_map.status = 'active'
        room_map.vehicle_id = vehicle_id
        room_map.activated_at = datetime.now()
        _log(db, current_user, 'map_activate', f'启用地图 {room_map.map_code}，车辆 {vehicle_id}')
        db.commit()
        return {'map': _room_map_json(room_map), 'vehicle': status}

    @router.post('/maps/{map_id}/initial-pose')
    def publish_initial_pose(map_id: int, payload: InitialPosePayload, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'update')
        room_map = db.get(RoomMap, map_id)
        if room_map is None:
            raise HTTPException(status_code=404, detail='地图版本不存在')
        if not room_map.is_active:
            raise HTTPException(status_code=409, detail='只能在当前启用地图上设置初始位姿')
        vehicle_id = payload.vehicle_id or room_map.vehicle_id
        status = set_vehicle_initial_pose(vehicle_id, payload.x, payload.y, payload.yaw)
        _log(db, current_user, 'initial_pose', f'{room_map.map_code} 设置初始位姿 ({payload.x}, {payload.y}, {payload.yaw})')
        db.commit()
        return status

    @router.delete('/maps/{map_id}')
    def delete_map(map_id: int, current_user=auth, db: Session = Depends(get_db)):
        require_permission(current_user, 'device_resources', 'delete')
        room_map = db.get(RoomMap, map_id)
        if room_map is None:
            raise HTTPException(status_code=404, detail='地图版本不存在')
        if room_map.is_active:
            raise HTTPException(status_code=409, detail='当前导航地图不能删除，请先启用其他版本')
        if db.query(InspectionPoint).filter(InspectionPoint.map_id == map_id).first() or db.query(Route).filter(Route.map_id == map_id).first():
            raise HTTPException(status_code=409, detail='地图已绑定巡检点或路线，不能删除')
        asset_dir = Path(room_map.preview_path).parent
        _log(db, current_user, 'map_delete', f'删除地图 {room_map.map_code}')
        db.delete(room_map)
        db.commit()
        shutil.rmtree(asset_dir, ignore_errors=True)
        return {'deleted': True}

    return router
