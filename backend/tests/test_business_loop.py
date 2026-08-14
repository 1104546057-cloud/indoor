import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4


database_path = Path(tempfile.gettempdir()) / f'indoor-patrol-real-{uuid4().hex}.db'
os.environ['DATABASE_URL'] = f'sqlite:///{database_path.as_posix()}'
os.environ['AUTO_CREATE_TABLES'] = 'false'

from fastapi.testclient import TestClient  # noqa: E402

import backend.business_router as business_router_module  # noqa: E402
import backend.mapping_router as mapping_router_module  # noqa: E402
import backend.main as main_module  # noqa: E402
import backend.vehicle_client as vehicle_client_module  # noqa: E402
from backend.database import Base, SessionLocal, engine, get_db  # noqa: E402
from backend.inspection_service import evaluate_result  # noqa: E402
from backend.main import app, get_current_user  # noqa: E402


Base.metadata.create_all(bind=engine)


def override_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_db
app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(
    username='test-admin', nickname='测试管理员', role='admin', is_active=True
)
client = TestClient(app)


def test_navigation_route_status_proxy(monkeypatch):
    def capture_status(vehicle_id, execution_id):
        assert vehicle_id == 'nano1'
        assert execution_id == 'route-test-001'
        return {
            'vehicle_id': vehicle_id,
            'navigation': {
                'execution_id': execution_id,
                'state': 'moving',
                'route_index': 2,
                'route_total': 4,
                'reached_count': 1,
            },
        }

    monkeypatch.setattr(main_module, 'get_navigation_route_status', capture_status)
    response = client.get(
        '/api/vehicle/navigation-route/status',
        params={'vehicle_id': 'nano1', 'execution_id': 'route-test-001'},
    )
    assert response.status_code == 200
    assert response.json()['navigation']['route_index'] == 2


def test_navigation_route_cancel_proxy(monkeypatch):
    def capture_cancel(vehicle_id, execution_id):
        assert vehicle_id == 'nano1'
        assert execution_id == 'route-test-001'
        return {
            'vehicle_id': vehicle_id,
            'navigation': {
                'execution_id': execution_id,
                'state': 'cancelled',
                'active': False,
            },
        }

    monkeypatch.setattr(main_module, 'cancel_navigation_route', capture_cancel)
    response = client.post(
        '/api/vehicle/navigation-route/cancel',
        json={'vehicle_id': 'nano1', 'execution_id': 'route-test-001'},
    )
    assert response.status_code == 200
    assert response.json()['navigation']['state'] == 'cancelled'


def test_vehicle_camera_roles_resolve_only_configured_streams():
    vehicle = {
        'camera_stream_url': 'http://inspection-camera/',
        'movement_camera_stream_url': 'http://movement-camera/',
        'camera_streams': {'high': 'http://high-camera/'},
    }
    assert vehicle_client_module._camera_stream_url(vehicle, 'movement') == 'http://movement-camera/'
    assert vehicle_client_module._camera_stream_url(vehicle, 'inspection') == 'http://inspection-camera/'
    assert vehicle_client_module._camera_stream_url(vehicle, 'high') == 'http://high-camera/'
    assert vehicle_client_module._camera_stream_url(vehicle, 'middle') is None


