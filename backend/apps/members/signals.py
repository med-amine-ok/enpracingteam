import threading

from django.db.models.signals import post_delete, post_save, pre_save
from django.db.models import Q
from django.dispatch import receiver

from .models import Membership, Role
from .services import sync_admins_group, sync_executive_bureau

_syncing = threading.local()


@receiver(pre_save, sender=Membership)
def remember_rights(sender, instance, **kwargs):
    """Whether the row gave the club admin's rights before this save, for sync_admins_group: once its unit or
    role is changed, the new values alone no longer say so (decision D-025)."""
    from .access import BOARD_UNIT, TEAM_MANAGER_ROLE

    if instance.pk is None:
        return
    instance._gave_rights_before = Membership.objects.filter(pk=instance.pk).filter(
        Q(org_unit__code=BOARD_UNIT) | Q(role__code=TEAM_MANAGER_ROLE)
    ).exists()


@receiver([post_save, post_delete], sender=Membership)
def membership_changed(sender, instance, **kwargs):
    # Guard against recursion: sync_executive_bureau() itself creates/updates
    # Memberships, which would re-trigger this signal.
    if getattr(_syncing, "active", False):
        return
    _syncing.active = True
    try:
        sync_executive_bureau()
        sync_admins_group(instance)  # the Board and the Team Manager are club admins (decision D-025)
    finally:
        _syncing.active = False


@receiver(post_save, sender=Role)
def role_changed(sender, instance, **kwargs):
    if getattr(_syncing, "active", False):
        return
    _syncing.active = True
    try:
        sync_executive_bureau()
    finally:
        _syncing.active = False
