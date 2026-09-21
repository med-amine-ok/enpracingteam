from rest_framework import generics
from rest_framework.permissions import IsAdminUser, IsAuthenticated

from .models import Member, OrgUnit
from .serializers import (
    MemberCreateSerializer,
    MemberDetailSerializer,
    MemberSerializer,
    OrgUnitSerializer,
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
