"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from .views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    # API documentation (staff only, see SPECTACULAR_SETTINGS).
    path("api/schema/", SpectacularAPIView.as_view(), name="api-schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="api-schema"), name="api-docs"),
    path("api/", include("apps.members.urls")),
    path("api/", include("apps.projects.urls")),
    path("api/", include("apps.subsystems.urls")),
    path("api/", include("apps.tasks.urls")),
    path("api/", include("apps.communication.urls")),
    path("api/", include("apps.purchasing.urls")),
    path("api/", include("apps.inventory.urls")),
    path("api/", include("apps.finance.urls")),
    path("api/", include("apps.meetings.urls")),
    path("api/", include("apps.reporting.urls")),
    path("api/", include("apps.documents.urls")),
    path("api/", include("apps.equipment.urls")),
    path("api/", include("apps.ranking.urls")),
    path("api/", include("apps.discipline.urls")),
    path("api/", include("apps.engagement.urls")),
    path("api/", include("apps.assistant.urls")),
]