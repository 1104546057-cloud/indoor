"""Allow normalized point writes beside preserved legacy task-point fields."""

from alembic import op
import sqlalchemy as sa


revision = '20260813_0007'
down_revision = '20260813_0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'tb_inspection_point' not in inspector.get_table_names():
        return
    columns = {column['name']: column for column in inspector.get_columns('tb_inspection_point')}
    legacy_types = {
        'point_id': sa.String(length=120),
        'point_name': sa.String(length=160),
        'status': sa.String(length=40),
    }
    for name, existing_type in legacy_types.items():
        column = columns.get(name)
        if column is not None and not column['nullable']:
            op.alter_column(
                'tb_inspection_point',
                name,
                existing_type=existing_type,
                nullable=True,
            )


def downgrade() -> None:
    # Restoring NOT NULL could discard or invalidate normalized records.
    pass
