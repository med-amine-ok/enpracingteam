import threading

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Membership, Role
from .services import sync_executive_bureau

_syncing = threading.local()


@receiver([post_save, post_delete], sender=Membership)
def membership_changed(sender, instance, **kwargs):
    # Guard against recursion: sync_executive_bureau() itself creates/updates
    # Memberships, which would re-trigger this signal.
    if getattr(_syncing, "active", False):
        return
    _syncing.active = True
    try:
        sync_executive_bureau()
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