import json
import time
import urllib.request

BASE = "http://127.0.0.1:8000"


def req(method: str, path: str, body=None, timeout: float = 120):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    request.add_header("Origin", "http://localhost:3000")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode()
        return response.status, (json.loads(raw) if raw else None)


def main() -> None:
    _, projects = req("GET", "/api/projects?page=1&page_size=50")
    domain = "solarsathi.co.in"
    proj = next((p for p in projects["items"] if p["domain"] == domain), None)
    if not proj:
        _, proj = req("POST", "/api/projects", {"domain": domain})
    print("project", proj["id"], proj["domain"])

    t0 = time.time()
    _, created = req(
        "POST",
        "/api/crawl-runs",
        {
            "project_id": proj["id"],
            "start_url": "https://solarsathi.co.in/",
            "max_pages": 2,
            "enable_pagespeed": False,
        },
    )
    print("created", created, "in", round(time.time() - t0, 2), "s")
    run_id = created["crawl_run_id"]

    for i in range(90):
        time.sleep(2)
        _, progress = req("GET", f"/api/crawl-runs/{run_id}")
        print(
            f"[{i}] t={round(time.time() - t0, 1)}s "
            f"status={progress['status']} active={progress['active']} "
            f"pages={progress['pages_crawled']} phase={progress.get('phase')} "
            f"label={progress.get('phase_label')}"
        )
        if progress["status"] in {"completed", "failed"} and not progress["active"]:
            break
    else:
        print("TIMEOUT waiting for completion")
        return

    t1 = time.time()
    try:
        _, summary = req("GET", f"/api/crawl-runs/{run_id}/summary")
        print(
            "summary score=",
            summary.get("overall_score"),
            "pages=",
            summary.get("total_pages"),
            "in",
            round(time.time() - t1, 2),
            "s",
        )
    except Exception as exc:
        print("summary FAIL", exc)
        t2 = time.time()
        _, audit = req("POST", f"/api/crawl-runs/{run_id}/run-audit", timeout=180)
        print("run-audit", audit, "in", round(time.time() - t2, 2), "s")
        _, summary = req("GET", f"/api/crawl-runs/{run_id}/summary")
        print("summary after audit", summary.get("overall_score"))

    print("TOTAL", round(time.time() - t0, 1), "s")


if __name__ == "__main__":
    main()