def test_direct_task_route_is_persisted_and_archived_on_vehicle_completion(monkeypatch):
    task_id = f'task-route-workflow-{uuid4().hex}'
    point = {
        'id': 'LAB-FREE-WORKFLOW-001',
        'name': '业务闭环测试点',
        'targetName': '业务闭环测试点',
        'x': 72000,
        'y': 17000,
        'yaw': 'east',
    }
    created = client.post('/api/tasks', json={
        'id': task_id,
        'sceneId': 'lab-building',
        'name': '路线完成自动归档测试',
        'area': '实验楼一层',
        'robot': 'nano1',
        'pointIds': [point['id']],
        'routePoints': [point],
        'status': '待执行',
        'detail': {'pointTotal': 1},
    })
    assert created.status_code == 200

    execution_id = f'route-{uuid4().hex}'

    def dispatch(_vehicle_id, payload):
        return {
            'online': True,
            'navigation': {
                'execution_id': execution_id,
                'task_id': payload['task_id'],
                'state': 'queued',
                'route_index': 0,
                'route_total': 1,
                'reached_count': 0,
                'results': [],
            },
        }

    monkeypatch.setattr(main_module, 'send_navigation_route', dispatch)
    monkeypatch.setattr(main_module, 'start_route_monitor', lambda *_args: True)
    started = client.post('/api/vehicle/navigation-route', json={
        'vehicle_id': 'nano1',
        'task_id': task_id,
        'speed': 0.2,
        'goals': [{
            'frame_id': 'map',
            'x': 1.2,
            'y': 2.4,
            'yaw': 0,
            'point_id': point['id'],
            'point_name': point['name'],
        }],
    })
    assert started.status_code == 200
    assert started.json()['business']['status'] == '执行中'
    record_id = started.json()['business']['recordId']

    def completed_status(_vehicle_id, requested_execution_id):
        assert requested_execution_id == execution_id
        return {
            'vehicle_id': 'nano1',
            'navigation': {
                'execution_id': execution_id,
                'task_id': task_id,
                'state': 'completed',
                'route_index': 1,
                'route_total': 1,
                'reached_count': 1,
                'last_error': None,
                'results': [{
                    'index': 1,
                    'point_id': point['id'],
                    'point_name': point['name'],
                    'state': 'arrived',
                    'finished_at': 1785501000.0,
                    'move_base_state': 3,
                }],
            },
        }

    monkeypatch.setattr(main_module, 'get_navigation_route_status', completed_status)
    completed = client.get('/api/vehicle/navigation-route/status', params={
        'vehicle_id': 'nano1',
        'execution_id': execution_id,
    })
    assert completed.status_code == 200
    assert completed.json()['business']['archiveReady'] is True
    assert completed.json()['business']['reportReady'] is True

    tasks = client.get('/api/tasks').json()['tasks']
    stored_task = next(task for task in tasks if task['id'] == task_id)
    assert stored_task['status'] == '已完成'
    assert stored_task['progress'] == 100

    overview = client.get('/api/business/overview').json()
    record = next(item for item in overview['records'] if item['id'] == record_id)
    assert record['status'] == 'completed'
    assert record['progress'] == 100
    assert record['currentSequence'] == 1
    assert record['finishedAt'] is not None
    assert record['navigation']['results'][0]['state'] == 'arrived'

    recognition = client.post('/api/recognition/results', json={
        'taskId': task_id,
        'robotId': 'nano1',
        'pointId': point['id'],
        'targetName': '测试温度表',
        'recognitionType': '数显识别',
        'recognitionValue': '82.5',
        'numericValue': 82.5,
        'unit': '°C',
        'confidence': 98.2,
        'status': '异常',
    })
    assert recognition.status_code == 200
    result_id = recognition.json()['result']['id']

    tasks = client.get('/api/tasks').json()['tasks']
    stored_task = next(task for task in tasks if task['id'] == task_id)
    assert stored_task['status'] == '待审核'
    overview = client.get('/api/business/overview').json()
    record = next(item for item in overview['records'] if item['id'] == record_id)
    assert record['postExecution']['abnormalCount'] == 1
    assert record['postExecution']['reviewStatus'] == '待复核'
    assert record['postExecution']['reportReady'] is False

    reviewed = client.post(f'/api/recognition/results/{result_id}/review', json={
        'review_status': '已确认',
        'review_remark': '自动化测试复核完成',
        'reviewed_by': 'tester',
    })
    assert reviewed.status_code == 200
    tasks = client.get('/api/tasks').json()['tasks']
    stored_task = next(task for task in tasks if task['id'] == task_id)
    assert stored_task['status'] == '已完成'
    overview = client.get('/api/business/overview').json()
    record = next(item for item in overview['records'] if item['id'] == record_id)
    assert record['postExecution']['reviewStatus'] == '已复核'
    assert record['postExecution']['reportReady'] is True

    with SessionLocal() as db:
        recognition_result = db.get(business_router_module.RecognitionResult, result_id)
        if recognition_result is not None:
            db.delete(recognition_result)
        workflow_record = db.get(business_router_module.InspectionRecord, record_id)
        if workflow_record is not None:
            db.delete(workflow_record)
        db.commit()
    deleted = client.delete(f'/api/tasks/{task_id}')
    assert deleted.status_code == 200
    with SessionLocal() as db:
        robot = db.query(business_router_module.Robot).filter(
            business_router_module.Robot.robot_code == 'nano1'
        ).first()
        if robot is not None:
            db.delete(robot)
        db.commit()


