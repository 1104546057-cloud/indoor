"""Persist and monitor ordered vehicle-route executions.

The vehicle agent remains the authority for whether each move_base goal was
reached.  This module mirrors that state into the business database so route
completion does not depend on a browser tab staying open.
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

try:
    from .database import SessionLocal
    from .models import InspectionRecord, InspectionTask, RecognitionResult, Robot, Route
    from .recognition_client import capture_recognition
    from .vehicle_client import get_navigation_route_status
except ImportError:
    from database import SessionLocal
    from models import InspectionRecord, InspectionTask, RecognitionResult, Robot, Route
    from recognition_client import capture_recognition
    from vehicle_client import get_navigation_route_status


TERMINAL_NAVIGATION_STATES = {'completed', 'failed', 'cancelled'}
ACTIVE_NAVIGATION_STATES = {'queued', 'moving', 'arrived'}
LOCALIZED_TASK_STATES = {'待执行', '执行中', '已完成', '异常', '待审核'}
MONITOR_INTERVAL_SECONDS = max(0.2, float(os.getenv('ROUTE_MONITOR_INTERVAL_SECONDS', '1.0')))
MONITOR_MAX_SECONDS = max(60.0, float(os.getenv('ROUTE_MONITOR_MAX_SECONDS', str(24 * 60 * 60))))
AUTO_CAPTURE_ON_ARRIVAL = os.getenv('AUTO_CAPTURE_ON_ARRIVAL', 'true').lower() in {'1', 'true', 'yes'}

_monitor_lock = threading.Lock()
_active_monitors: set[tuple[str, str]] = set()


def extract_navigation(response: dict | None) -> dict:
    if not isinstance(response, dict):
        return {}
    navigation = response.get('navigation')
    return navigation if isinstance(navigation, dict) else response


def navigation_execution_id(response: dict | None) -> str | None:
    navigation = extract_navigation(response)
    value = navigation.get('execution_id')
    return str(value) if value else None


def _task_uses_localized_status(task: InspectionTask) -> bool:
    return task.status in LOCALIZED_TASK_STATES or (task.task_payload or {}).get('source') != 'real-vehicle'


def _task_status(task: InspectionTask, navigation_state: str) -> str:
    localized = _task_uses_localized_status(task)
    if navigation_state in ACTIVE_NAVIGATION_STATES:
        return '执行中' if localized else 'running'
    if navigation_state == 'completed':
        return '已完成' if localized else 'completed'
    if navigation_state == 'failed':
        return '异常' if localized else 'failed'
    if navigation_state == 'cancelled':
        return '待审核' if localized else 'cancelled'
    return task.status


def _ensure_robot(db: Session, vehicle_id: str) -> Robot:
    robot = db.query(Robot).filter(Robot.robot_code == vehicle_id).first()
    if robot is None:
        robot = Robot(
            robot_code=vehicle_id,
            name=vehicle_id,
            adapter_mode='real',
            status='navigating',
            online=True,
        )
        db.add(robot)
        db.flush()
    return robot


def _route_database_id(db: Session, task: InspectionTask) -> int | None:
    if not task.route_id:
        return None
    route = db.query(Route).filter(Route.route_code == task.route_id).first()
    return route.id if route else None


def _workflow_payload(task: InspectionTask) -> dict:
    payload = dict(task.task_payload or {})
    workflow = dict(payload.get('routeWorkflow') or {})
    payload['routeWorkflow'] = workflow
    return payload


def _record_for_workflow(db: Session, task: InspectionTask, workflow: dict) -> InspectionRecord | None:
    record_id = workflow.get('recordId')
    if record_id:
        record = db.get(InspectionRecord, int(record_id))
        if record is not None and record.task_id == task.task_id:
            return record
    return (
        db.query(InspectionRecord)
        .filter(InspectionRecord.task_id == task.task_id)
        .order_by(InspectionRecord.created_at.desc())
        .first()
    )


def begin_route_execution(
    db: Session,
    task_id: str | None,
    vehicle_id: str,
    response: dict,
    *,
    record_id: int | None = None,
) -> dict | None:
    """Create/activate the persistent execution record after dispatch succeeds."""

    if not task_id:
        return None
    task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
    if task is None:
        return None

    navigation = extract_navigation(response)
    execution_id = navigation_execution_id(response)
    total = int(navigation.get('route_total') or task.point_total or len(task.route_points) or 0)
    robot = _ensure_robot(db, vehicle_id)
    record = db.get(InspectionRecord, record_id) if record_id else None
    if record is None:
        record = InspectionRecord(
            record_code=f'REC-{datetime.now():%Y%m%d%H%M%S}-{uuid4().hex[:6].upper()}',
            task_id=task.task_id,
            route_id=_route_database_id(db, task),
            robot_id=robot.id,
            status='running',
            progress=0,
            current_sequence=0,
            point_total=total,
            started_at=datetime.now(),
        )
        db.add(record)
        db.flush()

    record.robot_id = robot.id
    record.status = 'running'
    record.progress = 0
    record.current_sequence = 0
    record.point_total = total
    record.finished_at = None
    record.failure_reason = None
    task.status = _task_status(task, navigation.get('state') or 'queued')
    task.progress = 0
    task.point_total = total
    robot.status = 'navigating'
    robot.online = True

    payload = _workflow_payload(task)
    payload['routeWorkflow'].update({
        'executionId': execution_id,
        'recordId': record.id,
        'vehicleId': vehicle_id,
        'startedAt': datetime.now().isoformat(timespec='seconds'),
        'updatedAt': datetime.now().isoformat(timespec='seconds'),
        'navigation': navigation,
    })
    task.task_payload = payload
    db.commit()
    return {
        'taskId': task.task_id,
        'recordId': record.id,
        'executionId': execution_id,
        'status': task.status,
        'progress': task.progress,
    }


def mark_route_dispatch_failed(db: Session, task_id: str | None, vehicle_id: str, reason: str) -> None:
    if not task_id:
        return
    task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
    if task is None:
        return
    task.status = _task_status(task, 'failed')
    robot = _ensure_robot(db, vehicle_id)
    robot.status = 'fault'
    payload = _workflow_payload(task)
    payload['routeWorkflow'].update({
        'vehicleId': vehicle_id,
        'updatedAt': datetime.now().isoformat(timespec='seconds'),
        'dispatchError': reason,
    })
    task.task_payload = payload
    db.commit()


def sync_route_execution(
    db: Session,
    task_id: str | None,
    vehicle_id: str,
    response: dict,
) -> dict | None:
    """Idempotently mirror one authoritative vehicle-agent snapshot."""

    navigation = extract_navigation(response)
    effective_task_id = task_id or navigation.get('task_id')
    if not effective_task_id or not navigation:
        return None
    task = db.query(InspectionTask).filter(InspectionTask.task_id == effective_task_id).first()
    if task is None:
        return None

    payload = _workflow_payload(task)
    workflow = payload['routeWorkflow']
    execution_id = navigation.get('execution_id')
    stored_execution_id = workflow.get('executionId')
    if stored_execution_id and execution_id and stored_execution_id != execution_id:
        return None

    record = _record_for_workflow(db, task, workflow)
    if record is None:
        started = begin_route_execution(db, task.task_id, vehicle_id, response)
        if started is None:
            return None
        task = db.query(InspectionTask).filter(InspectionTask.task_id == effective_task_id).first()
        payload = _workflow_payload(task)
        workflow = payload['routeWorkflow']
        record = db.get(InspectionRecord, started['recordId'])

    state = str(navigation.get('state') or 'moving')
    total = max(0, int(navigation.get('route_total') or record.point_total or task.point_total or 0))
    reached = max(0, min(total, int(navigation.get('reached_count') or 0))) if total else 0
    progress = 100 if state == 'completed' else (round(reached * 100 / total) if total else 0)
    failure_reason = navigation.get('last_error')

    task.status = _task_status(task, state)
    task.progress = progress
    task.point_total = total
    record.status = state if state in TERMINAL_NAVIGATION_STATES else 'running'
    record.progress = progress
    record.current_sequence = reached
    record.point_total = total
    record.failure_reason = str(failure_reason)[:255] if failure_reason else None

    robot = _ensure_robot(db, vehicle_id)
    robot.online = True
    if state == 'completed':
        robot.status = 'idle'
    elif state == 'failed':
        robot.status = 'fault'
    elif state == 'cancelled':
        robot.status = 'idle'
    else:
        robot.status = 'navigating'

    if state in TERMINAL_NAVIGATION_STATES and record.finished_at is None:
        record.finished_at = datetime.now()

    abnormal_count = (
        db.query(RecognitionResult)
        .filter(
            RecognitionResult.task_id == task.task_id,
            RecognitionResult.status.in_(['异常', '告警']),
        )
        .count()
    )
    pending_review_count = (
        db.query(RecognitionResult)
        .filter(
            RecognitionResult.task_id == task.task_id,
            RecognitionResult.status.in_(['异常', '告警']),
            RecognitionResult.review_status == '待复核',
        )
        .count()
    )
    workflow.update({
        'executionId': execution_id or workflow.get('executionId'),
        'recordId': record.id,
        'vehicleId': vehicle_id,
        'updatedAt': datetime.now().isoformat(timespec='seconds'),
        'completedAt': datetime.now().isoformat(timespec='seconds') if state in TERMINAL_NAVIGATION_STATES else None,
        'navigation': navigation,
        'postExecution': {
            'archiveReady': state in TERMINAL_NAVIGATION_STATES,
            'abnormalCount': abnormal_count,
            'reviewStatus': '待复核' if pending_review_count else '无需复核' if abnormal_count == 0 else '已复核',
            'reportReady': state == 'completed' and pending_review_count == 0,
        },
    })
    task.task_payload = payload
    db.commit()
    return {
        'taskId': task.task_id,
        'recordId': record.id,
        'executionId': workflow.get('executionId'),
        'status': task.status,
        'recordStatus': record.status,
        'progress': progress,
        'currentSequence': reached,
        'pointTotal': total,
        'archiveReady': state in TERMINAL_NAVIGATION_STATES,
        'reportReady': workflow['postExecution']['reportReady'],
        'reviewStatus': workflow['postExecution']['reviewStatus'],
    }


def refresh_post_execution_state(db: Session, task_id: str | None) -> dict | None:
    """Recalculate review/report readiness after AI upload or manual review."""

    if not task_id:
        return None
    task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
    if task is None:
        return None
    payload = _workflow_payload(task)
    workflow = payload['routeWorkflow']
    navigation_state = (workflow.get('navigation') or {}).get('state')
    if navigation_state not in TERMINAL_NAVIGATION_STATES:
        return None

    abnormal_count = (
        db.query(RecognitionResult)
        .filter(
            RecognitionResult.task_id == task.task_id,
            RecognitionResult.status.in_(['异常', '告警']),
        )
        .count()
    )
    pending_review_count = (
        db.query(RecognitionResult)
        .filter(
            RecognitionResult.task_id == task.task_id,
            RecognitionResult.status.in_(['异常', '告警']),
            RecognitionResult.review_status == '待复核',
        )
        .count()
    )
    review_status = '待复核' if pending_review_count else '无需复核' if abnormal_count == 0 else '已复核'
    post_execution = dict(workflow.get('postExecution') or {})
    post_execution.update({
        'archiveReady': True,
        'abnormalCount': abnormal_count,
        'reviewStatus': review_status,
        'reportReady': navigation_state == 'completed' and pending_review_count == 0,
    })
    workflow['postExecution'] = post_execution
    workflow['updatedAt'] = datetime.now().isoformat(timespec='seconds')
    task.task_payload = payload

    if navigation_state == 'completed':
        localized = _task_uses_localized_status(task)
        task.status = (
            ('待审核' if localized else 'review_pending')
            if pending_review_count
            else ('已完成' if localized else 'completed')
        )
    db.commit()
    return post_execution


def _update_capture_event(task_id: str, point_key: str, **values) -> None:
    with SessionLocal() as db:
        task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
        if task is None:
            return
        payload = _workflow_payload(task)
        workflow = payload['routeWorkflow']
        events = dict(workflow.get('captureEvents') or {})
        event = dict(events.get(point_key) or {})
        event.update(values)
        events[point_key] = event
        workflow['captureEvents'] = events
        workflow['updatedAt'] = datetime.now().isoformat(timespec='seconds')
        task.task_payload = payload
        db.commit()


def _trigger_arrival_captures(task_id: str, vehicle_id: str, navigation: dict) -> None:
    if not AUTO_CAPTURE_ON_ARRIVAL:
        return
    for result in navigation.get('results') or []:
        if result.get('state') != 'arrived':
            continue
        # A route may visit the same inspection point more than once.  The
        # route sequence therefore participates in the key so every arrival
        # gets its own capture event and retry state.
        point_key = f"sequence-{result.get('index')}:{result.get('point_id') or 'anonymous'}"
        with SessionLocal() as db:
            task = db.query(InspectionTask).filter(InspectionTask.task_id == task_id).first()
            if task is None:
                return
            workflow = _workflow_payload(task)['routeWorkflow']
            existing = (workflow.get('captureEvents') or {}).get(point_key) or {}
            if existing.get('status') in {'requested', 'accepted'} or int(existing.get('attempts') or 0) >= 3:
                continue
            attempts = int(existing.get('attempts') or 0) + 1

        _update_capture_event(
            task_id,
            point_key,
            status='requested',
            attempts=attempts,
            pointId=result.get('point_id'),
            pointName=result.get('point_name'),
            requestedAt=datetime.now().isoformat(timespec='seconds'),
        )
        try:
            capture_response = capture_recognition(None, {
                'taskId': task_id,
                'robotId': vehicle_id,
                'pointId': result.get('point_id'),
                'pointName': result.get('point_name'),
                'routeIndex': result.get('index'),
                'source': result.get('source'),
            })
            _update_capture_event(
                task_id,
                point_key,
                status='accepted',
                acceptedAt=datetime.now().isoformat(timespec='seconds'),
                response=capture_response,
            )
        except Exception as error:
            _update_capture_event(
                task_id,
                point_key,
                status='failed',
                failedAt=datetime.now().isoformat(timespec='seconds'),
                error=str(getattr(error, 'detail', error))[:500],
            )


def _monitor_route(task_id: str, vehicle_id: str, execution_id: str) -> None:
    key = (vehicle_id, execution_id)
    deadline = time.monotonic() + MONITOR_MAX_SECONDS
    try:
        while time.monotonic() < deadline:
            try:
                response = get_navigation_route_status(vehicle_id, execution_id)
                navigation = extract_navigation(response)
                with SessionLocal() as db:
                    sync_route_execution(db, task_id, vehicle_id, response)
                _trigger_arrival_captures(task_id, vehicle_id, navigation)
                if navigation.get('state') in TERMINAL_NAVIGATION_STATES:
                    return
            except HTTPException:
                # A temporary Wi-Fi or agent outage must not turn a still-running
                # route into a failed business record. Reconnect and continue.
                pass
            except Exception:
                pass
            time.sleep(MONITOR_INTERVAL_SECONDS)
    finally:
        with _monitor_lock:
            _active_monitors.discard(key)


def start_route_monitor(task_id: str | None, vehicle_id: str, execution_id: str | None) -> bool:
    if not task_id or not execution_id:
        return False
    key = (vehicle_id, execution_id)
    with _monitor_lock:
        if key in _active_monitors:
            return False
        _active_monitors.add(key)
    thread = threading.Thread(
        target=_monitor_route,
        args=(task_id, vehicle_id, execution_id),
        name=f'route-monitor-{execution_id[-8:]}',
        daemon=True,
    )
    thread.start()
    return True


def resume_route_monitors() -> int:
    """Resume database-known running routes after a backend restart."""

    resumed = 0
    with SessionLocal() as db:
        tasks = db.query(InspectionTask).filter(InspectionTask.status.in_(['执行中', 'running'])).all()
        for task in tasks:
            workflow = (task.task_payload or {}).get('routeWorkflow') or {}
            if start_route_monitor(task.task_id, workflow.get('vehicleId') or task.robot or 'nano1', workflow.get('executionId')):
                resumed += 1
    return resumed
