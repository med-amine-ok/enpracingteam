from .models import Task, TaskAssignee, TaskComment, TaskLink


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

@admin.register(TaskLink)
class TaskLinkAdmin(admin.ModelAdmin):
    list_display = ("task", "link_type", "label", "url", "added_by", "created_at")
    list_filter = ("link_type",)
    search_fields = ("task__title", "label", "url")
    list_select_related = ("task", "added_by")