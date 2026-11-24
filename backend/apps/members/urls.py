from django.urls import path

from .views import (
    CookieTokenRefreshView,
    ExecutiveBureauView,
    LogoutView,
    MeView,
    MemberAddView,
    MemberDetailView,
    MemberListCreateView,
    MemberManageView,
    MembershipAddView,
    MembershipEndView,
    MyAlumniProfileView,
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
    path("auth/me/alumni/", MyAlumniProfileView.as_view()),
    # --- Data ---
    path("org-units/", OrgUnitListView.as_view()),
    path("members/", MemberListCreateView.as_view()),
    path("members/add/", MemberAddView.as_view()),
    path("members/<int:pk>/", MemberDetailView.as_view()),
    # The Board and the Team Manager edit a member (decision D-025).
    path("members/<int:pk>/manage/", MemberManageView.as_view()),
    path("members/<int:pk>/manage/memberships/", MembershipAddView.as_view()),
    path("members/<int:pk>/manage/memberships/<int:membership_pk>/end/", MembershipEndView.as_view()),
    path("executive-bureau/", ExecutiveBureauView.as_view()),
]