"""补全设备视觉配置与机器人心跳档案字段。"""

from alembic import op
import sqlalchemy as sa


revision = '20260801_0003'
down_revision = '20260722_0002'
branch_labels = None
depends_on = None


def _add_missing_columns(table_name: str, definitions: dict[str, sa.Column]) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return
    existing = {column['name'] for column in inspector.get_columns(table_name)}
    for name, column in definitions.items():
        if name not in existing:
            op.add_column(table_name, column)


def upgrade() -> None:
    _add_missing_columns('tb_device_item', {
        'recognition_type': sa.Column('recognition_type', sa.String(length=50), nullable=True),
        'camera_role': sa.Column('camera_role', sa.String(length=30), nullable=True),
        'reference_image_url': sa.Column('reference_image_url', sa.String(length=500), nullable=True),
        'inspection_point_id': sa.Column('inspection_point_id', sa.Integer(), nullable=True),
    })
    _add_missing_columns('tb_robot', {
        'agent_base_url': sa.Column('agent_base_url', sa.String(length=500), nullable=True),
        'ssh_host': sa.Column('ssh_host', sa.String(length=160), nullable=True),
        'camera_roles': sa.Column('camera_roles', sa.JSON(), nullable=True),
        'voltage': sa.Column('voltage', sa.Float(), nullable=True),
        'last_seen_at': sa.Column('last_seen_at', sa.DateTime(), nullable=True),
        'last_error': sa.Column('last_error', sa.String(length=500), nullable=True),
        'is_active': sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
    })

    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'tb_device_item' not in inspector.get_table_names():
        return
    indexes = {tuple(index.get('column_names') or []) for index in inspector.get_indexes('tb_device_item')}
    if ('inspection_point_id',) not in indexes:
        op.create_index('ix_tb_device_item_inspection_point_id', 'tb_device_item', ['inspection_point_id'])
    foreign_keys = {
        tuple(foreign_key.get('constrained_columns') or [])
        for foreign_key in sa.inspect(bind).get_foreign_keys('tb_device_item')
    }
    if bind.dialect.name != 'sqlite' and ('inspection_point_id',) not in foreign_keys:
        op.create_foreign_key(
            'fk_tb_device_item_inspection_point_id',
            'tb_device_item',
            'tb_inspection_point',
            ['inspection_point_id'],
            ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    # 生产主数据不可逆删除；回滚时保留字段和已有配置。
    pass