def test_real_vehicle_business_loop(monkeypatch):
    dispatched = {}

    def capture_real_dispatch(vehicle_id, payload):
        dispatched['vehicle_id'] = vehicle_id
        dispatched['payload'] = payload
        return {'accepted': True, 'source': 'vehicle-agent'}

    monkeypatch.setattr(business_router_module, 'send_navigation_route', capture_real_dispatch)

    seed = client.post('/api/business/seed')
    assert seed.status_code == 200
    business = client.get('/api/business/overview').json()
    assert len(business['rooms']) == 1
    assert len(business['cabinets']) == 3
    assert len(business['deviceItems']) == 3
    assert len(business['points']) == 3
    assert len(business['routes']) == 1
    assert business['robots'] == []

    started = client.post(
        f"/api/business/routes/{business['routes'][0]['id']}/start",
        json={'vehicle_id': 'nano1', 'speed': 0.6},
    )
    assert started.status_code == 200
    start_data = started.json()
    assert start_data['goalCount'] == 3
    assert dispatched['vehicle_id'] == 'nano1'
    assert dispatched['payload']['task_id'] == start_data['taskId']
    assert [goal['point_id'] for goal in dispatched['payload']['goals']] == [
        'POINT-A01', 'POINT-A02', 'POINT-A03'
    ]

    task_id = start_data['taskId']
    progress = client.post(
        f'/api/business/tasks/{task_id}/status',
        json={
            'status': 'running',
            'progress': 34,
            'current_sequence': 1,
            'position_x': 2.1,
            'position_y': 1.2,
            'yaw': 0.2,
            'battery': 87,
        },
    )
    assert progress.status_code == 200
    assert progress.json()['progress'] == 34

    recognition = {
        'taskId': task_id,
        'robotId': 'nano1',
        'roomCode': 'ROOM-A1',
        'cabinetCode': 'CAB-A01',
        'pointId': 'POINT-A01',
        'itemCode': 'ITEM-A01-V',
        'targetName': 'A01 母线电压',
        'recognitionType': 'value',
        'value': '11.6',
        'numericValue': 11.6,
        'confidence': 96.8,
        'imageUrl': '/uploads/nano1/a01-voltage.jpg',
    }
    uploaded = client.post('/api/recognition/results', json=recognition)
    assert uploaded.status_code == 200
    assert uploaded.json()['result']['status'] == '告警'

    repeated = client.post('/api/recognition/results', json=recognition)
    assert repeated.status_code == 200
    assert repeated.json()['result']['status'] == '告警'

    completed = client.post(
        f'/api/business/tasks/{task_id}/status',
        json={'status': 'completed', 'progress': 100, 'current_sequence': 3, 'battery': 81},
    )
    assert completed.status_code == 200

    overview = client.get('/api/business/overview').json()
    record = next(item for item in overview['records'] if item['taskId'] == task_id)
    assert record['status'] == 'completed'
    assert record['progress'] == 100
    assert len([item for item in overview['images'] if item['recordId'] == record['id']]) == 1
    assert len([item for item in overview['results'] if item['taskId'] == task_id]) == 2
    alarms = [item for item in overview['alarms'] if item['taskId'] == task_id]
    assert len(alarms) == 1
    result = next(item for item in overview['results'] if item['taskId'] == task_id)
    assert result['roomCode'] == 'ROOM-A1'
    assert result['pointId'] == 'POINT-A01'
    assert alarms[0]['resultId'] is not None
    assert [process['action'] for process in alarms[0]['processes']] == ['自动生成', '重复上报']

    alarm_id = alarms[0]['id']
    for action, expected_status in [
        ('确认', '已确认'),
        ('派单', '处理中'),
        ('反馈', '待复核'),
        ('关闭', '已关闭'),
    ]:
        response = client.post(
            f'/api/business/alarms/{alarm_id}/transition',
            json={'action': action, 'remark': f'实车协议自动化验证：{action}'},
        )
        assert response.status_code == 200
        assert response.json()['status'] == expected_status


def test_threshold_engine_uses_configured_value_and_state_rules():
    client.post('/api/business/seed')
    with SessionLocal() as db:
        business = client.get('/api/business/overview').json()
        value_item_id = next(item['id'] for item in business['deviceItems'] if item['itemCode'] == 'ITEM-A01-V')
        lamp_item_id = next(item['id'] for item in business['deviceItems'] if item['itemCode'] == 'ITEM-A02-L')
        value_item = db.get(business_router_module.DeviceItem, value_item_id)
        lamp_item = db.get(business_router_module.DeviceItem, lamp_item_id)
        assert evaluate_result(value_item, '10.2', 10.2, 98)[0] == '正常'
        assert evaluate_result(value_item, '11.6', 11.6, 98)[0] == '告警'
        assert evaluate_result(lamp_item, '红灯', None, 98)[0] == '告警'
        assert evaluate_result(value_item, '10.2', 10.2, 42)[0] == '异常'


