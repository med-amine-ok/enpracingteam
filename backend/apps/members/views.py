from rest_framework import generics
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from django.db.models import Prefetch
from .models import Member, Membership, OrgUnit

from .serializers import (
    MemberCreateSerializer,
    MemberDetailSerializer,
    MemberSerializer,
    OrgUnitSerializer,
    BureauMemberSerializer ,
)


class OrgUnitListView(generics.ListAPIView):
    queryset = OrgUnit.objects.select_related("parent").order_by("id")
    serializer_class = OrgUnitSerializer


class MeView(generics.RetrieveAPIView):
    """The logged-in member, with their memberships (role + org unit)."""
    serializer_class = MemberDetailSerializer

    def get_object(self):
        return (
            Member.objects.prefetch_related("memberships__role", "memberships__org_unit")
            .get(pk=self.request.user.pk)
        )


class MemberListCreateView(generics.ListCreateAPIView):
    queryset = Member.objects.order_by("last_name", "first_name")

    def get_serializer_class(self):
        return MemberCreateSerializer if self.request.method == "POST" else MemberSerializer

    def get_permissions(self):
        # Any logged-in member can list. Only staff can create.
        if self.request.method == "POST":
            return [IsAdminUser()]
        return [IsAuthenticated()]

class ExecutiveBureauView(generics.ListAPIView):
    """Everyone holding an active membership in a bureau role."""
    serializer_class = BureauMemberSerializer
    pagination_class = None

    def get_queryset(self):
        active = Membership.objects.filter(
            end_date__isnull=True,
            role__role_type__in=["admin", "head_of_department"],
        ).select_related("role", "org_unit")
        return (
            Member.objects.filter(memberships__in=active)
            .distinct()
            .prefetch_related(Prefetch("memberships", queryset=active, to_attr="bureau_memberships"))
            .order_by("last_name", "first_name")
        )