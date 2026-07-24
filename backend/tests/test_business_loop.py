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