def test_task_status_callback_rejects_unknown_task():
    response = client.post(
        '/api/business/tasks/TASK-NOT-FOUND/status',
        json={'status': 'running', 'progress': 10},
    )
    assert response.status_code == 404


def test_task_route_point_arrival_direction_is_persisted():
    task_id = f'task-direction-{uuid4().hex}'
    route_point = {
        'id': 'LAB-FREE-001',
        'name': '自由点1',
        'targetName': '自由点1',
        'x': 28000,
        'y': 17000,
        'direction': 'north',
        'yaw': 'north',
    }

    created = client.post('/api/tasks', json={
        'id': task_id,
        'sceneId': 'lab-building',
        'name': '到点朝向持久化测试',
        'robot': 'nano1',
        'pointIds': [route_point['id']],
        'routePoints': [route_point],
        'status': '待执行',
        'detail': {'pointTotal': 1},
    })
    assert created.status_code == 200
    assert created.json()['task']['routePoints'][0]['direction'] == 'north'
    assert created.json()['task']['routePoints'][0]['yaw'] == 'north'

    listed = client.get('/api/tasks')
    assert listed.status_code == 200
    stored_task = next(task for task in listed.json()['tasks'] if task['id'] == task_id)
    assert stored_task['routePoints'][0]['direction'] == 'north'
    assert stored_task['routePoints'][0]['yaw'] == 'north'

    deleted = client.delete(f'/api/tasks/{task_id}')
    assert deleted.status_code == 200


def test_only_unexecuted_task_can_be_edited():
    task_id = f'task-edit-{uuid4().hex}'
    created = client.post('/api/tasks', json={
        'id': task_id,
        'sceneId': 'lab-building',
        'name': '编辑前任务',
        'area': '实验楼一层 / 环形走廊',
        'robot': 'nano1',
        'pointIds': ['LAB-FREE-001'],
        'routePoints': [{
            'id': 'LAB-FREE-001',
            'name': '自由点1',
            'targetName': '自由点1',
            'x': 28000,
            'y': 17000,
            'direction': 'east',
            'yaw': 'east',
        }],
        'start': '2026-08-01 10:00',
        'status': '待执行',
        'priority': '高',
        'detail': {'pointTotal': 1},
    })
    assert created.status_code == 200

    updated = client.put(f'/api/tasks/{task_id}', json={
        'id': task_id,
        'sceneId': 'lab-building',
        'name': '编辑后任务',
        'area': '实验楼一层 / 环形走廊',
        'robot': 'nano2',
        'pointIds': ['LAB-FREE-002', 'LAB-FREE-003'],
        'routePoints': [
            {
                'id': 'LAB-FREE-002',
                'name': '自由点2',
                'targetName': '自由点2',
                'x': 42000,
                'y': 17000,
                'direction': 'south',
                'yaw': 'south',
            },
            {
                'id': 'LAB-FREE-003',
                'name': '自由点3',
                'targetName': '自由点3',
                'x': 42000,
                'y': 32000,
                'direction': 'west',
                'yaw': 'west',
            },
        ],
        'start': '2026-08-01 11:30',
        'status': '待执行',
        'priority': '紧急',
        'detail': {'pointTotal': 2},
    })
    assert updated.status_code == 200
    edited_task = updated.json()['task']
    assert edited_task['id'] == task_id
    assert edited_task['name'] == '编辑后任务'
    assert edited_task['robot'] == 'nano2'
    assert edited_task['start'] == '2026-08-01 11:30'
    assert edited_task['priority'] == '紧急'
    assert [point['id'] for point in edited_task['routePoints']] == ['LAB-FREE-002', 'LAB-FREE-003']
    assert [point['direction'] for point in edited_task['routePoints']] == ['south', 'west']

    with SessionLocal() as db:
        stored_task = db.query(main_module.InspectionTask).filter(
            main_module.InspectionTask.task_id == task_id
        ).first()
        stored_task.status = '执行中'
        db.commit()

    rejected = client.put(f'/api/tasks/{task_id}', json={**edited_task, 'name': '不允许修改'})
    assert rejected.status_code == 409

    with SessionLocal() as db:
        stored_task = db.query(main_module.InspectionTask).filter(
            main_module.InspectionTask.task_id == task_id
        ).first()
        stored_task.status = '待执行'
        db.commit()
    deleted = client.delete(f'/api/tasks/{task_id}')
    assert deleted.status_code == 200


