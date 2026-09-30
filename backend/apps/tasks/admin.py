from django.contrib import admin

from .models import Task, TaskAssignee, TaskComment, TaskLink


class TaskAssigneeInline(admin.TabularInline):
    model = TaskAssignee
    extra = 1


class TaskCommentInline(admin.TabularInline):
    model = TaskComment
    extra = 0
    readonly_fields = ("created_at",)


class TaskLinkInline(admin.TabularInline):
    model = TaskLink
    extra = 1


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "parent_task", "status", "priority", "due_date", "created_by")
    list_filter = ("project", "status", "priority")
    search_fields = ("title", "description")
    list_select_related = ("project", "parent_task", "created_by")
    inlines = [TaskAssigneeInline, TaskCommentInline, TaskLinkInline]


@admin.register(TaskAssignee)
class TaskAssigneeAdmin(admin.ModelAdmin):
    list_display = ("task", "member", "is_primary")
    list_filter = ("is_primary",)
    search_fields = ("member__email", "task__title")


@admin.register(TaskComment)
class TaskCommentAdmin(admin.ModelAdmin):
    list_display = ("task", "author", "created_at")
    search_fields = ("task__title", "author__email", "content")


@admin.register(TaskLink)
class TaskLinkAdmin(admin.ModelAdmin):
    list_display = ("task", "link_type", "label", "url", "added_by", "created_at")
    list_filter = ("link_type",)
    search_fields = ("task__title", "label", "url")
    list_select_related = ("task", "added_by")