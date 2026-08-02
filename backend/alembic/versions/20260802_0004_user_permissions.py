"""为系统用户增加可配置的功能权限矩阵。"""

from alembic import op
import sqlalchemy as sa


revision = '20260802_0004'
down_revision = '20260801_0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'users' not in inspector.get_table_names():
        return
    existing = {column['name'] for column in inspector.get_columns('users')}
    if 'permissions' not in existing:
        op.add_column('users', sa.Column('permissions', sa.JSON(), nullable=True))


def downgrade() -> None:
    # 权限数据属于安全配置，降级时保留字段，避免意外丢失授权记录。
    pass
