"""Mensajes con la hora real de cada INSERT (orden estable del historial).

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union

from alembic import op

revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # now() devuelve la hora de inicio de la transacción: el mensaje del usuario y la respuesta de NEXUS guardados
    # juntos quedaban empatados y el historial podía invertirlos. clock_timestamp() avanza en cada INSERT.
    op.execute("ALTER TABLE agent_messages ALTER COLUMN created_at SET DEFAULT clock_timestamp()")


def downgrade() -> None:
    op.execute("ALTER TABLE agent_messages ALTER COLUMN created_at SET DEFAULT now()")
