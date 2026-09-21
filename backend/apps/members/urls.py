from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import MeView, MemberListCreateView, OrgUnitListView, ExecutiveBureauView, MemberDetailView

urlpatterns = [
    path("auth/login/", TokenObtainPairView.as_view()),
    path("auth/refresh/", TokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("org-units/", OrgUnitListView.as_view()),
    path("members/", MemberListCreateView.as_view()),
    path("members/<str:pk>/", MemberDetailView.as_view()),
    path("executive-bureau/", ExecutiveBureauView.as_view()),
]