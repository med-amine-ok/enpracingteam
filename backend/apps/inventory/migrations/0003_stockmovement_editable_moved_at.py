import django.utils.timezone
from django.db import migrations, models


def copy_moved_at_to_created_at(apps, schema_editor):
    # Until now moved_at was set automatically when the line was entered,
    # so it is exactly the entry time of the existing rows.
    StockMovement = apps.get_model("inventory", "StockMovement")
    StockMovement.objects.update(created_at=models.F("moved_at"))


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="stockmovement",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.RunPython(copy_moved_at_to_created_at, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="stockmovement",
            name="moved_at",
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
    ]
