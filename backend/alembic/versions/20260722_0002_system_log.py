"""增加系统操作审计日志表。"""

from alembic import op
import sqlalchemy as sa


revision = '20260722_0002'
down_revision = '20260722_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if 'tb_system_log' in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        'tb_system_log',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('username', sa.String(length=50), nullable=False),
        sa.Column('module', sa.String(length=50), nullable=False),
        sa.Column('action', sa.String(length=80), nullable=False),
        sa.Column('content', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(length=80), nullable=True),
        sa.Column('result', sa.String(length=30), nullable=False, server_default='成功'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_tb_system_log_user_id', 'tb_system_log', ['user_id'])
    op.create_index('ix_tb_system_log_username', 'tb_system_log', ['username'])
    op.create_index('ix_tb_system_log_module', 'tb_system_log', ['module'])


def downgrade() -> None:
    op.drop_table('tb_system_log')
