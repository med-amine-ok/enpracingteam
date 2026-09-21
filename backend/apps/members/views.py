from rest_framework import generics
from rest_framework.permissions import IsAdminUser, IsAuthenticated

from .models import Member, Membership, OrgUnit

from .serializers import (
    MemberCreateSerializer,
    MemberDetailSerializer,
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
    queryset = (
        Member.objects
        .prefetch_related("memberships__role", "memberships__org_unit")
        .order_by("last_name", "first_name")
    )

    def get_serializer_class(self):
        if self.request.method == "POST":
            return MemberCreateSerializer
        return MemberDetailSerializer

    def get_permissions(self):
        # Any logged-in member can list. Only staff can create.
        if self.request.method == "POST":
            return [IsAdminUser()]
        return [IsAuthenticated()]


class MemberDetailView(generics.RetrieveAPIView):
    queryset = (
        Member.objects
        .prefetch_related(
            "memberships__role",
            "memberships__org_unit",
        )
    )
    serializer_class = MemberDetailSerializer
    permission_classes = [IsAuthenticated]


class ExecutiveBureauView(generics.ListAPIView):
    """Members with an explicit active membership in the Executive Bureau org unit."""
    serializer_class = MemberDetailSerializer
    pagination_class = None

    def get_queryset(self):
        bureau = OrgUnit.objects.filter(code="executive-bureau").first()
        if bureau is None:
            return Member.objects.none()
        return (
            Member.objects
            .filter(
                memberships__org_unit=bureau,
                memberships__end_date__isnull=True,
            )
            .distinct()
            .prefetch_related("memberships__role", "memberships__org_unit")
            .order_by("last_name", "first_name")
        )