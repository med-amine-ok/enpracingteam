# The tasks of before 20/10/2026 take the statuses decided with the user (decision D-012):
# to do → planned, done → validated (without a quality mark), blocked → in progress with an open
# blocker saying so. They keep no points and stay out of the monthly ranking (scored = False).

from django.db import migrations

CONVERTED_BLOCKER = "Bloquée avant le 20/10/2026 (statut converti) : à préciser ou à résoudre."


def convert(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Blocker = apps.get_model("tasks", "Blocker")
    Task.objects.update(scored=False)
    Task.objects.filter(status="todo").update(status="planned")
    Task.objects.filter(status="done").update(status="validated")
    for task in Task.objects.filter(status="blocked"):
        Blocker.objects.create(
            task=task, description=CONVERTED_BLOCKER, reported_by_id=task.created_by_id,
            known_since=task.updated_at.date(),
        )
        Task.objects.filter(pk=task.pk).update(status="in_progress")


def back(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Blocker = apps.get_model("tasks", "Blocker")
    blocked = Blocker.objects.filter(description=CONVERTED_BLOCKER).values_list("task_id", flat=True)
    Task.objects.filter(pk__in=list(blocked)).update(status="blocked")
    Blocker.objects.filter(description=CONVERTED_BLOCKER).delete()
    Task.objects.filter(status="planned").update(status="todo")
    Task.objects.filter(status__in=["validated", "submitted"]).update(status="done")
    Task.objects.filter(status="needs_revision").update(status="in_progress")


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0004_blockers_points_validation"),
    ]

    operations = [
        migrations.RunPython(convert, back),
    ]
