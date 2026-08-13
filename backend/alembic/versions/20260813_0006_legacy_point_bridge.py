"""Bridge the legacy task-point table to the normalized business point model.

Some early installations already used ``tb_inspection_point`` for task payloads.
The original baseline deliberately preserved that table, but did not add the
columns later consumed by the device-management API.
"""

from alembic import op
import sqlalchemy as sa


revision = '20260813_0006'
down_revision = '20260813_0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'tb_inspection_point' not in inspector.get_table_names():
        return

    columns = {column['name'] for column in inspector.get_columns('tb_inspection_point')}
    additions = {
        'point_code': sa.Column('point_code', sa.String(length=80), nullable=True),
        'room_id': sa.Column('room_id', sa.Integer(), nullable=True),
        'cabinet_id': sa.Column('cabinet_id', sa.Integer(), nullable=True),
        'name': sa.Column('name', sa.String(length=160), nullable=True),
        'x': sa.Column('x', sa.Float(), nullable=True),
        'y': sa.Column('y', sa.Float(), nullable=True),
        'yaw': sa.Column('yaw', sa.Float(), nullable=True, server_default='0'),
        'camera_pan': sa.Column('camera_pan', sa.Float(), nullable=True, server_default='0'),
        'camera_tilt': sa.Column('camera_tilt', sa.Float(), nullable=True, server_default='0'),
        'is_active': sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column('tb_inspection_point', column)

    # Retain the old task fields and mirror their useful values into the new view.
    columns = {column['name'] for column in sa.inspect(bind).get_columns('tb_inspection_point')}
    if 'point_id' in columns:
        bind.execute(sa.text(
            "UPDATE tb_inspection_point SET point_code = COALESCE(point_code, point_id)"
        ))
    if 'point_name' in columns:
        bind.execute(sa.text(
            "UPDATE tb_inspection_point SET name = COALESCE(name, point_name)"
        ))
    legacy_code = "CONCAT('legacy-', id)" if bind.dialect.name == 'mysql' else "'legacy-' || CAST(id AS VARCHAR)"
    legacy_name = "CONCAT('Legacy point ', id)" if bind.dialect.name == 'mysql' else "'Legacy point ' || CAST(id AS VARCHAR)"
    bind.execute(sa.text(
        "UPDATE tb_inspection_point "
        f"SET point_code = COALESCE(point_code, {legacy_code}), "
        f"name = COALESCE(name, point_code, {legacy_name}), "
        "x = COALESCE(x, 0), y = COALESCE(y, 0), yaw = COALESCE(yaw, 0), "
        "camera_pan = COALESCE(camera_pan, 0), camera_tilt = COALESCE(camera_tilt, 0), "
        "is_active = COALESCE(is_active, 1)"
    ))

    inspector = sa.inspect(bind)
    indexed = {column for index in inspector.get_indexes('tb_inspection_point') for column in index['column_names']}
    for column in ('point_code', 'room_id', 'cabinet_id'):
        if column not in indexed:
            op.create_index(f'ix_tb_inspection_point_{column}', 'tb_inspection_point', [column])


def downgrade() -> None:
    # Preserve compatibility columns and legacy data.
    pass
