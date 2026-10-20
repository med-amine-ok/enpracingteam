# apps/members/serializers_otp.py

from django.conf import settings
from rest_framework import serializers


class OTPRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class OTPVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField()

    def validate_code(self, value: str) -> str:
        if not value.isdigit() or len(value) != settings.OTP_LENGTH:
            raise serializers.ValidationError("Invalid code format.")
        return value
        