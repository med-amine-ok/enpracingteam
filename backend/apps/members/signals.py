from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Membership, Role
from .services import sync_executive_bureau


@receiver([post_save, post_delete], sender=Membership)
def membership_changed(sender, instance, **kwargs):
    if instance.is_auto:  # our own rows: don't loop
        return
    sync_executive_bureau() 
#Whenever a Membership is created, modified, or deleted, synchronize the Executive Bureau.

#For example: Admin creates:

#Yasmine
#OrgUnit = Information Systems
#Role = Executive Bureau Member

#Django does:

#post_save
#    ↓
#membership_changed()
#    ↓
#sync_executive_bureau()
#    ↓
#creates Yasmine's Bureau membership

@receiver(post_save, sender=Role)
def role_changed(sender, instance, **kwargs):
    sync_executive_bureau()
#Whenever a Role is created or modified, recalculate the Executive Bureau.