from django.db import IntegrityError, transaction
from django.db.models import Prefetch
from rest_framework import generics
from rest_framework.permissions import BasePermission, IsAuthenticated

from apps.projects.models import Project, ProjectMember, ProjectStatus

from .models import AlumniProfile, Member, MemberStatus, OrgUnit, OrgUnitType

from .access import MemberAdding, is_club_admin
from .serializers import (
    AlumniProfileSerializer,
    MemberAddingSerializer,
    MemberAddSerializer,
    MemberCreateSerializer,
    MemberDetailSerializer,
    MemberManageSerializer,
    MemberPreferencesSerializer,
    MembershipAddSerializer,
    MeSerializer,
    OrgUnitSerializer,
)


from django.conf import settings
from django.utils import timezone
from django.utils.translation import gettext as _
from django.utils.translation import gettext_lazy
from drf_spectacular.utils import extend_schema

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .cookies import clear_auth_cookies, set_auth_cookies
from .schema import detail
from .serializers_otp import OTPRequestSerializer, OTPVerifySerializer
from .services_otp import OTPError, request_otp, verify_otp

from django.contrib.auth.models import update_last_login
from django.core.exceptions import ObjectDoesNotExist
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied, ValidationError
from rest_framework.throttling import BaseThrottle


def _client_ip(request):
    """
    Client address used by the OTP rate limits. X-Forwarded-For is written by the client,
    so it is trusted only behind REST_FRAMEWORK["NUM_PROXIES"] known proxies (0 by default:
    the header is ignored and REMOTE_ADDR is used). Same rule as DRF's own throttles.
    """
    return BaseThrottle().get_ident(request)


class OTPRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary="Ask for a login code by e-mail",
        request=OTPRequestSerializer,
        responses={
            200: detail("Same answer whether the e-mail is registered or not (no account leak)."),
            429: detail("Too many requests: wait before asking again."),
        },
    )
    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            request_otp(
                serializer.validated_data["email"],
                _client_ip(request),
            )
        except OTPError as e:
            if str(e) == "cooldown":
                return Response(
                    {"detail": _("Please wait before requesting another code.")},
                    status=429,
                )
            if str(e) == "rate_limited":
                return Response(
                    {"detail": _("Too many requests. Try again later.")},
                    status=429,
                )
            # Unknown OTPError — don't leak info, fall through to generic response.

        return Response({
            "detail": _("If this email is registered, a code has been sent.")
        })


class OTPVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary="Log in with the e-mail code",
        description=(
            "Sets the HttpOnly cookies access_token and refresh_token, and csrf_token: "
            "send its value back in the X-CSRF-Token header on POST, PUT, PATCH and DELETE."
        ),
        request=OTPVerifySerializer,
        responses={
            200: detail("Logged in, cookies set."),
            400: detail("Invalid or expired code (or invalid fields)."),
            429: detail("Too many attempts: try again later."),
        },
    )
    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            member = verify_otp(
                serializer.validated_data["email"],
                serializer.validated_data["code"],
                _client_ip(request),
            )
        except OTPError as e:
            if str(e) == "rate_limited":
                return Response(
                    {"detail": _("Too many attempts. Try again later.")},
                    status=429,
                )
            return Response(
                {"detail": _("Invalid or expired code.")},
                status=400,
            )

        refresh = RefreshToken.for_user(member)
        # SIMPLE_JWT["UPDATE_LAST_LOGIN"] only applies to simplejwt's own login view, not to this one.
        update_last_login(None, member)

        response = Response({"detail": _("Logged in.")})
        set_auth_cookies(
            response,
            access=str(refresh.access_token),
            refresh=str(refresh),
        )
        return response


class CookieTokenRefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary="Renew the session with the refresh_token cookie",
        request=None,
        responses={
            200: detail("New cookies set."),
            401: detail("Refresh cookie missing, invalid or expired (cookies cleared)."),
        },
    )
    def post(self, request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_REFRESH)

        if not raw:
            return Response(
                {"detail": _("Refresh token missing.")},
                status=401,
            )

        serializer = TokenRefreshSerializer(data={"refresh": raw})

        try:
            serializer.is_valid(raise_exception=True)
        # Also an account deleted or made inactive since the cookie was given: simplejwt then raises
        # DoesNotExist or AuthenticationFailed.
        except (TokenError, ValidationError, AuthenticationFailed, ObjectDoesNotExist):
            response = Response(
                {"detail": _("Invalid or expired refresh token.")},
                status=401,
            )
            clear_auth_cookies(response)
            return response

        data = serializer.validated_data

        response = Response({"detail": _("Token refreshed.")})
        set_auth_cookies(
            response,
            access=data["access"],
            refresh=data.get("refresh"),
        )
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(
        summary="Log out",
        request=None,
        responses={200: detail("Logged out: refresh token revoked, cookies cleared.")},
    )
    def post(self, request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_REFRESH)

        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass

        response = Response({"detail": _("Logged out.")})
        clear_auth_cookies(response)
        return response



