"""initial schema

Revision ID: 0001
Revises: 
Create Date: 2026-11-21 12:37:12.575235
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy
from sqlalchemy.dialects import postgresql

revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table('tool_definitions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('key', sa.String(length=80), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('category', sa.String(length=40), nullable=False),
    sa.Column('operation_class', sa.String(length=30), nullable=False),
    sa.Column('parameters_schema', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('requires_plugin', sa.String(length=80), nullable=True),
    sa.Column('limits', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tool_definitions')),
    sa.UniqueConstraint('key', name=op.f('uq_tool_definitions_key'))
    )
    op.create_table('users',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('email', name=op.f('uq_users_email'))
    )
    op.create_table('agents',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('slug', sa.String(length=40), nullable=False),
    sa.Column('name', sa.String(length=60), nullable=False),
    sa.Column('role', sa.String(length=120), nullable=False),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('status_detail', sa.Text(), nullable=True),
    sa.Column('current_task_id', sa.UUID(), nullable=True),
    sa.Column('last_activity_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('autonomy_level', sa.String(length=20), nullable=False),
    sa.Column('memory_enabled', sa.Boolean(), nullable=False),
    sa.Column('participates_in_meetings', sa.Boolean(), nullable=False),
    sa.Column('daily_budget_usd', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_agents_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_agents')),
    sa.UniqueConstraint('user_id', 'slug', name='uq_agents_user_slug')
    )
    op.create_index('ix_agents_user', 'agents', ['user_id'], unique=False)
    op.create_table('ai_providers',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=30), nullable=False),
    sa.Column('name', sa.String(length=80), nullable=False),
    sa.Column('base_url', sa.String(length=500), nullable=True),
    sa.Column('api_key_encrypted', sa.Text(), nullable=True),
    sa.Column('api_key_hint', sa.String(length=20), nullable=True),
    sa.Column('is_enabled', sa.Boolean(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('known_limits', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('max_concurrency', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_ai_providers_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_providers'))
    )
    op.create_index('ix_ai_providers_user', 'ai_providers', ['user_id'], unique=False)
    op.create_table('device_tokens',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('token', sa.String(length=512), nullable=False),
    sa.Column('platform', sa.String(length=20), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_device_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_device_tokens')),
    sa.UniqueConstraint('token', name=op.f('uq_device_tokens_token'))
    )
    op.create_index('ix_device_tokens_user', 'device_tokens', ['user_id'], unique=False)
    op.create_table('jobs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=True),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('run_after', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('max_attempts', sa.Integer(), nullable=False),
    sa.Column('lease_owner', sa.String(length=120), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('idempotency_key', sa.String(length=200), nullable=True),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_jobs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_jobs')),
    sa.UniqueConstraint('idempotency_key', name='uq_jobs_idempotency')
    )
    op.create_index('ix_jobs_claim', 'jobs', ['status', 'run_after', 'priority'], unique=False)
    op.create_index('ix_jobs_user', 'jobs', ['user_id'], unique=False)
    op.create_table('notifications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('event_type', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('push_status', sa.String(length=20), nullable=False),
    sa.Column('deliver_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_notifications_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notifications'))
    )
    op.create_index('ix_notifications_user_created', 'notifications', ['user_id', 'created_at'], unique=False)
    op.create_table('plugins',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('key', sa.String(length=80), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), nullable=False),
    sa.Column('config_encrypted', sa.Text(), nullable=True),
    sa.Column('config_public', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_plugins_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_plugins')),
    sa.UniqueConstraint('user_id', 'key', name='uq_plugins_user_key')
    )
    op.create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('objective', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('documentation', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_projects_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_projects'))
    )
    op.create_index('ix_projects_user', 'projects', ['user_id'], unique=False)
    op.create_table('refresh_tokens',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('family_id', sa.UUID(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('replaced_by_id', sa.UUID(), nullable=True),
    sa.Column('user_agent', sa.String(length=300), nullable=True),
    sa.Column('ip', sa.String(length=64), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_refresh_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_refresh_tokens')),
    sa.UniqueConstraint('token_hash', name=op.f('uq_refresh_tokens_token_hash'))
    )
    op.create_index(op.f('ix_refresh_tokens_family_id'), 'refresh_tokens', ['family_id'], unique=False)
    op.create_index(op.f('ix_refresh_tokens_user_id'), 'refresh_tokens', ['user_id'], unique=False)
    op.create_table('user_settings',
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('autonomy_mode', sa.String(length=20), nullable=False),
    sa.Column('emergency_stop', sa.Boolean(), nullable=False),
    sa.Column('emergency_stop_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('emergency_stop_reason', sa.Text(), nullable=True),
    sa.Column('daily_budget_usd', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('monthly_budget_usd', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('default_mission_budget_usd', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('max_tokens_per_mission', sa.Integer(), nullable=False),
    sa.Column('max_concurrent_tasks', sa.Integer(), nullable=False),
    sa.Column('language', sa.String(length=10), nullable=False),
    sa.Column('notification_prefs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('appearance', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('memory_settings', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_user_settings_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', name=op.f('pk_user_settings'))
    )
    op.create_table('agent_instructions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_agent_instructions_agent_id_agents'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_agent_instructions')),
    sa.UniqueConstraint('agent_id', 'version', name='uq_agent_instructions_version')
    )
    op.create_index(op.f('ix_agent_instructions_agent_id'), 'agent_instructions', ['agent_id'], unique=False)
    op.create_table('agent_messages',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('channel', sa.String(length=20), nullable=False),
    sa.Column('channel_id', sa.UUID(), nullable=False),
    sa.Column('sender_type', sa.String(length=10), nullable=False),
    sa.Column('sender_agent_id', sa.UUID(), nullable=True),
    sa.Column('recipient_agent_id', sa.UUID(), nullable=True),
    sa.Column('message_type', sa.String(length=20), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('model_used', sa.String(length=200), nullable=True),
    sa.Column('turn', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['recipient_agent_id'], ['agents.id'], name=op.f('fk_agent_messages_recipient_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['sender_agent_id'], ['agents.id'], name=op.f('fk_agent_messages_sender_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_agent_messages_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_agent_messages'))
    )
    op.create_index('ix_agent_messages_channel', 'agent_messages', ['channel', 'channel_id', 'created_at'], unique=False)
    op.create_index('ix_agent_messages_user', 'agent_messages', ['user_id'], unique=False)
    op.create_table('agent_permissions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=False),
    sa.Column('tool_key', sa.String(length=80), nullable=False),
    sa.Column('allowed', sa.Boolean(), nullable=False),
    sa.Column('mode', sa.String(length=12), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_agent_permissions_agent_id_agents'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_agent_permissions')),
    sa.UniqueConstraint('agent_id', 'tool_key', name='uq_agent_permissions_tool')
    )
    op.create_index(op.f('ix_agent_permissions_agent_id'), 'agent_permissions', ['agent_id'], unique=False)
    op.create_table('agent_profiles',
    sa.Column('agent_id', sa.UUID(), nullable=False),
    sa.Column('avatar', sa.String(length=60), nullable=False),
    sa.Column('color', sa.String(length=9), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('personality', sa.Text(), nullable=False),
    sa.Column('specialties', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('communication_style', sa.Text(), nullable=False),
    sa.Column('work_criteria', sa.Text(), nullable=False),
    sa.Column('temperature', sa.Float(), nullable=True),
    sa.Column('reasoning_level', sa.String(length=10), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_agent_profiles_agent_id_agents'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('agent_id', name=op.f('pk_agent_profiles'))
    )
    op.create_table('ai_models',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('provider_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('model_name', sa.String(length=160), nullable=False),
    sa.Column('display_name', sa.String(length=160), nullable=False),
    sa.Column('capabilities', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('context_window', sa.Integer(), nullable=False),
    sa.Column('max_output_tokens', sa.Integer(), nullable=False),
    sa.Column('input_price_per_mtok', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('output_price_per_mtok', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('quality_tier', sa.Integer(), nullable=False),
    sa.Column('is_default', sa.Boolean(), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), nullable=False),
    sa.Column('is_embedding_default', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['provider_id'], ['ai_providers.id'], name=op.f('fk_ai_models_provider_id_ai_providers'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_ai_models_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_ai_models')),
    sa.UniqueConstraint('provider_id', 'model_name', name='uq_ai_models_provider_name')
    )
    op.create_index(op.f('ix_ai_models_provider_id'), 'ai_models', ['provider_id'], unique=False)
    op.create_index(op.f('ix_ai_models_user_id'), 'ai_models', ['user_id'], unique=False)
    op.create_table('conversations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_conversations_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_conversations_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_conversations_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_conversations'))
    )
    op.create_index('ix_conversations_user', 'conversations', ['user_id'], unique=False)
    op.create_table('plugin_permissions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('plugin_id', sa.UUID(), nullable=False),
    sa.Column('permission', sa.String(length=120), nullable=False),
    sa.Column('granted', sa.Boolean(), nullable=False),
    sa.Column('granted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['plugin_id'], ['plugins.id'], name=op.f('fk_plugin_permissions_plugin_id_plugins'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_plugin_permissions')),
    sa.UniqueConstraint('plugin_id', 'permission', name='uq_plugin_permissions_perm')
    )
    op.create_index(op.f('ix_plugin_permissions_plugin_id'), 'plugin_permissions', ['plugin_id'], unique=False)
    op.create_table('project_agents',
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=False),
    sa.Column('responsibility', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_project_agents_agent_id_agents'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_project_agents_project_id_projects'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('project_id', 'agent_id', name=op.f('pk_project_agents'))
    )
    op.create_table('scheduled_jobs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('cron', sa.String(length=120), nullable=True),
    sa.Column('run_once_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('timezone', sa.String(length=60), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('is_enabled', sa.Boolean(), nullable=False),
    sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_status', sa.String(length=20), nullable=True),
    sa.Column('run_count', sa.Integer(), nullable=False),
    sa.Column('created_by_agent_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_agent_id'], ['agents.id'], name=op.f('fk_scheduled_jobs_created_by_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_scheduled_jobs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_scheduled_jobs'))
    )
    op.create_index('ix_scheduled_jobs_due', 'scheduled_jobs', ['is_enabled', 'next_run_at'], unique=False)
    op.create_table('agent_models',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=False),
    sa.Column('model_id', sa.UUID(), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_agent_models_agent_id_agents'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['model_id'], ['ai_models.id'], name=op.f('fk_agent_models_model_id_ai_models'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_agent_models')),
    sa.UniqueConstraint('agent_id', 'model_id', name='uq_agent_models_pair')
    )
    op.create_index(op.f('ix_agent_models_agent_id'), 'agent_models', ['agent_id'], unique=False)
    op.create_table('missions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('scheduled_job_id', sa.UUID(), nullable=True),
    sa.Column('source_meeting_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('objective', sa.Text(), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('status_reason', sa.Text(), nullable=True),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('autonomy_mode', sa.String(length=20), nullable=False),
    sa.Column('budget_usd', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('spent_usd', sa.Numeric(precision=12, scale=6), nullable=False),
    sa.Column('tokens_used', sa.Integer(), nullable=False),
    sa.Column('plan', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('review', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('security_review', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('review_round', sa.Integer(), nullable=False),
    sa.Column('result', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_missions_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scheduled_job_id'], ['scheduled_jobs.id'], name=op.f('fk_missions_scheduled_job_id_scheduled_jobs'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_missions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_missions'))
    )
    op.create_index('ix_missions_user_status', 'missions', ['user_id', 'status'], unique=False)
    op.create_table('model_eval_runs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('model_ids', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('judge_model_id', sa.UUID(), nullable=True),
    sa.Column('cases', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('summary', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['judge_model_id'], ['ai_models.id'], name=op.f('fk_model_eval_runs_judge_model_id_ai_models'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_model_eval_runs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_model_eval_runs'))
    )
    op.create_index(op.f('ix_model_eval_runs_user_id'), 'model_eval_runs', ['user_id'], unique=False)
    op.create_table('audit_logs',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('actor_type', sa.String(length=10), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('action', sa.String(length=80), nullable=False),
    sa.Column('target_type', sa.String(length=40), nullable=True),
    sa.Column('target_id', sa.UUID(), nullable=True),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('outcome', sa.String(length=20), nullable=False),
    sa.Column('summary', sa.Text(), nullable=False),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('model_used', sa.String(length=200), nullable=True),
    sa.Column('tokens', sa.Integer(), nullable=True),
    sa.Column('cost_usd', sa.Numeric(precision=12, scale=6), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_audit_logs_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_audit_logs_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_audit_logs_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_audit_logs_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_audit_logs'))
    )
    op.create_index('ix_audit_logs_agent', 'audit_logs', ['agent_id'], unique=False)
    op.create_index('ix_audit_logs_mission', 'audit_logs', ['mission_id'], unique=False)
    op.create_index('ix_audit_logs_user_created', 'audit_logs', ['user_id', 'created_at'], unique=False)
    op.create_table('meetings',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('scheduled_job_id', sa.UUID(), nullable=True),
    sa.Column('meeting_type', sa.String(length=30), nullable=False),
    sa.Column('topic', sa.String(length=300), nullable=False),
    sa.Column('objective', sa.Text(), nullable=False),
    sa.Column('context', sa.Text(), nullable=True),
    sa.Column('expected_outcomes', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('max_rounds', sa.Integer(), nullable=False),
    sa.Column('max_duration_seconds', sa.Integer(), nullable=False),
    sa.Column('budget_usd', sa.Numeric(precision=12, scale=4), nullable=True),
    sa.Column('spent_usd', sa.Numeric(precision=12, scale=6), nullable=False),
    sa.Column('tokens_used', sa.Integer(), nullable=False),
    sa.Column('current_round', sa.Integer(), nullable=False),
    sa.Column('stop_reason', sa.Text(), nullable=True),
    sa.Column('summary', sa.Text(), nullable=True),
    sa.Column('outcome', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_meetings_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_meetings_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['scheduled_job_id'], ['scheduled_jobs.id'], name=op.f('fk_meetings_scheduled_job_id_scheduled_jobs'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_meetings_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_meetings'))
    )
    op.create_index('ix_meetings_user_status', 'meetings', ['user_id', 'status'], unique=False)
    op.create_table('mission_tasks',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('mission_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('key', sa.String(length=40), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=False),
    sa.Column('task_type', sa.String(length=20), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('priority', sa.Integer(), nullable=False),
    sa.Column('requires_approval', sa.Boolean(), nullable=False),
    sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revision_of_id', sa.UUID(), nullable=True),
    sa.Column('result', sa.Text(), nullable=True),
    sa.Column('result_data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('max_attempts', sa.Integer(), nullable=False),
    sa.Column('model_used', sa.String(length=200), nullable=True),
    sa.Column('estimated_cost_usd', sa.Numeric(precision=12, scale=6), nullable=True),
    sa.Column('actual_cost_usd', sa.Numeric(precision=12, scale=6), nullable=False),
    sa.Column('tokens_used', sa.Integer(), nullable=False),
    sa.Column('cancel_requested', sa.Boolean(), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_mission_tasks_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_mission_tasks_mission_id_missions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_mission_tasks_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_mission_tasks')),
    sa.UniqueConstraint('mission_id', 'key', name='uq_mission_tasks_key')
    )
    op.create_index('ix_mission_tasks_mission_status', 'mission_tasks', ['mission_id', 'status'], unique=False)
    op.create_index(op.f('ix_mission_tasks_user_id'), 'mission_tasks', ['user_id'], unique=False)
    op.create_table('model_eval_results',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('run_id', sa.UUID(), nullable=False),
    sa.Column('model_id', sa.UUID(), nullable=False),
    sa.Column('case_index', sa.Integer(), nullable=False),
    sa.Column('output', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('tokens_in', sa.Integer(), nullable=False),
    sa.Column('tokens_out', sa.Integer(), nullable=False),
    sa.Column('cost_usd', sa.Numeric(precision=12, scale=6), nullable=True),
    sa.Column('scores', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('judge_notes', sa.Text(), nullable=True),
    sa.Column('overall', sa.Float(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['model_id'], ['ai_models.id'], name=op.f('fk_model_eval_results_model_id_ai_models'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['run_id'], ['model_eval_runs.id'], name=op.f('fk_model_eval_results_run_id_model_eval_runs'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_model_eval_results')),
    sa.UniqueConstraint('run_id', 'model_id', 'case_index', name='uq_model_eval_results_case')
    )
    op.create_index(op.f('ix_model_eval_results_run_id'), 'model_eval_results', ['run_id'], unique=False)
    op.create_table('project_files',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('project_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('path', sa.String(length=500), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('is_latest', sa.Boolean(), nullable=False),
    sa.Column('content_type', sa.String(length=120), nullable=False),
    sa.Column('size_bytes', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('storage_key', sa.String(length=500), nullable=False),
    sa.Column('created_by_agent_id', sa.UUID(), nullable=True),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('change_note', sa.Text(), nullable=True),
    sa.Column('indexed', sa.Boolean(), nullable=False),
    sa.Column('index_error', sa.Text(), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by_agent_id'], ['agents.id'], name=op.f('fk_project_files_created_by_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_project_files_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_project_files_project_id_projects'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_project_files_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_project_files')),
    sa.UniqueConstraint('project_id', 'path', 'version', name='uq_project_files_version')
    )
    op.create_index(op.f('ix_project_files_project_id'), 'project_files', ['project_id'], unique=False)
    op.create_table('meeting_participants',
    sa.Column('meeting_id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('turns_taken', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_meeting_participants_agent_id_agents'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], name=op.f('fk_meeting_participants_meeting_id_meetings'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('meeting_id', 'agent_id', name=op.f('pk_meeting_participants'))
    )
    op.create_table('memory_items',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('scope', sa.String(length=20), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('project_id', sa.UUID(), nullable=True),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('project_file_id', sa.UUID(), nullable=True),
    sa.Column('created_by_agent_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.String(length=300), nullable=True),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('source', sa.String(length=40), nullable=False),
    sa.Column('source_ref', sa.Text(), nullable=True),
    sa.Column('source_date', sa.DateTime(timezone=True), nullable=True),
    sa.Column('confidence', sa.Float(), nullable=False),
    sa.Column('verification_status', sa.String(length=20), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('search_vector', postgresql.TSVECTOR(), sa.Computed("to_tsvector('simple', coalesce(title, '') || ' ' || content)", persisted=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_memory_items_agent_id_agents'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_agent_id'], ['agents.id'], name=op.f('fk_memory_items_created_by_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_memory_items_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_file_id'], ['project_files.id'], name=op.f('fk_memory_items_project_file_id_project_files'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_memory_items_project_id_projects'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_memory_items_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_memory_items'))
    )
    op.create_index('ix_memory_items_agent', 'memory_items', ['agent_id'], unique=False)
    op.create_index('ix_memory_items_project', 'memory_items', ['project_id'], unique=False)
    op.create_index('ix_memory_items_search', 'memory_items', ['search_vector'], unique=False, postgresql_using='gin')
    op.create_index('ix_memory_items_user_scope', 'memory_items', ['user_id', 'scope'], unique=False)
    op.create_table('task_attempts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('task_id', sa.UUID(), nullable=False),
    sa.Column('attempt_number', sa.Integer(), nullable=False),
    sa.Column('worker_id', sa.String(length=120), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('output', sa.Text(), nullable=True),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('model_used', sa.String(length=200), nullable=True),
    sa.Column('tokens_in', sa.Integer(), nullable=False),
    sa.Column('tokens_out', sa.Integer(), nullable=False),
    sa.Column('cost_usd', sa.Numeric(precision=12, scale=6), nullable=False),
    sa.Column('steps', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['mission_tasks.id'], name=op.f('fk_task_attempts_task_id_mission_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_task_attempts')),
    sa.UniqueConstraint('task_id', 'attempt_number', name='uq_task_attempts_number')
    )
    op.create_index(op.f('ix_task_attempts_task_id'), 'task_attempts', ['task_id'], unique=False)
    op.create_table('task_dependencies',
    sa.Column('task_id', sa.UUID(), nullable=False),
    sa.Column('depends_on_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['depends_on_id'], ['mission_tasks.id'], name=op.f('fk_task_dependencies_depends_on_id_mission_tasks'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['mission_tasks.id'], name=op.f('fk_task_dependencies_task_id_mission_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('task_id', 'depends_on_id', name=op.f('pk_task_dependencies'))
    )
    op.create_table('tool_executions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('tool_key', sa.String(length=80), nullable=False),
    sa.Column('operation_class', sa.String(length=30), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('arguments', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('decision', sa.String(length=20), nullable=False),
    sa.Column('decision_reason', sa.Text(), nullable=True),
    sa.Column('result', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.Column('idempotency_key', sa.String(length=128), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_tool_executions_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_tool_executions_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['task_id'], ['mission_tasks.id'], name=op.f('fk_tool_executions_task_id_mission_tasks'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_tool_executions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tool_executions')),
    sa.UniqueConstraint('idempotency_key', name='uq_tool_executions_idempotency')
    )
    op.create_index('ix_tool_executions_task', 'tool_executions', ['task_id'], unique=False)
    op.create_index('ix_tool_executions_user', 'tool_executions', ['user_id', 'created_at'], unique=False)
    op.create_table('usage_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('meeting_id', sa.UUID(), nullable=True),
    sa.Column('provider_id', sa.UUID(), nullable=True),
    sa.Column('model_id', sa.UUID(), nullable=True),
    sa.Column('provider_kind', sa.String(length=30), nullable=False),
    sa.Column('model_name', sa.String(length=200), nullable=False),
    sa.Column('purpose', sa.String(length=40), nullable=False),
    sa.Column('tokens_in', sa.Integer(), nullable=False),
    sa.Column('tokens_out', sa.Integer(), nullable=False),
    sa.Column('cost_estimated_usd', sa.Numeric(precision=12, scale=6), nullable=True),
    sa.Column('cost_confirmed_usd', sa.Numeric(precision=12, scale=6), nullable=True),
    sa.Column('latency_ms', sa.Integer(), nullable=False),
    sa.Column('success', sa.Boolean(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('metadata', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_usage_records_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['meeting_id'], ['meetings.id'], name=op.f('fk_usage_records_meeting_id_meetings'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_usage_records_mission_id_missions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['model_id'], ['ai_models.id'], name=op.f('fk_usage_records_model_id_ai_models'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['provider_id'], ['ai_providers.id'], name=op.f('fk_usage_records_provider_id_ai_providers'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['task_id'], ['mission_tasks.id'], name=op.f('fk_usage_records_task_id_mission_tasks'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_usage_records_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_usage_records'))
    )
    op.create_index('ix_usage_records_agent', 'usage_records', ['agent_id'], unique=False)
    op.create_index('ix_usage_records_mission', 'usage_records', ['mission_id'], unique=False)
    op.create_index('ix_usage_records_user_created', 'usage_records', ['user_id', 'created_at'], unique=False)
    op.create_table('approval_requests',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('mission_id', sa.UUID(), nullable=True),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.Column('tool_execution_id', sa.UUID(), nullable=True),
    sa.Column('agent_id', sa.UUID(), nullable=True),
    sa.Column('operation_class', sa.String(length=30), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('decision_note', sa.Text(), nullable=True),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['agent_id'], ['agents.id'], name=op.f('fk_approval_requests_agent_id_agents'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['mission_id'], ['missions.id'], name=op.f('fk_approval_requests_mission_id_missions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['mission_tasks.id'], name=op.f('fk_approval_requests_task_id_mission_tasks'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tool_execution_id'], ['tool_executions.id'], name=op.f('fk_approval_requests_tool_execution_id_tool_executions'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_approval_requests_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_approval_requests'))
    )
    op.create_index('ix_approval_requests_user_status', 'approval_requests', ['user_id', 'status'], unique=False)
    op.create_table('memory_embeddings',
    sa.Column('memory_id', sa.UUID(), nullable=False),
    sa.Column('embedding_model', sa.String(length=200), nullable=False),
    sa.Column('embedding', pgvector.sqlalchemy.vector.VECTOR(dim=768), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['memory_id'], ['memory_items.id'], name=op.f('fk_memory_embeddings_memory_id_memory_items'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('memory_id', 'embedding_model', name=op.f('pk_memory_embeddings'))
    )
    op.create_index('ix_memory_embeddings_hnsw', 'memory_embeddings', ['embedding'], unique=False, postgresql_using='hnsw', postgresql_with={'m': 16, 'ef_construction': 64}, postgresql_ops={'embedding': 'vector_cosine_ops'})


def downgrade() -> None:
    op.drop_index('ix_memory_embeddings_hnsw', table_name='memory_embeddings', postgresql_using='hnsw', postgresql_with={'m': 16, 'ef_construction': 64}, postgresql_ops={'embedding': 'vector_cosine_ops'})
    op.drop_table('memory_embeddings')
    op.drop_index('ix_approval_requests_user_status', table_name='approval_requests')
    op.drop_table('approval_requests')
    op.drop_index('ix_usage_records_user_created', table_name='usage_records')
    op.drop_index('ix_usage_records_mission', table_name='usage_records')
    op.drop_index('ix_usage_records_agent', table_name='usage_records')
    op.drop_table('usage_records')
    op.drop_index('ix_tool_executions_user', table_name='tool_executions')
    op.drop_index('ix_tool_executions_task', table_name='tool_executions')
    op.drop_table('tool_executions')
    op.drop_table('task_dependencies')
    op.drop_index(op.f('ix_task_attempts_task_id'), table_name='task_attempts')
    op.drop_table('task_attempts')
    op.drop_index('ix_memory_items_user_scope', table_name='memory_items')
    op.drop_index('ix_memory_items_search', table_name='memory_items', postgresql_using='gin')
    op.drop_index('ix_memory_items_project', table_name='memory_items')
    op.drop_index('ix_memory_items_agent', table_name='memory_items')
    op.drop_table('memory_items')
    op.drop_table('meeting_participants')
    op.drop_index(op.f('ix_project_files_project_id'), table_name='project_files')
    op.drop_table('project_files')
    op.drop_index(op.f('ix_model_eval_results_run_id'), table_name='model_eval_results')
    op.drop_table('model_eval_results')
    op.drop_index(op.f('ix_mission_tasks_user_id'), table_name='mission_tasks')
    op.drop_index('ix_mission_tasks_mission_status', table_name='mission_tasks')
    op.drop_table('mission_tasks')
    op.drop_index('ix_meetings_user_status', table_name='meetings')
    op.drop_table('meetings')
    op.drop_index('ix_audit_logs_user_created', table_name='audit_logs')
    op.drop_index('ix_audit_logs_mission', table_name='audit_logs')
    op.drop_index('ix_audit_logs_agent', table_name='audit_logs')
    op.drop_table('audit_logs')
    op.drop_index(op.f('ix_model_eval_runs_user_id'), table_name='model_eval_runs')
    op.drop_table('model_eval_runs')
    op.drop_index('ix_missions_user_status', table_name='missions')
    op.drop_table('missions')
    op.drop_index(op.f('ix_agent_models_agent_id'), table_name='agent_models')
    op.drop_table('agent_models')
    op.drop_index('ix_scheduled_jobs_due', table_name='scheduled_jobs')
    op.drop_table('scheduled_jobs')
    op.drop_table('project_agents')
    op.drop_index(op.f('ix_plugin_permissions_plugin_id'), table_name='plugin_permissions')
    op.drop_table('plugin_permissions')
    op.drop_index('ix_conversations_user', table_name='conversations')
    op.drop_table('conversations')
    op.drop_index(op.f('ix_ai_models_user_id'), table_name='ai_models')
    op.drop_index(op.f('ix_ai_models_provider_id'), table_name='ai_models')
    op.drop_table('ai_models')
    op.drop_table('agent_profiles')
    op.drop_index(op.f('ix_agent_permissions_agent_id'), table_name='agent_permissions')
    op.drop_table('agent_permissions')
    op.drop_index('ix_agent_messages_user', table_name='agent_messages')
    op.drop_index('ix_agent_messages_channel', table_name='agent_messages')
    op.drop_table('agent_messages')
    op.drop_index(op.f('ix_agent_instructions_agent_id'), table_name='agent_instructions')
    op.drop_table('agent_instructions')
    op.drop_table('user_settings')
    op.drop_index(op.f('ix_refresh_tokens_user_id'), table_name='refresh_tokens')
    op.drop_index(op.f('ix_refresh_tokens_family_id'), table_name='refresh_tokens')
    op.drop_table('refresh_tokens')
    op.drop_index('ix_projects_user', table_name='projects')
    op.drop_table('projects')
    op.drop_table('plugins')
    op.drop_index('ix_notifications_user_created', table_name='notifications')
    op.drop_table('notifications')
    op.drop_index('ix_jobs_user', table_name='jobs')
    op.drop_index('ix_jobs_claim', table_name='jobs')
    op.drop_table('jobs')
    op.drop_index('ix_device_tokens_user', table_name='device_tokens')
    op.drop_table('device_tokens')
    op.drop_index('ix_ai_providers_user', table_name='ai_providers')
    op.drop_table('ai_providers')
    op.drop_index('ix_agents_user', table_name='agents')
    op.drop_table('agents')
    op.drop_table('users')
    op.drop_table('tool_definitions')