def test_system_user_and_audit_log_are_persisted():
    created = client.post('/api/system/users', json={
        'username': 'operator1',
        'password': 'StrongPass123',
        'nickname': '运维一号',
        'role': 'operator',
    })
    assert created.status_code == 200
    assert created.json()['role'] == 'operator'
    assert created.json()['isActive'] is True
    assert created.json()['permissions']['device_resources']['view'] is True
    assert created.json()['permissions']['device_resources']['delete'] is False

    permissions = created.json()['permissions']
    permissions['device_resources']['delete'] = True
    permission_updated = client.put(
        f"/api/system/users/{created.json()['id']}/permissions",
        json={'permissions': permissions},
    )
    assert permission_updated.status_code == 200
    assert permission_updated.json()['permissions']['device_resources']['delete'] is True

    users = client.get('/api/system/users')
    assert users.status_code == 200
    assert any(user['username'] == 'operator1' for user in users.json()['users'])

    updated = client.patch(
        f"/api/system/users/{created.json()['id']}",
        json={'is_active': False},
    )
    assert updated.status_code == 200
    assert updated.json()['isActive'] is False

    logs = client.get('/api/system/logs').json()['logs']
    assert any(log['action'] == '新增用户' and 'operator1' in log['content'] for log in logs)
    assert any(log['action'] == '更新用户' and 'operator1' in log['content'] for log in logs)
    assert any(log['action'] == '更新功能权限' and 'operator1' in log['content'] for log in logs)


def test_device_management_crud_visual_roi_and_controlled_delete():
    client.post('/api/business/seed')
    suffix = uuid4().hex[:8].upper()
    room_code = f'ROOM-{suffix}'
    room = client.post('/api/business/rooms', json={
        'room_code': room_code,
        'name': 'CRUD 测试电房',
        'location': '实验楼测试区',
        'is_active': True,
    })
    assert room.status_code == 200
    room_id = room.json()['id']
    updated_room = client.put(f'/api/business/rooms/{room_id}', json={
        'room_code': room_code,
        'name': 'CRUD 测试电房（已编辑）',
        'location': '实验楼测试区二',
        'is_active': True,
    })
    assert updated_room.status_code == 200
    assert updated_room.json()['name'].endswith('（已编辑）')

    cabinet_code = f'CAB-{suffix}'
    cabinet = client.post('/api/business/cabinets', json={
        'cabinet_code': cabinet_code,
        'room_id': room_id,
        'name': 'CRUD 测试电柜',
        'location_x': 20,
        'location_y': 30,
        'is_active': True,
    })
    assert cabinet.status_code == 200
    cabinet_id = cabinet.json()['id']
    point = client.post('/api/business/points', json={
        'point_code': f'POINT-{suffix}',
        'room_id': room_id,
        'cabinet_id': cabinet_id,
        'name': 'CRUD 测试巡检点',
        'x': 1.0,
        'y': 2.0,
    })
    assert point.status_code == 200

    item_code = f'ITEM-{suffix}'
    item = client.post('/api/business/device-items', json={
        'item_code': item_code,
        'cabinet_id': cabinet_id,
        'name': 'CRUD 测试电压表',
        'item_type': 'value',
        'unit': 'kV',
        'recognition_type': 'meter',
        'camera_role': 'high',
        'inspection_point_id': point.json()['id'],
        'reference_image_url': '/api/business/assets/example.png',
        'roi_x': 10,
        'roi_y': 15,
        'roi_width': 30,
        'roi_height': 35,
        'is_active': True,
    })
    assert item.status_code == 200
    item_id = item.json()['id']

    rule = client.post('/api/business/threshold-rules', json={
        'item_id': item_id,
        'rule_name': 'CRUD 电压阈值',
        'warning_min': 9.5,
        'warning_max': 10.5,
        'alarm_min': 9.0,
        'alarm_max': 11.0,
        'severity': '重要',
        'is_active': True,
    })
    assert rule.status_code == 200
    rule_id = rule.json()['id']

    invalid_rule = client.put(f'/api/business/threshold-rules/{rule_id}', json={
        'item_id': item_id,
        'rule_name': '错误阈值',
        'warning_min': 12,
        'warning_max': 10,
        'severity': '一般',
        'is_active': True,
    })
    assert invalid_rule.status_code == 422

    overview = client.get('/api/business/overview').json()
    stored_item = next(entry for entry in overview['deviceItems'] if entry['id'] == item_id)
    assert stored_item['cameraRole'] == 'high'
    assert stored_item['inspectionPointId'] == point.json()['id']
    assert stored_item['roi'] == [10.0, 15.0, 30.0, 35.0]
    assert any(entry['id'] == rule_id for entry in overview['thresholdRules'])

    blocked = client.delete(f'/api/business/cabinets/{cabinet_id}?hard=true')
    assert blocked.status_code == 409
    stopped = client.delete(f'/api/business/device-items/{item_id}')
    assert stopped.status_code == 200
    assert stopped.json()['active'] is False