class OrgUnitListView(generics.ListAPIView):
    queryset = OrgUnit.objects.select_related("parent").order_by("id")
    serializer_class = OrgUnitSerializer


class MeView(generics.RetrieveUpdateAPIView):
    """The logged-in member, with their memberships (role + org unit).
    PATCH changes their preferences (language, year and field of study); PUT is not offered."""
    http_method_names = ["get", "patch", "head", "options"]

    def get_serializer_class(self):
        return MemberPreferencesSerializer if self.request.method == "PATCH" else MeSerializer

    def get_object(self):
        return (
            Member.objects.select_related("alumni_profile")
            .prefetch_related("memberships__role", "memberships__org_unit")
            .get(pk=self.request.user.pk)
        )

    @extend_schema(
        summary="Change my preferences: language (fr, en, ar, or empty for the browser), year and field of study, "
                "race number, the e-mails I turn off",
        request=MemberPreferencesSerializer,
        responses=MeSerializer,
    )
    def patch(self, request, *args, **kwargs):
        try:
            with transaction.atomic():
                super().patch(request, *args, **kwargs)  # validates and saves the preferences
        except IntegrityError as clash:  # another member took the number between the check and the save
            raise ValidationError({"race_number": [_("Another member of the team already has this number.")]}) \
                from clash
        return Response(MeSerializer(self.get_object(), context=self.get_serializer_context()).data)


class IsAlumni(IsAuthenticated):
    message = gettext_lazy("Only a former member of the team has an alumni profile.")

    def has_permission(self, request, view):
        return super().has_permission(request, view) and request.user.status == MemberStatus.ALUMNI


class MyAlumniProfileView(generics.RetrieveUpdateAPIView):
    """The logged-in alumni's profile: graduation year, company, position, LinkedIn, mentoring (decision D-022)."""
    http_method_names = ["get", "patch", "head", "options"]
    serializer_class = AlumniProfileSerializer
    permission_classes = [IsAlumni]

    def get_object(self):
        return AlumniProfile.objects.get_or_create(member=self.request.user)[0]


def with_projects(members):
    """The members with their projects under way or planned prefetched (serializers.member_projects): two queries for
    the whole list rather than two per member."""
    open_statuses = (ProjectStatus.PLANNED, ProjectStatus.ACTIVE)
    return members.prefetch_related(
        Prefetch(
            "project_memberships",
            queryset=ProjectMember.objects.filter(
                is_active=True, end_date__isnull=True, project__status__in=open_statuses
            ).select_related("project"),
            to_attr="open_project_memberships",
        ),
        Prefetch(
            "managed_projects", queryset=Project.objects.filter(status__in=open_statuses),
            to_attr="open_managed_projects",
        ),
    )


class IsClubAdmin(BasePermission):
    """The Board of Directors, the Team Manager and superusers (decision D-025)."""

    def has_permission(self, request, view):
        return is_club_admin(request.user)


class MemberListCreateView(generics.ListCreateAPIView):
    queryset = with_projects(
        Member.objects
        .select_related("alumni_profile")
        .prefetch_related("memberships__role", "memberships__org_unit")
        .order_by("last_name", "first_name")
    )

    def get_serializer_class(self):
        if self.request.method == "POST":
            return MemberCreateSerializer
        return MemberDetailSerializer

    def get_permissions(self):
        # Any logged-in member can list. Only the club admins create here (every leader has is_staff, and this
        # endpoint skips the unit, role and charter checks of /members/add/, decision D-024).
        if self.request.method == "POST":
            return [IsAuthenticated(), IsClubAdmin()]
        return [IsAuthenticated()]


