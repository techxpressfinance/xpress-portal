"""Automatic tenant filter for root records.

Routers scope by hand (``Model.tenant_id == tenant_id``) and one missed filter is
a cross-tenant leak, because admin/broker access is walled only by tenant. As a
backstop, a session that ``get_tenant_id`` has bound to a tenant adds
``tenant_id = :tenant`` to every ORM SELECT/UPDATE/DELETE touching a
``TenantScoped`` model — joins and aliases included, and the relationship loads
of the rows it returns.

Only roots carry the mixin: the records URL ids point at, whose tenant_id is
written on every create. Child and link tables (quote_options,
application_brokers, ...) don't — several never had tenant_id written, so
filtering them would hide every row — and are reached through a parent that is
already scoped.

Sessions with no bound tenant (background jobs, the scheduler, startup,
super-admin routes) are untouched. A query that must see across tenants opts
out with ``.execution_options(skip_tenant_filter=True)``.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, String, event
from sqlalchemy.orm import Mapped, ORMExecuteState, Session, mapped_column, with_loader_criteria

SESSION_TENANT_KEY = "tenant_id"
SKIP_TENANT_FILTER = "skip_tenant_filter"


class TenantScoped:
    """Mixin for root models with a reliably-populated ``tenant_id``.

    Declares the same column every model already does: with_loader_criteria
    first evaluates its lambda against this class, so the attribute must exist
    here. A model's own definition still takes precedence.
    """

    tenant_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=True)


@event.listens_for(Session, "do_orm_execute")
def _scope_to_session_tenant(state: ORMExecuteState) -> None:
    tenant_id = state.session.info.get(SESSION_TENANT_KEY)
    if not tenant_id or state.execution_options.get(SKIP_TENANT_FILTER):
        return
    # Lazy/column loads inherit the criteria from the query that loaded the parent.
    if state.is_column_load or state.is_relationship_load:
        return
    if state.is_select or state.is_update or state.is_delete:
        state.statement = state.statement.options(
            with_loader_criteria(TenantScoped, lambda cls: cls.tenant_id == tenant_id, include_aliases=True)
        )
