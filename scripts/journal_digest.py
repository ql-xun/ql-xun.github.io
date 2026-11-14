"""Build an address-free digest. No transport is enabled by the site workflow."""

from datetime import date
from typing import Callable


def create_digest(previous, calls, active_ids, today):
    """Only verified calls may generate events. Seed silently; persist event keys."""
    seen = dict(previous.get("digest_seen", {})) if previous else {}
    events = []
    for call_id in sorted(active_ids):
        call = calls[call_id]
        old = previous.get("calls", {}).get(call_id) if previous else None
        deadline = call.get("deadline")
        version = f"{call.get('deadline_version', 0)}:{deadline or 'unknown'}"
        days = (date.fromisoformat(deadline) - today).days if deadline else None
        if call["status"] == "closed" or (days is not None and days < 0):
            continue
        reasons = []
        if old is None:
            reasons.append(("new", "新增特刊"))
        elif old.get("deadline") != deadline:
            reasons.append((f"change:{version}", f"截止日期 {old.get('deadline') or '未定'} → {deadline or '未定'}"))
        if days in {14, 7, 1}:
            reasons.append((f"due:{version}:{days}", f"距截止 {days} 天"))
        for key, label in reasons:
            key = f"{call_id}:{key}"
            if key not in seen:
                seen[key] = today.isoformat()
                if previous and previous.get("cfp_sources", {}).get(call["journal_id"], {}).get("checked_at"):
                    events.append((label, call))
    if not events:
        return seen, None
    # One row per CFP, even if it triggers several rules on the same day.
    grouped = {}
    for label, call in events:
        grouped.setdefault(call["id"], (call, []))[1].append(label)
    lines = [f"期刊观察｜{today.isoformat()}", ""]
    for call, labels in sorted(grouped.values(), key=lambda pair: (pair[0].get("deadline") or "9999", pair[0]["title"])):
        lines += [f"[{'；'.join(labels)}] {call['title']}",
                  f"截止日期：{call.get('deadline') or '待核实'}（时区以官方原文为准）", call["url"], ""]
    return seen, {"subject": f"期刊观察：{len(grouped)} 条特刊更新", "body": "\n".join(lines)}


def deliver(digest: dict, *, enabled: bool = False, recipient: str = "", transport: Callable | None = None):
    """Future provider seam. The current workflow never calls a real transport."""
    if not enabled or not digest:
        return False
    if not recipient or transport is None:
        raise ValueError("A configured recipient and transport are required")
    transport(recipient, digest["subject"], digest["body"])
    return True