def test_device_asset_image_upload():
    import base64

    content = b'\x89PNG\r\n\x1a\nindoor-patrol-test'
    response = client.post('/api/business/assets/image', json={
        'filename': 'roi-test.png',
        'data_url': f'data:image/png;base64,{base64.b64encode(content).decode()}',
    })
    assert response.status_code == 200
    file_url = response.json()['fileUrl']
    downloaded = client.get(file_url)
    assert downloaded.status_code == 200
    assert downloaded.content == content
    (business_router_module.ASSET_DIRECTORY / file_url.rsplit('/', 1)[-1]).unlink(missing_ok=True)


def test_vehicle_status_cache_includes_battery_and_last_seen(monkeypatch):
    vehicle = {
        'id': 'cache-test-vehicle',
        'name': '缓存测试车',
        'agent_base_url': 'http://vehicle-agent:9000',
        'ssh_host': '192.168.1.50',
        'camera_streams': {},
    }
    calls = []

    def probe(_vehicle):
        calls.append(_vehicle['id'])
        return {
            'online': True,
            'status': 'online',
            'battery': 76.5,
            'voltage': 12.4,
            'last_seen_at': '2026-08-01T12:00:00+08:00',
            'checked_at': '2026-08-01T12:00:00+08:00',
        }

    monkeypatch.setattr(vehicle_client_module, '_VEHICLES', {vehicle['id']: vehicle})
    monkeypatch.setattr(vehicle_client_module, '_DEFAULT_VEHICLE_ID', vehicle['id'])
    monkeypatch.setattr(vehicle_client_module, '_probe_vehicle_status', probe)
    vehicle_client_module._STATUS_CACHE.clear()
    first = vehicle_client_module.list_vehicles()
    second = vehicle_client_module.list_vehicles()
    assert first['vehicles'][0]['battery'] == 76.5
    assert first['vehicles'][0]['last_seen_at'] is not None
    assert second['vehicles'][0]['battery'] == 76.5
    assert calls == [vehicle['id']]


def test_vehicle_registry_and_database_archive_are_updated_together(monkeypatch):
    suffix = uuid4().hex[:8]
    robot_code = f'vehicle-{suffix}'
    registry = {}

    def upsert(vehicle_id, values):
        registry[vehicle_id] = {**registry.get(vehicle_id, {}), **values, 'id': vehicle_id}
        return {key: value for key, value in registry[vehicle_id].items() if key != 'ssh_password'}

    def remove(vehicle_id):
        registry.pop(vehicle_id, None)

    monkeypatch.setattr(business_router_module, 'upsert_vehicle_registry', upsert)
    monkeypatch.setattr(business_router_module, 'remove_vehicle_registry', remove)

    created = client.post('/api/business/robots', json={
        'robot_code': robot_code,
        'name': '车辆档案测试车',
        'agent_base_url': 'http://192.168.31.250:9000',
        'ssh_host': '192.168.31.250',
        'ssh_port': 22,
        'ssh_username': 'nano',
        'ssh_password': 'secret',
        'camera_streams': {'movement': 'http://192.168.31.250:8080/video'},
        'is_active': True,
    })
    assert created.status_code == 200
    robot_id = created.json()['id']
    assert created.json()['robotCode'] == robot_code
    assert registry[robot_code]['camera_streams']['movement'].endswith('/video')

    updated = client.put(f'/api/business/robots/{robot_id}', json={
        'robot_code': robot_code,
        'name': '车辆档案测试车（已编辑）',
        'agent_base_url': 'http://192.168.31.251:9000',
        'ssh_host': '192.168.31.251',
        'camera_streams': {'high': 'http://192.168.31.251:8081/video'},
        'is_active': True,
    })
    assert updated.status_code == 200
    assert updated.json()['name'].endswith('（已编辑）')
    assert registry[robot_code]['agent_base_url'].endswith(':9000')

    deleted = client.delete(f'/api/business/robots/{robot_id}?hard=true')
    assert deleted.status_code == 200
    assert robot_code not in registry


