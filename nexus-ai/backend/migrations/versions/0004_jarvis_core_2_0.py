"""jarvis core 2.0

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-21 17:27:26.451438
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy
from sqlalchemy.dialects import postgresql

revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('automations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('trigger_type', sa.String(length=20), nullable=False),
    sa.Column('cron', sa.String(length=120), nullable=True),
    sa.Column('run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('timezone', sa.String(length=60), nullable=False),
    sa.Column('event_type', sa.String(length=60), nullable=True),
    sa.Column('conditions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('actions', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('max_runs_per_day', sa.Integer(), nullable=False),
    sa.Column('max_total_runs', sa.Integer(), nullable=True),
    sa.Column('cooldown_seconds', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('paused_by_stop', sa.Boolean(), nullable=False),
    sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_status', sa.String(length=40), nullable=True),
    sa.Column('run_count', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_automations_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_automations'))
    )
    op.create_index('ix_automations_due', 'automations', ['status', 'next_run_at'], unique=False)
    op.create_index('ix_automations_event', 'automations', ['user_id', 'event_type'], unique=False)
    op.create_table('crash_reports',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('app_version', sa.String(length=40), nullable=False),
    sa.Column('device', sa.String(length=120), nullable=False),
    sa.Column('stacktrace', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_crash_reports_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_crash_reports'))
    )
    op.create_index(op.f('ix_crash_reports_user_id'), 'crash_reports', ['user_id'], unique=False)
    op.create_table('automation_runs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('automation_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('trigger', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['automation_id'], ['automations.id'], name=op.f('fk_automation_runs_automation_id_automations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_automation_runs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_automation_runs'))
    )
    op.create_index(op.f('ix_automation_runs_automation_id'), 'automation_runs', ['automation_id'], unique=False)
    op.create_table('action_requests',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('conversation_id', sa.UUID(), nullable=True),
    sa.Column('action_key', sa.String(length=60), nullable=False),
    sa.Column('category', sa.String(length=30), nullable=False),
    sa.Column('executor', sa.String(length=10), nullable=False),
    sa.Column('params', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('state_detail', sa.String(length=40), nullable=True),
    sa.Column('requires_confirmation', sa.Boolean(), nullable=False),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('source', sa.String(length=20), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], name=op.f('fk_action_requests_conversation_id_conversations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_action_requests_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_action_requests'))
    )
    op.create_index('ix_action_requests_user_status', 'action_requests', ['user_id', 'status'], unique=False)
    op.create_table('business_messages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('action_id', sa.UUID(), nullable=True),
    sa.Column('direction', sa.String(length=10), nullable=False),
    sa.Column('to_hash', sa.String(length=64), nullable=False),
    sa.Column('to_encrypted', sa.Text(), nullable=False),
    sa.Column('to_masked', sa.String(length=32), nullable=False),
    sa.Column('opt_in_confirmed', sa.Boolean(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('template', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('wa_message_id', sa.String(length=200), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('status_history', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['action_id'], ['action_requests.id'], name=op.f('fk_business_messages_action_id_action_requests'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_business_messages_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_business_messages'))
    )
    op.create_index(op.f('ix_business_messages_to_hash'), 'business_messages', ['to_hash'], unique=False)
    op.create_index(op.f('ix_business_messages_user_id'), 'business_messages', ['user_id'], unique=False)
    op.create_index('ix_business_messages_wa', 'business_messages', ['wa_message_id'], unique=False)
    op.create_table('model_quality_scores',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('model_id', sa.UUID(), nullable=True),
    sa.Column('model_label', sa.String(length=200), nullable=True),
    sa.Column('task_type', sa.String(length=30), nullable=False),
    sa.Column('source', sa.String(length=30), nullable=False),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('message_id', sa.UUID(), nullable=True),
    sa.Column('criteria', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('overall', sa.Float(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['message_id'], ['agent_messages.id'], name=op.f('fk_model_quality_scores_message_id_agent_messages'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_model_quality_scores_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['model_id'], ['ai_models.id'], name=op.f('fk_model_quality_scores_model_id_ai_models'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['mission_tasks.id'], name=op.f('fk_model_quality_scores_task_id_mission_tasks'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_model_quality_scores_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_model_quality_scores'))
    )
    op.create_index('ix_model_quality_model_task', 'model_quality_scores', ['model_id', 'task_type', 'created_at'], unique=False)
    op.create_index(op.f('ix_model_quality_scores_user_id'), 'model_quality_scores', ['user_id'], unique=False)
    op.add_column('conversations', sa.Column('kind', sa.String(length=20), server_default='chat', nullable=False))
    op.add_column('conversations', sa.Column('summary', sa.Text(), nullable=True))
    op.add_column('conversations', sa.Column('summary_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('memory_items', sa.Column('category', sa.String(length=30), server_default='general', nullable=False))
    op.add_column('memory_items', sa.Column('last_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('memory_items', sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('missions', sa.Column('automation_id', sa.UUID(), nullable=True))
    op.create_foreign_key(op.f('fk_missions_automation_id_automations'), 'missions', 'automations', ['automation_id'], ['id'], ondelete='SET NULL')
    op.add_column('user_settings', sa.Column('voice_settings', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('user_settings', sa.Column('jarvis_settings', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('user_settings', sa.Column('privacy_settings', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False))
    op.add_column('user_settings', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('user_settings', 'last_seen_at')
    op.drop_column('user_settings', 'privacy_settings')
    op.drop_column('user_settings', 'jarvis_settings')
    op.drop_column('user_settings', 'voice_settings')
    op.drop_constraint(op.f('fk_missions_automation_id_automations'), 'missions', type_='foreignkey')
    op.drop_column('missions', 'automation_id')
    op.drop_column('memory_items', 'last_used_at')
    op.drop_column('memory_items', 'last_verified_at')
    op.drop_column('memory_items', 'category')
    op.drop_column('conversations', 'summary_until')
    op.drop_column('conversations', 'summary')
    op.drop_column('conversations', 'kind')
    op.drop_index(op.f('ix_model_quality_scores_user_id'), table_name='model_quality_scores')
    op.drop_index('ix_model_quality_model_task', table_name='model_quality_scores')
    op.drop_table('model_quality_scores')
    op.drop_index('ix_business_messages_wa', table_name='business_messages')
    op.drop_index(op.f('ix_business_messages_user_id'), table_name='business_messages')
    op.drop_index(op.f('ix_business_messages_to_hash'), table_name='business_messages')
    op.drop_table('business_messages')
    op.drop_index('ix_action_requests_user_status', table_name='action_requests')
    op.drop_table('action_requests')
    op.drop_index(op.f('ix_automation_runs_automation_id'), table_name='automation_runs')
    op.drop_table('automation_runs')
    op.drop_index(op.f('ix_crash_reports_user_id'), table_name='crash_reports')
    op.drop_table('crash_reports')
    op.drop_index('ix_automations_event', table_name='automations')
    op.drop_index('ix_automations_due', table_name='automations')
    op.drop_table('automations')
