from __future__ import annotations

from copy import deepcopy

from fastapi import HTTPException


PERMISSION_ACTIONS = ('view', 'create', 'update', 'delete')
PERMISSION_MODULES = (
    'patrol_monitor',
    'device_resources',
    'patrol_tasks',
    'ai_review',
    'alarm_loop',
    'user_management',
)


def _matrix(default: bool = False) -> dict[str, dict[str, bool]]:
    return {
        module: {action: default for action in PERMISSION_ACTIONS}
        for module in PERMISSION_MODULES
    }


def default_permissions(role: str | None) -> dict[str, dict[str, bool]]:
    role_name = (role or 'viewer').strip().lower()
    if role_name == 'admin':
        return _matrix(True)

    permissions = _matrix(False)
    if role_name == 'operator':
        for module in ('patrol_monitor', 'device_resources', 'patrol_tasks', 'ai_review', 'alarm_loop'):
            permissions[module].update(view=True, create=True, update=True)
        return permissions

    for module in ('patrol_monitor', 'device_resources', 'patrol_tasks', 'ai_review', 'alarm_loop'):
        permissions[module]['view'] = True
    return permissions


def normalize_permissions(
    role: str | None,
    permissions: dict | None,
) -> dict[str, dict[str, bool]]:
    normalized = deepcopy(default_permissions(role))
    if not isinstance(permissions, dict):
        return normalized

    for module in PERMISSION_MODULES:
        module_permissions = permissions.get(module)
        if not isinstance(module_permissions, dict):
            continue
        for action in PERMISSION_ACTIONS:
            if action in module_permissions:
                normalized[module][action] = bool(module_permissions[action])
    return normalized


def effective_permissions(user) -> dict[str, dict[str, bool]]:
    return normalize_permissions(
        getattr(user, 'role', None),
        getattr(user, 'permissions', None),
    )


def has_permission(user, module: str, action: str = 'view') -> bool:
    if module not in PERMISSION_MODULES or action not in PERMISSION_ACTIONS:
        return False
    return effective_permissions(user)[module][action]


def require_permission(user, module: str, action: str = 'view') -> None:
    if not has_permission(user, module, action):
        raise HTTPException(status_code=403, detail=f'缺少权限：{module}.{action}')