def test_room_mapping_is_saved_versioned_and_activated(monkeypatch, tmp_path):
    room_code = f'ROOM-MAP-{uuid4().hex[:8]}'
    room = client.post('/api/business/rooms', json={
        'room_code': room_code,
        'name': '网页建图测试电房',
        'location': '测试区',
        'is_active': True,
    })
    assert room.status_code == 200
    room_id = room.json()['id']
    monkeypatch.setattr(mapping_router_module, 'MAP_ASSET_ROOT', tmp_path)

    started = []
    monkeypatch.setattr(mapping_router_module, 'start_mapping', lambda vehicle_id: started.append(vehicle_id) or {
        'mode': 'mapping',
        'map': {'available': True, 'revision': 1},
    })
    start_response = client.post(
        f'/api/business/rooms/{room_id}/mapping/start',
        json={'vehicle_id': 'nano1'},
    )
    assert start_response.status_code == 202
    assert started == ['nano1']

    save_sequence = []
    monkeypatch.setattr(mapping_router_module, 'stop_mapping', lambda vehicle_id: save_sequence.append(('stop', vehicle_id)) or {
        'mode': 'mapping_stopped',
    })
    monkeypatch.setattr(mapping_router_module, 'save_mapping', lambda vehicle_id, map_id: save_sequence.append(('save', vehicle_id)) or {
        'map_id': map_id,
        'resolution': 0.05,
        'width': 120,
        'height': 80,
        'origin': [-3.0, -2.0, 0.0],
    })
    monkeypatch.setattr(mapping_router_module, 'get_vehicle_map_file', lambda _vehicle_id, _map_id, kind: (
        b'image: map.pgm\nresolution: 0.05\norigin: [-3.0, -2.0, 0.0]\n'
        if kind == 'yaml' else b'P5\n1 1\n255\n\xfe',
        'application/octet-stream',
    ))
    monkeypatch.setattr(mapping_router_module, 'get_live_map_png', lambda _vehicle_id: (
        b'\x89PNG\r\n\x1a\npreview', 'image/png'
    ))

    saved = client.post(f'/api/business/rooms/{room_id}/mapping/save', json={
        'vehicle_id': 'nano1',
        'name': '测试地图',
        'description': '自动化测试生成',
    })
    assert saved.status_code == 201
    map_record = saved.json()['map']
    assert map_record['roomId'] == room_id
    assert map_record['version'] == 1
    assert map_record['resolution'] == 0.05
    assert save_sequence == [('stop', 'nano1'), ('save', 'nano1')]
    preview = client.get(map_record['previewUrl'])
    assert preview.status_code == 200
    assert preview.content.startswith(b'\x89PNG')

    save_sequence.clear()
    monkeypatch.setattr(mapping_router_module, 'stop_mapping', lambda vehicle_id: save_sequence.append(('stop', vehicle_id)) or {
        'mode': 'mapping',
    })
    rejected_save = client.post(f'/api/business/rooms/{room_id}/mapping/save', json={
        'vehicle_id': 'nano1',
        'name': '不应保存的地图',
    })
    assert rejected_save.status_code == 409
    assert rejected_save.json()['detail'] == '车辆未能安全停止建图，地图未保存'
    assert save_sequence == [('stop', 'nano1')]

    monkeypatch.setattr(mapping_router_module, 'activate_vehicle_map', lambda vehicle_id, map_id: {
        'mode': 'navigation', 'vehicle_id': vehicle_id, 'active_map_id': map_id,
    })
    activated = client.post(
        f'/api/business/maps/{map_record["id"]}/activate',
        json={'vehicle_id': 'nano1'},
    )
    assert activated.status_code == 200
    assert activated.json()['map']['active'] is True

    wrong_vehicle = client.post(
        f'/api/business/maps/{map_record["id"]}/activate',
        json={'vehicle_id': 'nano2'},
    )
    assert wrong_vehicle.status_code == 409

    listing = client.get(f'/api/business/rooms/{room_id}/maps')
    assert listing.status_code == 200
    assert listing.json()['maps'][0]['mapCode'] == map_record['mapCode']
    overview = client.get('/api/business/overview')
    assert any(item['id'] == map_record['id'] for item in overview.json()['maps'])


