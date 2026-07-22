"""建立可视化业务闭环所需的规范化核心表。

该基线兼容已经由 SQLAlchemy create_all 创建过四张原型表的开发数据库。
"""

from alembic import op
import sqlalchemy as sa

from backend.database import Base
from backend import models  # noqa: F401


revision = '20260722_0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # create_all(checkfirst=True) 只补不存在的表，保留原型环境已有业务数据。
    Base.metadata.create_all(bind=bind, checkfirst=True)

    if 'tb_recognition_result' in existing_tables:
        columns = {column['name'] for column in sa.inspect(bind).get_columns('tb_recognition_result')}
        additions = {
            'inspection_record_id': sa.Column('inspection_record_id', sa.Integer(), nullable=True),
            'image_id': sa.Column('image_id', sa.Integer(), nullable=True),
            'device_item_id': sa.Column('device_item_id', sa.Integer(), nullable=True),
            'numeric_value': sa.Column('numeric_value', sa.Float(), nullable=True),
        }
        for name, column in additions.items():
            if name not in columns:
                op.add_column('tb_recognition_result', column)
                op.create_index(f'ix_tb_recognition_result_{name}', 'tb_recognition_result', [name])


def downgrade() -> None:
    # 这是从原型数据库升级的保护性基线，不自动删除可能已有业务数据。
    pass
