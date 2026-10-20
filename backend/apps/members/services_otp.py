# apps/members/services_otp.py

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import LoginOTP, Member
from .rate_limit import check_and_increment, is_in_cooldown

logger = logging.getLogger("members.auth")


class OTPError(Exception):
    pass


def request_otp(email: str, ip: str | None) -> None:
    """
    Always returns normally for an unknown/inactive email — never raises on
    that case — so the caller can give a generic response and not leak
    whether the address is registered. Only raises for rate limiting.
    """
    if ip and not check_and_increment(f"otp:ip:{ip}", settings.OTP_IP_MAX_REQUESTS_PER_HOUR, 3600):
        logger.warning("OTP request blocked: IP rate limit")
        raise OTPError("rate_limited")

    member = Member.objects.filter(email__iexact=email, is_active=True).first()
    if member is None:
        logger.info("OTP requested for unknown/inactive email")
        return

    if is_in_cooldown(f"otp:cooldown:{member.id}", settings.OTP_RESEND_COOLDOWN_SECONDS):
        raise OTPError("cooldown")

    if not check_and_increment(f"otp:email:{member.id}", settings.OTP_MAX_REQUESTS_PER_HOUR, 3600):
        logger.warning("OTP request blocked: email rate limit, member_id=%s", member.id)
        raise OTPError("rate_limited")

    with transaction.atomic():
        otp, code = LoginOTP.issue(member, ip=ip)

    try:
        _send_otp_email(member.email, code)
    except Exception:
        # Email delivery failed: kill the OTP immediately so it can't be
        # guessed/used later, but DO NOT tell the caller — same generic
        # response either way, to avoid leaking delivery status. Log for
        # admin visibility only (no code, no address beyond the id).
        LoginOTP.objects.filter(pk=otp.pk).update(used_at=timezone.now())
        logger.error("OTP email delivery failed for member_id=%s", member.id)
        return

    logger.info("OTP issued for member_id=%s", member.id)


def _send_otp_email(email: str, code: str) -> None:
    send_mail(
        subject="Your ENP Racing Team login code",
        message=(
            f"Your login code is: {code}\n\n"
            f"It expires in {settings.OTP_TTL_SECONDS // 60} minutes and can only be used once.\n"
            "If you did not request this, ignore this email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=False,
    )


def verify_otp(email: str, code: str, ip: str | None) -> Member:
    """
    Returns the Member on success, raises OTPError otherwise.

    IMPORTANT: nothing inside the `with transaction.atomic()` block raises.
    The outcome is decided and written to the DB (including a failed
    attempt's increment) INSIDE the block, which then exits normally and
    COMMITS. Only after the block has committed do we look at the outcome
    and raise if it failed. This guarantees a wrong-code attempt is
    persisted even though the overall call "fails" — if we raised inside
    the atomic block instead, Django would roll back everything written
    in it, silently erasing the failed-attempt record and defeating the
    attempt limit entirely.
    """
    if ip and not check_and_increment(f"otp:verify:ip:{ip}", settings.OTP_IP_MAX_REQUESTS_PER_HOUR, 3600):
        raise OTPError("rate_limited")

    member = Member.objects.filter(email__iexact=email, is_active=True).first()
    if member is None:
        raise OTPError("invalid")

    outcome = {"ok": False}

    with transaction.atomic():
        otp = (
            LoginOTP.objects.select_for_update()
            .filter(member=member, used_at__isnull=True)
            .order_by("-created_at", "-id")
            .first()
        )
        if otp is None or not otp.is_valid():
            pass  # nothing to write; outcome stays failed
        elif otp.check_code(code):
            otp.used_at = timezone.now()
            otp.save(update_fields=["used_at"])
            # Defense in depth: kill any other still-pending OTP for this member.
            LoginOTP.objects.filter(member=member, used_at__isnull=True).exclude(pk=otp.pk).update(
                used_at=timezone.now()
            )
            outcome["ok"] = True
        else:
            # select_for_update() above holds the row lock for the duration of
            # this block, so a concurrent verify attempt on the SAME otp row
            # waits here and then sees this increment — no lost updates.
            LoginOTP.objects.filter(pk=otp.pk).update(attempts=F("attempts") + 1)

    if not outcome["ok"]:
        logger.warning("OTP verify failed for member_id=%s", member.id)
        raise OTPError("invalid")

    logger.info("OTP verify succeeded for member_id=%s", member.id)
    return member