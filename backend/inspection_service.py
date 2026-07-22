from datetime import datetime
from uuid import uuid4

from sqlalchemy.orm import Session

try:
    from .models import Alarm, AlarmProcess, DeviceItem, RecognitionResult, ThresholdRule
except ImportError:
    from models import Alarm, AlarmProcess, DeviceItem, RecognitionResult, ThresholdRule


def _parse_numeric(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def evaluate_result(
    item: DeviceItem,
    value: str | None,
    numeric_value: float | None,
    confidence: float | None,
) -> tuple[str, str | None, ThresholdRule | None]:
    """依据监测对象配置判定真实 AI 上报，不信任客户端预先给出的状态。"""

    rule = next((candidate for candidate in item.threshold_rules if candidate.is_active), None)
    if confidence is not None and confidence < 60:
        return '异常', f'识别置信度过低：{confidence:.1f}%', rule
    if rule and numeric_value is not None:
        if rule.alarm_min is not None and numeric_value < rule.alarm_min:
            return '告警', f'{numeric_value}{item.unit or ""} 低于告警下限 {rule.alarm_min}', rule
        if rule.alarm_max is not None and numeric_value > rule.alarm_max:
            return '告警', f'{numeric_value}{item.unit or ""} 高于告警上限 {rule.alarm_max}', rule
        if rule.warning_min is not None and numeric_value < rule.warning_min:
            return '异常', f'{numeric_value}{item.unit or ""} 低于预警下限 {rule.warning_min}', rule
        if rule.warning_max is not None and numeric_value > rule.warning_max:
            return '异常', f'{numeric_value}{item.unit or ""} 高于预警上限 {rule.warning_max}', rule
    expected = rule.expected_state if rule and rule.expected_state else item.expected_state
    if expected and value != expected:
        return '告警', f'识别状态 {value or "--"}，期望状态 {expected}', rule
    return '正常', None, rule


def apply_threshold_rules(db: Session, result: RecognitionResult) -> Alarm | None:
    """把真实识别结果关联到监测对象，自动判定并生成或合并告警。"""

    item = None
    if result.device_item_id:
        item = db.get(DeviceItem, result.device_item_id)
    if item is None and result.item_code:
        item = db.query(DeviceItem).filter(DeviceItem.item_code == result.item_code).first()
    if item is None:
        return None

    result.device_item_id = item.id
    result.item_code = item.item_code
    result.unit = result.unit or item.unit
    numeric_value = result.numeric_value
    if numeric_value is None and item.item_type == 'value':
        numeric_value = _parse_numeric(result.recognition_value)
        result.numeric_value = numeric_value

    status, reason, rule = evaluate_result(
        item,
        result.recognition_value or result.recognition_state,
        numeric_value,
        result.confidence,
    )
    result.status = status
    result.review_status = '待复核' if status != '正常' else '无需复核'
    if status == '正常':
        return None

    open_alarm = (
        db.query(Alarm)
        .filter(Alarm.item_id == item.id, Alarm.status != '已关闭')
        .order_by(Alarm.created_at.desc())
        .first()
    )
    if open_alarm:
        open_alarm.result_id = result.result_id
        open_alarm.task_id = result.task_id
        open_alarm.description = reason
        open_alarm.processes.append(AlarmProcess(
            action='重复上报',
            from_status=open_alarm.status,
            to_status=open_alarm.status,
            remark=reason,
            operator='阈值规则引擎',
        ))
        return open_alarm

    alarm = Alarm(
        alarm_code=f'ALM-{datetime.now():%Y%m%d%H%M%S}-{uuid4().hex[:6].upper()}',
        result_id=result.result_id,
        task_id=result.task_id,
        item_id=item.id,
        status='待确认',
        severity=rule.severity if rule else '一般',
        title=f'{item.name}识别异常',
        description=reason,
        threshold_snapshot={
            'warningMin': rule.warning_min if rule else None,
            'warningMax': rule.warning_max if rule else None,
            'alarmMin': rule.alarm_min if rule else None,
            'alarmMax': rule.alarm_max if rule else None,
            'expectedState': rule.expected_state if rule else item.expected_state,
        },
    )
    alarm.processes.append(AlarmProcess(
        action='自动生成',
        from_status=None,
        to_status='待确认',
        remark=reason,
        operator='阈值规则引擎',
    ))
    db.add(alarm)
    return alarm
