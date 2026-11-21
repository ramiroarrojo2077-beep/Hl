"""active job idempotency

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-21 13:09:55.611166
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy


revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint(op.f('uq_jobs_idempotency'), 'jobs', type_='unique')
    op.create_index('uq_jobs_active_idempotency', 'jobs', ['idempotency_key'], unique=True, postgresql_where=sa.text("status IN ('queued', 'running')"))


def downgrade() -> None:
    op.drop_index('uq_jobs_active_idempotency', table_name='jobs', postgresql_where=sa.text("status IN ('queued', 'running')"))
    op.create_unique_constraint(op.f('uq_jobs_idempotency'), 'jobs', ['idempotency_key'], postgresql_nulls_not_distinct=False)
