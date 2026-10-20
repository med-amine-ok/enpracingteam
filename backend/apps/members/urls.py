from django.urls import path

from .views import (
    CookieTokenRefreshView,
    ExecutiveBureauView,
    LogoutView,
    MeView,
    MemberDetailView,
    MemberListCreateView,
    OrgUnitListView,
    OTPRequestView,
    OTPVerifyView,
)

urlpatterns = [
    # --- Auth (passwordless OTP) ---
    path("auth/otp/request/", OTPRequestView.as_view()),
    path("auth/otp/verify/", OTPVerifyView.as_view()),
    path("auth/refresh/", CookieTokenRefreshView.as_view()),
    path("auth/logout/", LogoutView.as_view()),
    path("auth/me/", MeView.as_view()),
    # --- Data ---
    path("org-units/", OrgUnitListView.as_view()),
    path("members/", MemberListCreateView.as_view()),
    path("members/<str:pk>/", MemberDetailView.as_view()),
    path("executive-bureau/", ExecutiveBureauView.as_view()),
]