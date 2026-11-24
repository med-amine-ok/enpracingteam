"""A member's own language choice wins over the browser's (Accept-Language).

Order: the logged-in member's choice, else the browser's language (LocaleMiddleware),
else LANGUAGE_CODE. API requests apply it when they authenticate
(CookieJWTAuthentication); session pages such as the admin use MemberLanguageMiddleware.
"""

from django.utils import translation


def activate_member_language(request, member):
    """Use the member's chosen language for the rest of this request, if they chose one."""
    language = getattr(member, "language", "")
    if language:
        translation.activate(language)
        getattr(request, "_request", request).LANGUAGE_CODE = language  # DRF wraps the Django request


class MemberLanguageMiddleware:
    """Session pages (admin): apply the logged-in member's language. Goes after LocaleMiddleware
    and AuthenticationMiddleware."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            activate_member_language(request, user)
        return self.get_response(request)
