"""Configuración central de NEXUS. Todo valor sensible llega por variables de entorno."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="NEXUS_", env_file=".env", extra="ignore")

    env: str = "development"  # development | test | production
    log_level: str = "INFO"

    database_url: str = "postgresql+asyncpg://nexus:nexus@localhost:5432/nexus"
    redis_url: str | None = "redis://localhost:6379/0"

    # Firma de JWT y cifrado de secretos (claves de proveedores, configuración de plugins).
    secret_key: str = Field(min_length=32)
    # Una o varias claves Fernet separadas por coma; la primera cifra, todas descifran (rotación).
    encryption_keys: str

    access_token_ttl_seconds: int = 900
    refresh_token_ttl_days: int = 30
    allow_registration: bool = True

    require_https: bool = False
    cors_origins: list[str] = []
    rate_limit_per_minute: int = 240
    auth_rate_limit_per_minute: int = 12

    storage_dir: str = "./storage"
    max_upload_mb: int = 25

    # Worker / cola durable
    worker_concurrency: int = 4
    job_lease_seconds: int = 120
    worker_poll_seconds: float = 2.0
    job_max_attempts: int = 3

    # Orquestación
    max_tasks_per_mission: int = 12
    max_agent_steps: int = 8
    max_review_rounds: int = 1
    llm_timeout_seconds: float = 240.0
    llm_max_retries: int = 2

    # Memoria
    embedding_dim: int = 768
    memory_top_k: int = 6

    # Sandbox de código (Docker)
    sandbox_enabled: bool = True
    sandbox_image: str = "python:3.12-slim"
    sandbox_timeout_seconds: int = 60
    sandbox_memory_mb: int = 512
    # Directorio compartido con el host cuando el worker corre en contenedor y usa el socket de Docker.
    sandbox_workdir: str | None = None

    # Notificaciones push (Firebase Cloud Messaging HTTP v1)
    fcm_service_account_file: str | None = None

    # WhatsApp Business Platform (API oficial de Meta). Credenciales SOLO en el servidor.
    whatsapp_business_token: str | None = None
    whatsapp_phone_number_id: str | None = None
    whatsapp_app_secret: str | None = None  # valida la firma X-Hub-Signature-256 de los webhooks
    whatsapp_verify_token: str | None = None  # verificación del webhook (hub.verify_token)
    whatsapp_graph_base_url: str = "https://graph.facebook.com"
    whatsapp_graph_version: str = "v21.0"  # configurable: Meta versiona la Graph API
    whatsapp_business_owner_email: str | None = None  # usuario de NEXUS dueño de la cuenta Business

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        if self.env == "production":
            if not self.require_https:
                raise ValueError("En producción NEXUS_REQUIRE_HTTPS debe ser true")
            if "nexus:nexus@" in self.database_url:
                raise ValueError("En producción no se permiten las credenciales de base de datos de desarrollo")
        return self

    @property
    def is_test(self) -> bool:
        return self.env == "test"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