class MemberAddView(APIView):
    """Add a member from the web app (decision D-024): club admins to any unit, department heads to theirs
    and the units below them, with a role that is not a leadership one. The new member is e-mailed how
    to sign in (a code sent to this address, no password)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="What the viewer may do in the \"Add a member\" form", responses=MemberAddingSerializer)
    def get(self, request):
        adding = MemberAdding(request.user)
        return Response(MemberAddingSerializer({
            "can_add": adding.can_add, "can_manage": adding.is_admin, "unit_ids": sorted(adding.unit_ids),
            "roles": adding.roles(),
            "positions": adding.positions(), "projects": adding.projects() if adding.can_add else [],
        }).data)

    @extend_schema(
        summary="Add a member with their first membership (club admins, department heads)",
        request=MemberAddSerializer, responses={201: MemberDetailSerializer},
    )
    def post(self, request):
        from apps.communication.emails import send_welcome_email  # the communication app builds on this one

        adding = MemberAdding(request.user)
        if not adding.can_add:
            raise PermissionDenied(_("Only the club admins and the department heads add members."))
        serializer = MemberAddSerializer(data=request.data, context={"request": request, "adding": adding})
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            member = serializer.save()
            transaction.on_commit(lambda: send_welcome_email.enqueue(member.pk, request.user.pk))
        added = Member.objects.prefetch_related("memberships__role", "memberships__org_unit").get(pk=member.pk)
        return Response(MemberDetailSerializer(added, context={"request": request}).data, status=201)


def managed_member(request, pk):
    """The member the club admins edit (decision D-025): the Board of Directors, the Team Manager, superusers."""
    if not is_club_admin(request.user):
        raise PermissionDenied(_("Only the Board and the Team Manager change the members."))
    member = Member.objects.filter(pk=pk).first()
    if member is None:
        raise NotFound()
    return member


class MemberManageView(APIView):
    """A member as the club admins edit them in the web app (decision D-025)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="A member, as the Board and the Team Manager edit them", responses=MemberManageSerializer)
    def get(self, request, pk):
        return Response(MemberManageSerializer(managed_member(request, pk)).data)

    @extend_schema(
        summary="Change who a member is, their status and their projects (Board, Team Manager)",
        request=MemberManageSerializer, responses=MemberManageSerializer,
    )
    def patch(self, request, pk):
        serializer = MemberManageSerializer(managed_member(request, pk), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            member = serializer.save()
        return Response(MemberManageSerializer(member).data)


class MembershipAddView(APIView):
    """Give a member a membership or a position in the club (decision D-025): the Board, the Team Manager."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="Give a member a unit and a role, or a position in the club (Board, Team Manager)",
        request=MembershipAddSerializer, responses={201: MemberManageSerializer},
    )
    def post(self, request, pk):
        member = managed_member(request, pk)
        serializer = MembershipAddSerializer(
            data=request.data, context={"adding": MemberAdding(request.user), "member": member}
        )
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save()
        return Response(MemberManageSerializer(member).data, status=201)


class MembershipEndView(APIView):
    """End one of a member's memberships today (decision D-025): the Board, the Team Manager."""

    permission_classes = [IsAuthenticated]

    @extend_schema(summary="End a member's membership today (Board, Team Manager)", request=None,
                   responses=MemberManageSerializer)
    def post(self, request, pk, membership_pk):
        member = managed_member(request, pk)
        membership = member.memberships.filter(pk=membership_pk, end_date__isnull=True).first()
        if membership is None:
            raise NotFound()
        with transaction.atomic():
            membership.end_date = timezone.localdate()
            was_primary, membership.is_primary = membership.is_primary, False
            membership.save()  # through save(): the signals update the Bureau and the Admins group
            if was_primary:  # the next one becomes the main, a unit's before a position in the club
                current = member.memberships.filter(end_date__isnull=True).order_by("start_date", "pk")
                following = (
                    current.exclude(org_unit__type=OrgUnitType.GOVERNING_BODY).first() or current.first()
                )
                if following is not None:
                    following.is_primary = True
                    following.save(update_fields=["is_primary"])
        return Response(MemberManageSerializer(member).data)


class MemberDetailView(generics.RetrieveAPIView):
    queryset = (
        Member.objects
        .select_related("alumni_profile")
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
        return with_projects(
            Member.objects
            .filter(
                memberships__org_unit=bureau,
                memberships__end_date__isnull=True,
            )
            .distinct()
            .select_related("alumni_profile")
            .prefetch_related("memberships__role", "memberships__org_unit")
            .order_by("last_name", "first_name")
        )
