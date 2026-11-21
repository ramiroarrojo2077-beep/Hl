"""agent persona

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-21 13:01:13.391259
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy
from sqlalchemy.dialects import postgresql

revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('agent_profiles', sa.Column('traits', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('agent_profiles', sa.Column('appearance', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('agent_profiles', sa.Column('voice', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))


def downgrade() -> None:
    op.drop_column('agent_profiles', 'voice')
    op.drop_column('agent_profiles', 'appearance')
    op.drop_column('agent_profiles', 'traits')
