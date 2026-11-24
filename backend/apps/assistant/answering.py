"""
Answering a member's question (decision D-021): the passages nearest to it, from every source ready, are given
to the model, which answers from them only, in the question's language, citing them [1], [2].
"""

import re

from django.db import transaction
from django.utils.translation import get_language
from django.utils.translation import gettext as _
from pgvector.django import CosineDistance

from . import llm
from .models import AssistantMessage, Conversation, MessageRole, SourcePassage, SourceStatus

PASSAGES = 8
HISTORY = 6  # earlier messages of the conversation given to the model, for "and the next one?"
TITLE = 80
LANGUAGES = {"fr": "French", "en": "English", "ar": "Arabic"}

SYSTEM = (
    "You are the assistant of the ENP Racing Team, the Formula Student team of the Ecole Nationale Polytechnique "
    "(Algiers). Answer only from the numbered passages below, taken from the team's charter, the competition's "
    "rules book and the competition's documents. Cite the passages you use, as [1] or [2]. If the passages do not "
    "contain the answer, say so, and do not invent anything. When passages of different seasons disagree, follow "
    "the most recent season. Always write in the language of the question, never in English unless the question "
    "is in English (the member's page is in {language}); be clear and brief.\n\n{passages}"
)


def nearest(question):
    vector = llm.embed([question])[0]
    return list(
        SourcePassage.objects.filter(source__status=SourceStatus.READY).select_related("source")
        .annotate(distance=CosineDistance("embedding", vector)).order_by("distance")[:PASSAGES]
    )


def where(passage):
    source = passage.source
    season = f"{source.season}-{source.season + 1}"
    page = f", page {passage.page}" if passage.page else ""
    return f"{source.title}, season {season}{page}"


def citations(answer, found):
    """The passages the answer cites ([n]), one per source and page; none when it cites none ("not found")."""
    numbers = sorted({int(number) for number in re.findall(r"\[(\d+)\]", answer) if 0 < int(number) <= len(found)})
    rows, seen = [], set()
    for number in numbers:
        passage = found[number - 1]
        key = (passage.source_id, passage.page)
        if key not in seen:
            seen.add(key)
            source = passage.source
            rows.append({"number": number, "source": source.pk, "title": source.title, "season": source.season,
                         "page": passage.page})
    return rows


def ask(member, question, conversation=None):
    """The answer to `question`, saved with it in `conversation` (a new one when None): (conversation, answer).
    Raises llm.AssistantUnavailable before saving anything when the models do not answer."""
    found = nearest(question) if SourcePassage.objects.filter(source__status=SourceStatus.READY).exists() else []
    if found:
        listed = "\n\n".join(f"[{number}] {where(passage)}\n{passage.text}" for number, passage in
                             enumerate(found, start=1))
        language = LANGUAGES.get((get_language() or "fr")[:2], "French")
        messages = [{"role": "system", "content": SYSTEM.format(language=language, passages=listed)}]
        if conversation is not None:
            earlier = list(conversation.messages.order_by("-created_at", "-id")[:HISTORY])[::-1]
            messages += [{"role": message.role, "content": message.content} for message in earlier]
        messages.append({"role": "user", "content": question})
        text = llm.chat(messages)
        sources = citations(text, found)
    else:
        text = _("No document has been given to the assistant yet: the Executive Bureau adds the charter and the "
                 "competition's documents in its Sources.")
        sources = []
    with transaction.atomic():
        if conversation is None:
            conversation = Conversation.objects.create(member=member, title=" ".join(question.split())[:TITLE])
        AssistantMessage.objects.create(conversation=conversation, role=MessageRole.USER, content=question)
        answer = AssistantMessage.objects.create(conversation=conversation, role=MessageRole.ASSISTANT,
                                                 content=text, citations=sources)
        conversation.save(update_fields=["updated_at"])
    return conversation, answer
