from rest_framework import generics
from rest_framework.permissions import IsAdminUser, IsAuthenticated

from .models import Member, Membership, OrgUnit

from .serializers import (
    MemberCreateSerializer,
    MemberDetailSerializer,
    OrgUnitSerializer,
)


from django.conf import settings

from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from .cookies import clear_auth_cookies, set_auth_cookies
from .serializers_otp import OTPRequestSerializer, OTPVerifySerializer
from .services_otp import OTPError, request_otp, verify_otp

from rest_framework.exceptions import ValidationError


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    return (
        forwarded.split(",")[0].strip()
        if forwarded
        else request.META.get("REMOTE_ADDR")
    )


class OTPRequestView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

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
                    {"detail": "Please wait before requesting another code."},
                    status=429,
                )
            if str(e) == "rate_limited":
                return Response(
                    {"detail": "Too many requests. Try again later."},
                    status=429,
                )
            # Unknown OTPError — don't leak info, fall through to generic response.

        return Response({
            "detail": "If this email is registered, a code has been sent."
        })


class OTPVerifyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

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
                    {"detail": "Too many attempts. Try again later."},
                    status=429,
                )
            return Response(
                {"detail": "Invalid or expired code."},
                status=400,
            )

        refresh = RefreshToken.for_user(member)

        response = Response({"detail": "Logged in."})
        set_auth_cookies(
            response,
            access=str(refresh.access_token),
            refresh=str(refresh),
        )
        return response


class CookieTokenRefreshView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_REFRESH)

        if not raw:
            return Response(
                {"detail": "Refresh token missing."},
                status=401,
            )

        serializer = TokenRefreshSerializer(data={"refresh": raw})

        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, ValidationError):
            response = Response(
                {"detail": "Invalid or expired refresh token."},
                status=401,
            )
            clear_auth_cookies(response)
            return response

        data = serializer.validated_data

        response = Response({"detail": "Token refreshed."})
        set_auth_cookies(
            response,
            access=data["access"],
            refresh=data.get("refresh"),
        )
        return response


class LogoutView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        raw = request.COOKIES.get(settings.AUTH_COOKIE_REFRESH)

        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass

        response = Response({"detail": "Logged out."})
        clear_auth_cookies(response)
        return response



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