def test_navigation_route_requires_matching_active_map_and_localization(monkeypatch, tmp_path):
    room = business_router_module.Room(
        room_code=f'ROOM-PLAN-{uuid4().hex[:8]}',
        name='真实计划地图测试电房',
    )
    with SessionLocal() as db:
        db.add(room)
        db.flush()
        room_map = business_router_module.RoomMap(
            map_code=f'map_{uuid4().hex[:8]}',
            room_id=room.id,
            name='计划地图',
            version=1,
            vehicle_id='nano1',
            status='active',
            is_active=True,
            resolution=0.05,
            width=100,
            height=80,
            origin_x=-2.0,
            origin_y=-1.0,
            yaml_path=str(tmp_path / 'map.yaml'),
            pgm_path=str(tmp_path / 'map.pgm'),
            preview_path=str(tmp_path / 'map.png'),
        )
        db.add(room_map)
        db.flush()
        point = business_router_module.InspectionPoint(
            point_code=f'POINT-{uuid4().hex[:8]}',
            room_id=room.id,
            map_id=room_map.id,
            name='真实巡检点',
            x=1.0,
            y=2.0,
            yaw=0.0,
        )
        db.add(point)
        db.flush()
        route = business_router_module.Route(
            route_code=f'ROUTE-{uuid4().hex[:8]}',
            room_id=room.id,
            map_id=room_map.id,
            name='真实巡检路线',
        )
        route.details = [business_router_module.RouteDetail(point_id=point.id, sequence=1, dwell_seconds=2)]
        db.add(route)
        db.commit()
        map_id, route_id, map_code = room_map.id, route.id, room_map.map_code

    dispatched = []
    monkeypatch.setattr(main_module, 'send_navigation_route', lambda vehicle_id, payload: dispatched.append((vehicle_id, payload)) or {'navigation': {'execution_id': 'route-map-check'}})
    monkeypatch.setattr(main_module, 'start_route_monitor', lambda *_args: True)
    monkeypatch.setattr(main_module, 'get_mapping_status', lambda _vehicle_id: {
        'mode': 'navigation',
        'active_map_id': 'another-map',
        'localization': {'valid': True},
    })
    payload = {
        'vehicle_id': 'nano1',
        'map_id': map_id,
        'route_id': route_id,
        'goals': [{'frame_id': 'map', 'x': 1.0, 'y': 2.0, 'yaw': 0.0}],
    }
    mismatch = client.post('/api/vehicle/navigation-route', json=payload)
    assert mismatch.status_code == 409
    assert '当前地图不是' in mismatch.json()['detail']
    assert dispatched == []

    monkeypatch.setattr(main_module, 'get_mapping_status', lambda _vehicle_id: {
        'mode': 'navigation',
        'active_map_id': map_code,
        'localization': {'valid': False, 'last_error': 'AMCL covariance is too large'},
    })
    unlocalized = client.post('/api/vehicle/navigation-route', json=payload)
    assert unlocalized.status_code == 409
    assert '定位未就绪' in unlocalized.json()['detail']
    assert dispatched == []

    monkeypatch.setattr(main_module, 'get_mapping_status', lambda _vehicle_id: {
        'mode': 'navigation',
        'active_map_id': map_code,
        'localization': {'valid': True},
    })
    accepted = client.post('/api/vehicle/navigation-route', json=payload)
    assert accepted.status_code == 200
    assert len(dispatched) == 1


def test_current_vehicle_map_can_be_imported_into_room(monkeypatch, tmp_path):
    room = client.post('/api/business/rooms', json={
        'room_code': f'ROOM-IMPORT-{uuid4().hex[:8]}',
        'name': '现有地图导入电房',
        'location': '测试区',
        'is_active': True,
    })
    room_id = room.json()['id']
    map_code = f'current_{uuid4().hex[:8]}'
    monkeypatch.setattr(mapping_router_module, 'MAP_ASSET_ROOT', tmp_path)
    monkeypatch.setattr(mapping_router_module, 'get_mapping_status', lambda _vehicle_id: {
        'mode': 'navigation',
        'active_map_id': map_code,
        'map': {
            'available': True,
            'resolution': 0.05,
            'width': 32,
            'height': 48,
            'origin': [-1.0, -2.0, 0.0],
        },
    })
    monkeypatch.setattr(mapping_router_module, 'get_vehicle_map_file', lambda _vehicle_id, _map_id, kind: (
        b'image: map.pgm\nresolution: 0.05\n' if kind == 'yaml' else b'P5\n1 1\n255\n\xfe',
        'application/octet-stream',
    ))
    monkeypatch.setattr(mapping_router_module, 'get_live_map_png', lambda _vehicle_id: (
        b'\x89PNG\r\n\x1a\npreview', 'image/png'
    ))

    imported = client.post(f'/api/business/rooms/{room_id}/maps/import-current', json={
        'vehicle_id': 'nano1',
        'name': '原有一层地图',
    })
    assert imported.status_code == 201
    assert imported.json()['imported'] is True
    assert imported.json()['map']['mapCode'] == map_code
    assert imported.json()['map']['active'] is True

    repeated = client.post(f'/api/business/rooms/{room_id}/maps/import-current', json={
        'vehicle_id': 'nano1',
        'name': '不会重复创建',
    })
    assert repeated.status_code == 201
    assert repeated.json()['imported'] is False
