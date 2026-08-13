"""Add power-room-owned SLAM map versions and bind points/routes to a map."""

from alembic import op
import sqlalchemy as sa


revision = '20260813_0005'
down_revision = '20260802_0004'
branch_labels = None
depends_on = None


def _columns(inspector, table):
    return {column['name'] for column in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'tb_room_map' not in tables:
        op.create_table(
            'tb_room_map',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('map_code', sa.String(length=80), nullable=False),
            sa.Column('room_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=160), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('vehicle_id', sa.String(length=80), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='saved'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('resolution', sa.Float(), nullable=True),
            sa.Column('width', sa.Integer(), nullable=True),
            sa.Column('height', sa.Integer(), nullable=True),
            sa.Column('origin_x', sa.Float(), nullable=True),
            sa.Column('origin_y', sa.Float(), nullable=True),
            sa.Column('yaml_path', sa.String(length=500), nullable=False),
            sa.Column('pgm_path', sa.String(length=500), nullable=False),
            sa.Column('preview_path', sa.String(length=500), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('created_by', sa.String(length=80), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('activated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['room_id'], ['tb_room.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('room_id', 'version', name='uq_room_map_version'),
            sa.UniqueConstraint('map_code'),
        )
        op.create_index('ix_tb_room_map_map_code', 'tb_room_map', ['map_code'], unique=True)
        op.create_index('ix_tb_room_map_room_id', 'tb_room_map', ['room_id'])
        op.create_index('ix_tb_room_map_vehicle_id', 'tb_room_map', ['vehicle_id'])
        op.create_index('ix_tb_room_map_is_active', 'tb_room_map', ['is_active'])

    inspector = sa.inspect(bind)
    if 'tb_inspection_point' in inspector.get_table_names() and 'map_id' not in _columns(inspector, 'tb_inspection_point'):
        op.add_column('tb_inspection_point', sa.Column('map_id', sa.Integer(), nullable=True))
        op.create_index('ix_tb_inspection_point_map_id', 'tb_inspection_point', ['map_id'])
        op.create_foreign_key('fk_inspection_point_map', 'tb_inspection_point', 'tb_room_map', ['map_id'], ['id'])

    inspector = sa.inspect(bind)
    if 'tb_route' in inspector.get_table_names() and 'map_id' not in _columns(inspector, 'tb_route'):
        op.add_column('tb_route', sa.Column('map_id', sa.Integer(), nullable=True))
        op.create_index('ix_tb_route_map_id', 'tb_route', ['map_id'])
        op.create_foreign_key('fk_route_map', 'tb_route', 'tb_room_map', ['map_id'], ['id'])


def downgrade() -> None:
    # Map files and their business bindings are operational records. Keep them on downgrade.
    pass
